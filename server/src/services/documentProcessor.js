import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import logger from "../utils/logger.js";
import path from "path";
import pLimit from "p-limit";
import { Worker } from "worker_threads";
import os from "os";
import { promises as fsPromises } from "fs";
import fs from "fs";

// --- CONFIGURATION & CONSTANTS ---
const SAFE_MAX_WORKERS = config.maxWorkers;
const BASE_WORKER_THREAD_POOL = Number(config.workerThreadPoolSize) || Math.max(2, Math.min(os.cpus().length, 16));
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;
const PDF_SIZE_WARN_BYTES = 30 * 1024 * 1024;
const BATCH_SIZE_RECORDS = config.batchSizeRecords;
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS, 10) || 3;
const INITIAL_BACKOFF_MS = parseInt(process.env.INITIAL_BACKOFF_MS, 10) || 1000;

// Document AI request timeout (ms). Default to 20 minutes (1200000ms). Allow override via env.
const _requestedTimeout = parseInt(process.env.REQUEST_TIMEOUT_MS, 10);
const REQUEST_TIMEOUT_MS = (Number.isFinite(_requestedTimeout) && _requestedTimeout >= 60000) ? _requestedTimeout : 1200000;
if (!Number.isFinite(_requestedTimeout) && process.env.REQUEST_TIMEOUT_MS) {
  logger.warn('REQUEST_TIMEOUT_MS invalid; using default 1200000');
} else if (Number.isFinite(_requestedTimeout) && _requestedTimeout < 60000) {
  logger.warn('REQUEST_TIMEOUT_MS too small; minimum is 60000ms. Using default 1200000');
}

// --- Global State Management ---
let client;
let workerThreadPool = null;
let activeRequests = 0;
let currentScaledWorkers = null; // dynamic reference set at runtime inside processPDFs
const MAX_CONCURRENT_REQUESTS = config.maxConcurrentDocAIRequests;

try {
  const clientConfig = {};
  if (process.env.NODE_ENV !== 'production') {
    clientConfig.keyFilename = config.credentials;
  }
  client = new DocumentProcessorServiceClient(clientConfig);
  logger.info('Document AI client initialized successfully');
} catch (error) {
  logger.error("Failed to initialize Document AI client:", error);
}

import {
  REGEX_PATTERNS,
  fixAddressOrdering,
  cleanName,
  normalizeDateField,
  isValidLandline,
  fixJumbledMobile,
  fixJumbledLandline
} from "../utils/validators.js";

// --- Exponential Backoff with Rate Limit Checking ---
const retryWithBackoff = async (fn, maxRetries = RETRY_ATTEMPTS, initialDelay = INITIAL_BACKOFF_MS) => {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const dynamicCap = Math.min(MAX_CONCURRENT_REQUESTS, SAFE_MAX_WORKERS, currentScaledWorkers || MAX_CONCURRENT_REQUESTS);
      if (activeRequests >= dynamicCap) {
        const waitTime = Math.min(1000, 100 * activeRequests);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      activeRequests++;
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT_MS)
        )
      ]);
      activeRequests--;
      return result;

    } catch (error) {
      activeRequests--;
      lastError = error;

      const msg = (error && error.message) ? String(error.message) : '';
      const isRateLimit = error && (error.code === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('rate limit'));
      const isTimeout = msg === 'Request timeout' || msg.toLowerCase() === 'request timeout' || msg.includes('Request timeout');

      if ((isRateLimit || isTimeout) && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        logger.warn(`${isRateLimit ? 'Rate limited' : 'Request timeout'}. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (!isRateLimit && !isTimeout) {
        throw error;
      }
    }
  }

  throw lastError;
};

// --- Batch Database Inserts ---
export const batchInsertRecords = async (records, dbClient, batchSize = BATCH_SIZE_RECORDS) => {
  if (!records || records.length === 0) {
    logger.debug('No records to insert');
    return { insertedCount: 0, batches: 0 };
  }

  let insertedCount = 0;
  let batchCount = 0;

  try {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const columnsPerRow = (batch[0] && typeof batch[0] === 'object') ? Object.keys(batch[0]).length : 8;
      const PARAM_LIMIT = 60000;
      let maxRowsPerInsert = Math.floor(PARAM_LIMIT / Math.max(columnsPerRow, 1));
      if (maxRowsPerInsert < 1) maxRowsPerInsert = 1;

      if (batch.length > maxRowsPerInsert) {
        logger.warn(`Batch of ${batch.length} rows would exceed DB parameter limit (${columnsPerRow} cols * rows > ${PARAM_LIMIT}). Splitting into chunks of ${maxRowsPerInsert}.`);
      }

      const subBatches = [];
      for (let j = 0; j < batch.length; j += maxRowsPerInsert) {
        subBatches.push(batch.slice(j, j + maxRowsPerInsert));
      }

      for (const subBatch of subBatches) {
        batchCount++;

        if (dbClient && typeof dbClient.insertBatch === 'function') {
          const result = await dbClient.insertBatch(subBatch);
          insertedCount += result.rowCount || subBatch.length;
        } else if (dbClient && typeof dbClient.collection === 'function') {
          const result = await dbClient.collection('records').insertMany(subBatch);
          insertedCount += result.insertedCount;
        }

        logger.debug(`Batch ${batchCount}: Inserted ${subBatch.length} records`);
      }
    }
    logger.info(`Total inserted: ${insertedCount} records in ${batchCount} batches`);
    return { insertedCount, batches: batchCount };
  } catch (error) {
    logger.error('Error in batch insert:', error.message);
    throw error;
  }
};

const readFileBuffered = async (tempPath) => {
  try {
    return await fsPromises.readFile(tempPath);
  } catch (error) {
    logger.error(`Failed to read file ${tempPath}:`, error.message);
    throw error;
  }
};

const cleanupTempFile = async (tempPath) => {
  try {
    await fsPromises.unlink(tempPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to cleanup temp file ${tempPath}:`, error.message);
    }
  }
};

const generateJsonObjects = async (rawRecords, filteredRecords, entities, rawText, fileName) => {
  const [preProcessingJson, postProcessingJson] = await Promise.all([
    (async () => {
      const preProcessingRecords = rawRecords.map(record => ({
        full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
        dateofbirth: record.dateofbirth,
        address: record.address,
        mobile: record.mobile,
        email: record.email,
        landline: record.landline,
        lastseen: record.lastseen,
        file_name: record.file_name
      }));

      return {
        file_name: fileName,
        processing_timestamp: new Date().toISOString(),
        raw_records: preProcessingRecords,
        document_ai_entities: entities,
        total_entities: entities.length,
        entity_types: [...new Set(entities.map(e => e.type))],
        raw_text: rawText,
        metadata: {
          processor_id: config.processorId,
          project_id: config.projectId,
          location: config.location
        }
      };
    })(),

    (async () => {
      return {
        file_name: fileName,
        processing_timestamp: new Date().toISOString(),
        raw_records: rawRecords,
        filtered_records: filteredRecords,
        summary: {
          total_raw_records: rawRecords.length,
          total_filtered_records: filteredRecords.length,
          success_rate: rawRecords.length > 0 ? `${((filteredRecords.length / rawRecords.length) * 100).toFixed(1)}%` : "0%"
        },
        field_counts: {
          names: rawRecords.filter(r => r.first_name).length,
          dateofbirths: rawRecords.filter(r => r.dateofbirth).length,
          addresses: rawRecords.filter(r => r.address).length,
          mobiles: rawRecords.filter(r => r.mobile).length,
          emails: rawRecords.filter(r => r.email).length,
          landlines: rawRecords.filter(r => r.landline).length,
          lastseens: rawRecords.filter(r => r.lastseen).length
        },
        metadata: {
          processor_id: config.processorId,
          project_id: config.projectId,
          location: config.location
        }
      };
    })()
  ]);

  return { preProcessingJson, postProcessingJson };
};

const batchValidateRecords = async (records, batchSize = 100) => {
  const prepped = records.map(r => ({
    ...r,
    first_name: String(r.first_name ?? '').trim(),
    last_name: String(r.last_name ?? '').trim(),
    dateofbirth: String(r.dateofbirth ?? '').trim(),
    lastseen: String(r.lastseen ?? '').trim(),
    mobile: String(r.mobile ?? '').trim(),
    email: String(r.email ?? '').trim(),
    landline: String(r.landline ?? '').trim(),
    address: fixAddressOrdering(String(r.address ?? '').trim()),
  }));

  if (prepped.length <= batchSize || !workerThreadPool) {
    return cleanAndValidate(prepped);
  }

  const batches = [];
  for (let i = 0; i < prepped.length; i += batchSize) {
    batches.push(prepped.slice(i, i + batchSize));
  }

  try {
    const validatedBatches = await Promise.all(
      batches.map(batch =>
        workerThreadPool.runTask({
          type: 'validate',
          records: batch,
          patterns: REGEX_PATTERNS,
        })
      )
    );

    const allValid = validatedBatches.flatMap(b => (b && b.validRecords) ? b.validRecords : []);
    const allRejected = validatedBatches.flatMap(b => (b && b.rejectedRecords) ? b.rejectedRecords : []);
    return { validRecords: allValid, rejectedRecords: allRejected };
  } catch (error) {
    logger.warn('Worker thread validation failed, falling back to main thread:', error.message);
    return cleanAndValidate(prepped);
  }
};

const cleanAndValidate = (records) => {
  const cleanRecords = [];
  const rejectedRecords = [];

  for (const record of records) {
    const rawFirst = String(record.first_name || '').trim();
    const rawLast = String(record.last_name || '').trim();
    const rawDob = String(record.dateofbirth || '').trim();
    const rawLastseen = String(record.lastseen || '').trim();

    const firstName = cleanName(rawFirst);
    const lastName = cleanName(rawLast);

    const mobile = String(record.mobile || '').trim();
    let address = String(record.address || '').trim();
    const email = String(record.email || '').trim();
    const rawLandline = String(record.landline || '').trim();

    address = fixAddressOrdering(address);

    const dateofbirth = normalizeDateField(rawDob);
    const lastseen = normalizeDateField(rawLastseen);

    if (!firstName || firstName.length <= 1) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Invalid name'
      });
      continue;
    }

    if (!mobile) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Missing mobile number'
      });
      continue;
    }

    const mobileDigits = mobile.replace(REGEX_PATTERNS.digitOnly, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Invalid mobile number'
      });
      continue;
    }

    if (!address) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Missing address'
      });
      continue;
    }

    const landline = isValidLandline(rawLandline) ? rawLandline.replace(REGEX_PATTERNS.digitOnly, '') : '';
    const full_name = `${firstName} ${lastName}`.trim();

    cleanRecords.push({
      full_name: full_name,
      first_name: firstName,
      last_name: lastName,
      dateofbirth: dateofbirth || '',
      address: address,
      mobile: mobileDigits,
      email: email || '',
      landline: landline,
      lastseen: lastseen || '',
    });
  }

  return { validRecords: cleanRecords, rejectedRecords };
};

const checkPdfSize = async (filePath, fileName) => {
  try {
    const stats = await fsPromises.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (stats.size > MAX_PDF_SIZE_BYTES) {
      throw new Error(`PDF exceeds max size (${fileSizeMB.toFixed(1)}MB > 50MB)`);
    }

    if (stats.size > PDF_SIZE_WARN_BYTES) {
      logger.warn(`Large PDF detected: ${fileName} (${fileSizeMB.toFixed(1)}MB)`);
    }

    return true;
  } catch (error) {
    throw error;
  }
};

const setupGracefulShutdown = async () => {
  const cleanup = async () => {
    logger.info('Shutting down gracefully...');
    if (workerThreadPool) {
      await workerThreadPool.terminate();
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
  });
};

// --- MAIN PROCESSING FUNCTION ---
export const processPDFs = async (pdfFiles, batchSize = 10, maxWorkers = 4) => {
  const initialPoolSize = Math.min(BASE_WORKER_THREAD_POOL, SAFE_MAX_WORKERS);
  if (!workerThreadPool && pdfFiles.length >= 2) {
    workerThreadPool = new WorkerThreadPool(initialPoolSize);
    setupGracefulShutdown();
  }

  const determineScaledWorkers = (count) => {
    if (count <= 1) return 4;
    if (count === 2) return 8;
    if (count <= 10) return 10;
    if (count <= 30) return Math.min(count * 2, 50);
    if (count < 100) return 80;
    if (count === 100) return 120;
    return 120;
  };

  const scaledWorkers = determineScaledWorkers(pdfFiles.length);
  const cappedWorkers = Math.min(scaledWorkers, SAFE_MAX_WORKERS);
  currentScaledWorkers = cappedWorkers;
  const effectiveRequestCap = Math.min(MAX_CONCURRENT_REQUESTS, SAFE_MAX_WORKERS, cappedWorkers);
  logger.info(`Processing ${pdfFiles.length} files | Workers: ${cappedWorkers} | Request Cap: ${effectiveRequestCap}`);

  const limit = pLimit(cappedWorkers);
  const startTime = Date.now();

  try {
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const processFile = async (file, index) => {
      const tempPath = path.join(tempDir, file.name);

      try {
        let documentRequest = {
          name: `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`,
        };

        if (file.gcsUri) {
          // Direct GCS processing
          documentRequest.gcsDocument = {
            gcsUri: file.gcsUri,
            mimeType: "application/pdf"
          };
          logger.info(`Processing directly from GCS: ${file.gcsUri}`);
        } else {
          // Legacy/Local processing
          await file.mv(tempPath);
          await checkPdfSize(tempPath, file.name);
          documentRequest.rawDocument = {
            content: await readFileBuffered(tempPath),
            mimeType: "application/pdf",
          };
        }

        // --- Extraction Logic ---
        // --- Extraction Logic ---
        const extractRecordsFromParentEntities = (document) => {
          const records = [];
          const entities = document.entities || [];

          // Helper to find a property by type within a parent entity
          const findProperty = (properties, type) => {
            return properties.find(p => p.type === type);
          };

          // Helper to get text value
          const getText = (entity) => {
            return entity ? (entity.mentionText || entity.mention_text || '').trim() : '';
          };

          // Helper to get normalized date
          const getDate = (entity) => {
            if (!entity) return '';
            if (entity.normalizedValue && entity.normalizedValue.text) {
              return entity.normalizedValue.text;
            }
            return getText(entity);
          };

          // Helper to check vertical overlap
          const hasVerticalOverlap = (recordEntity, addressEntity) => {
            if (!recordEntity.pageAnchor || !addressEntity.pageAnchor) return false;

            const getYRange = (e) => {
              if (!e.pageAnchor.pageRefs || !e.pageAnchor.pageRefs[0].boundingPoly) return [0, 0];
              const vertices = e.pageAnchor.pageRefs[0].boundingPoly.normalizedVertices;
              if (!vertices) return [0, 0];
              const yMin = Math.min(...vertices.map(v => v.y));
              const yMax = Math.max(...vertices.map(v => v.y));
              return [yMin, yMax];
            };

            const [rMin, rMax] = getYRange(recordEntity);
            const [aMin, aMax] = getYRange(addressEntity);

            // Check if address is roughly within the record's vertical span
            // Expand record span slightly to be generous
            const buffer = 0.02;
            return (aMin >= rMin - buffer && aMax <= rMax + buffer) ||
              (aMin <= rMax + buffer && aMax >= rMin - buffer); // Any overlap
          };

          const allAddresses = [];
          const collectAddresses = (ents) => {
            if (!ents) return;
            ents.forEach(e => {
              if (e.type && e.type.toLowerCase() === 'address') {
                allAddresses.push(e);
              }
              if (e.properties) {
                collectAddresses(e.properties);
              }
            });
          };
          collectAddresses(entities);

          const usedAddressIds = new Set();

          entities.forEach(entity => {
            if (entity.type === 'person_record') {
              const props = entity.properties || [];

              const nameEntity = findProperty(props, 'Name');
              const addressEntity = findProperty(props, 'Address');
              const mobileEntity = findProperty(props, 'Mobile');
              const emailEntity = findProperty(props, 'email');
              const dobEntity = findProperty(props, 'DateofBirth');
              const landlineEntity = findProperty(props, 'landline');
              const lastseenEntity = findProperty(props, 'lastseen');

              if (addressEntity) usedAddressIds.add(addressEntity.id);

              // Parse Name
              const fullName = getText(nameEntity);
              let firstName = '';
              let lastName = '';
              if (fullName) {
                const parts = fullName.split(' ');
                if (parts.length > 0) firstName = parts[0];
                if (parts.length > 1) lastName = parts.slice(1).join(' ');
              }

              const record = {
                first_name: firstName,
                last_name: lastName,
                address: getText(addressEntity),
                mobile: getText(mobileEntity),
                email: getText(emailEntity),
                dateofbirth: getDate(dobEntity),
                landline: getText(landlineEntity),
                lastseen: getDate(lastseenEntity),
                _entity: entity // Keep reference for recovery
              };

              records.push(record);
            }
          });

          // Recovery Logic: Try to assign unused addresses to records missing an address
          const unusedAddresses = allAddresses.filter(a => !usedAddressIds.has(a.id));

          if (unusedAddresses.length > 0) {
            logger.info(`Found ${unusedAddresses.length} unused Address entities. Attempting recovery...`);

            records.forEach(record => {
              if (!record.address && record._entity) {
                // Find best matching unused address
                const bestMatch = unusedAddresses.find(addr => hasVerticalOverlap(record._entity, addr));

                if (bestMatch) {
                  const recoveredAddress = getText(bestMatch);
                  logger.info(`Recovered address for ${record.first_name} ${record.last_name}: ${recoveredAddress}`);
                  record.address = recoveredAddress;
                }
              }
              delete record._entity; // Cleanup
            });
          } else {
            records.forEach(r => delete r._entity);
          }

          return records;
        };

        const [result] = await retryWithBackoff(async () => {
          return await client.processDocument(documentRequest);
        }, RETRY_ATTEMPTS, INITIAL_BACKOFF_MS);

        const rawRecords = extractRecordsFromParentEntities(result.document);
        const entities = result.document.entities || []; // Keep for JSON generation

        const { validRecords: filteredRecordsRaw, rejectedRecords: validationRejected } = await batchValidateRecords(rawRecords, 100);

        // Deduplication Logic:
        // 1. Group by mobile number
        const mobileGroups = new Map();
        const records = filteredRecordsRaw || [];

        for (const record of records) {
          if (!record.mobile) continue; // Should be filtered already, but safety check
          if (!mobileGroups.has(record.mobile)) {
            mobileGroups.set(record.mobile, []);
          }
          mobileGroups.get(record.mobile).push(record);
        }

        const uniqueRecords = [];
        const duplicateRejected = [];

        // Helper to count populated fields
        const countPopulatedFields = (r) => {
          let count = 0;
          if (r.first_name) count++;
          if (r.last_name) count++;
          if (r.dateofbirth) count++;
          if (r.address) count++;
          if (r.email) count++;
          if (r.landline) count++;
          if (r.lastseen) count++;
          return count;
        };

        for (const [mobile, group] of mobileGroups) {
          if (group.length === 1) {
            uniqueRecords.push(group[0]);
          } else {
            // Find best record
            // Priority 1: Has Address
            const withAddress = group.filter(r => r.address && r.address.length > 5);

            let candidates = withAddress.length > 0 ? withAddress : group;

            // Priority 2: Most populated fields
            candidates.sort((a, b) => countPopulatedFields(b) - countPopulatedFields(a));

            const winner = candidates[0];
            uniqueRecords.push(winner);

            // Mark others as duplicates
            for (const record of group) {
              if (record !== winner) {
                duplicateRejected.push({
                  ...record,
                  rejection_reason: 'Duplicate mobile number'
                });
              }
            }
          }
        }
        const filteredRecords = uniqueRecords;

        rawRecords.forEach(r => r.file_name = file.name);
        filteredRecords.forEach(r => r.file_name = file.name);

        const allRejectedForFile = [...(validationRejected || []), ...duplicateRejected];
        allRejectedForFile.forEach(r => r.file_name = file.name);

        const { preProcessingJson, postProcessingJson } = await generateJsonObjects(
          rawRecords,
          filteredRecords,
          entities,
          result.document.text,
          file.name
        );

        logger.info(`[${index + 1}/${pdfFiles.length}] ${file.name} → ${filteredRecords.length} records`);

        return {
          rawRecords,
          filteredRecords,
          rejectedRecords: allRejectedForFile,
          preProcessingJson,
          postProcessingJson,
        };
      } catch (fileError) {
        logger.error(`Error processing file ${file.name}`, fileError && fileError.message);
        return {
          rawRecords: [],
          filteredRecords: [],
          rejectedRecords: [],
          preProcessingJson: null,
          postProcessingJson: null,
          error: fileError.message
        };
      } finally {
        await cleanupTempFile(tempPath);
      }
    };

    const processingPromises = pdfFiles.map((file, index) =>
      limit(() => processFile(file, index))
    );

    const results = await Promise.all(processingPromises);

    const allRawRecords = results
      .filter(r => !r.error)
      .flatMap(r => r.rawRecords);

    const allFilteredRecords = results
      .filter(r => !r.error)
      .flatMap(r => r.filteredRecords);

    const allPreProcessingJson = results
      .filter(r => r.preProcessingJson)
      .map(r => r.preProcessingJson);

    const allPostProcessingJson = results
      .filter(r => r.postProcessingJson)
      .map(r => r.postProcessingJson);

    const allRemovedRecordsRaw = results
      .filter(r => !r.error)
      .flatMap(r => r.rejectedRecords || []);

    const allRemovedRecords = allRemovedRecordsRaw.map((record, index) => ({
      id: index + 1,
      full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      file_name: record.file_name,
      rejection_reason: record.rejection_reason
    }));

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const successRate = allRawRecords.length > 0
      ? `${((allFilteredRecords.length / allRawRecords.length) * 100).toFixed(1)}%`
      : "0%";

    logger.info(`Processing complete in ${processingTime}s | Success rate: ${successRate}`);

    if (workerThreadPool && pdfFiles.length >= 10 && activeRequests === 0) {
      logger.info('Worker pool ready for reuse');
    }

    return {
      allRawRecords,
      allFilteredRecords,
      allRemovedRecords,
      allPreProcessingJson,
      allPostProcessingJson,
    };
  } catch (error) {
    logger.error("Error in processPDFs:", error);
    throw error;
  }
};

process.on('exit', async () => {
  if (workerThreadPool) {
    await workerThreadPool.terminate();
  }
});
