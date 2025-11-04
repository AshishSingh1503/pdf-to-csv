// server/src/services/documentProcessor.js
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { Worker } from "worker_threads";
import os from "os";
import { promises as fsPromises } from "fs";


// --- CONFIGURATION & CONSTANTS ---
const SAFE_MAX_WORKERS = 12; // Reduced from 20 to avoid GCP rate limiting
const WORKER_THREAD_POOL_SIZE = Math.min(os.cpus().length, 4); // 4-8 threads max
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB warning threshold
const PDF_SIZE_WARN_BYTES = 30 * 1024 * 1024; // 30MB soft limit
const BATCH_SIZE_RECORDS = 500;
const RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 360000; // 6 minutes for large PDFs


// --- Global State Management ---
let client;
let workerThreadPool = null;
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 15; // Hard cap for GCP quota safety

try {
  const clientConfig = process.env.NODE_ENV === 'production' ? {} : { keyFilename: config.credentials };
  client = new DocumentProcessorServiceClient(clientConfig);
  console.log('✅ Document AI client initialized successfully');
} catch (error) {
  console.error("🔥 Failed to initialize Document AI client:", error);
  throw new Error("Failed to initialize Document AI client. Please check your Google Cloud credentials.");
}


// --- OPTIMIZATION 6: Pre-compiled Regex Patterns ---
const REGEX_PATTERNS = {
  addressStatePostcodeStart: /^\s*([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i,
  addressPostcodeStateEnd: /^\s*(\d{4})\s+(.+?)\s+([A-Za-z]{2,3})\s*$/i,
  addressStatePostcodeMiddle: /^(.+?)\s+([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i,
  addressStatePostcodeAny: /([A-Za-z]{2,3})\s+(\d{4})/i,
  nameInvalidChars: /[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]/g,
  nameSpecialChars: /�|･･･|…|•|\u2026/g,
  dateInvalidChars: /[^0-9A-Za-z\s\-\/]/g,
  dateFormat: /^(\d{1,2})([A-Za-z]{3,})(\d{4})$/,
  dashNormalize: /[-\u2013\u2014]+/g,
  dashMultiple: /-{2,}/g,
  dashTrim: /^[\-\s]+|[\-\s]+$/g,
  whitespaceMultiple: /\s+/g,
  digitOnly: /\D/g,
};


// --- WORKER THREAD POOL MANAGEMENT ---
class WorkerThreadPool {
  constructor(poolSize) {
    this.poolSize = poolSize;
    this.workers = [];
    this.taskQueue = [];
    this.activeCount = 0;
    this.initialize();
  }

  initialize() {
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push({
        isAvailable: true,
        worker: null, // Lazily initialized
      });
    }
    console.log(`🧵 Worker thread pool initialized with ${this.poolSize} slots`);
  }

  async runTask(task) {
    return new Promise((resolve, reject) => {
      const availableWorker = this.workers.find(w => w.isAvailable);

      if (availableWorker) {
        this.executeOnWorker(availableWorker, task, resolve, reject);
      } else {
        this.taskQueue.push({ task, resolve, reject });
      }
    });
  }

  executeOnWorker(workerSlot, task, resolve, reject) {
    // PITFALL FIX: Lazy initialize workers to avoid startup overhead
    if (!workerSlot.worker) {
      workerSlot.worker = new Worker(new URL('./validators.worker.js', import.meta.url));
      workerSlot.worker.on('error', reject);
      workerSlot.worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    }

    workerSlot.isAvailable = false;
    this.activeCount++;

    const timeout = setTimeout(() => {
      reject(new Error('Worker task timeout'));
      workerSlot.isAvailable = true;
      this.activeCount--;
      this.processQueue();
    }, 60000); // 60s per worker task

    workerSlot.worker.once('message', (result) => {
      clearTimeout(timeout);
      workerSlot.isAvailable = true;
      this.activeCount--;

      if (result.error) {
        reject(new Error(result.error));
      } else {
        resolve(result);
      }

      this.processQueue();
    });

    workerSlot.worker.on('error', (error) => {
      clearTimeout(timeout);
      workerSlot.isAvailable = true;
      this.activeCount--;
      console.error('❌ Worker error:', error);
      reject(error);
      this.processQueue();
    });

    workerSlot.worker.postMessage(task);
  }

  processQueue() {
    if (this.taskQueue.length > 0 && this.workers.some(w => w.isAvailable)) {
      const { task, resolve, reject } = this.taskQueue.shift();
      const availableWorker = this.workers.find(w => w.isAvailable);
      this.executeOnWorker(availableWorker, task, resolve, reject);
    }
  }

  async terminate() {
    for (const workerSlot of this.workers) {
      if (workerSlot.worker) {
        try {
          await workerSlot.worker.terminate();
        } catch (err) {
          console.warn('⚠️  Error terminating worker:', err.message);
        }
      }
    }
    console.log('🧵 Worker thread pool terminated');
  }
}


// --- Helper Functions ---

const extractEntitiesSimple = (document) => {
  return document.entities?.map(entity => ({
    type: entity.type?.toLowerCase().trim(),
    value: entity.mentionText?.trim(),
  })) || [];
};


const simpleGrouping = (entities) => {
  const records = [];
  const names = entities.filter(e => e.type === 'name').map(e => e.value);
  const mobiles = entities.filter(e => e.type === 'mobile').map(e => e.value);
  const addresses = entities.filter(e => e.type === 'address').map(e => e.value);
  const emails = entities.filter(e => e.type === 'email').map(e => e.value);
  const dobs = entities.filter(e => e.type === 'dateofbirth').map(e => e.value);
  const landlines = entities.filter(e => e.type === 'landline').map(e => e.value);
  const lastseens = entities.filter(e => e.type === 'lastseen').map(e => e.value);

  const maxCount = Math.max(names.length, mobiles.length, addresses.length, emails.length, dobs.length, landlines.length, lastseens.length);

  for (let i = 0; i < maxCount; i++) {
    const record = {};
    if (i < names.length) {
      const nameParts = names[i].split(' ');
      record.first_name = nameParts[0] || '';
      record.last_name = nameParts.slice(1).join(' ') || '';
    }
    if (i < mobiles.length) record.mobile = mobiles[i];
    if (i < addresses.length) record.address = addresses[i];
    if (i < emails.length) record.email = emails[i];
    if (i < dobs.length) record.dateofbirth = dobs[i];
    if (i < landlines.length) record.landline = landlines[i];
    if (i < lastseens.length) record.lastseen = lastseens[i];

    if (record.first_name) {
      records.push(record);
    }
  }
  return records;
};


const _single_line_address = (address) => {
  if (!address) return '';
  let s = address.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/[,;\|/]+/g, ' ');
  s = s.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
  s = s.endsWith('.') ? s.slice(0, -1) : s;
  return s;
}


const fixAddressOrdering = (address) => {
  if (!address) return address;

  let s = _single_line_address(address).trim();
  let match;

  match = s.match(REGEX_PATTERNS.addressStatePostcodeStart);
  if (match) {
    const [, state, postcode, rest] = match;
    const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
    return out.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
  }

  match = s.match(REGEX_PATTERNS.addressPostcodeStateEnd);
  if (match) {
    const [, postcode, rest, state] = match;
    const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
    return out.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
  }

  match = s.match(REGEX_PATTERNS.addressStatePostcodeMiddle);
  if (match) {
    const [, part1, state, postcode, part2] = match;
    const out = `${part1.trim()} ${part2.trim()} ${state.toUpperCase()} ${postcode}`;
    return out.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
  }

  match = s.match(REGEX_PATTERNS.addressStatePostcodeAny);
  if (match) {
    const state = match[1].toUpperCase();
    const postcode = match[2];
    const rest = (s.substring(0, match.index) + s.substring(match.index + match[0].length)).trim();
    const out = `${rest.replace(REGEX_PATTERNS.whitespaceMultiple, ' ')} ${state} ${postcode}`;
    return out.trim();
  }

  return s;
};


const cleanName = (name) => {
  if (!name) return '';
  let s = name.trim();
  s = s.replace(REGEX_PATTERNS.nameSpecialChars, '');
  s = s.replace(/[\d?]+/g, '');
  s = s.replace(REGEX_PATTERNS.nameInvalidChars, '');
  s = s.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
  const parts = s ? s.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)) : [];
  return parts.join(' ').trim();
};


const normalizeDateField = (dateStr) => {
  if (!dateStr) return '';
  let s = dateStr.trim();
  s = s.replace(REGEX_PATTERNS.dashNormalize, '-');
  s = s.replace(REGEX_PATTERNS.dashMultiple, '-');
  s = s.replace(REGEX_PATTERNS.dashTrim, '');
  s = s.replace(REGEX_PATTERNS.dateInvalidChars, '');
  s = s.replace(/\./g, '-');

  const match = s.match(REGEX_PATTERNS.dateFormat);
  if (match) {
    s = `${match[1]}-${match[2]}-${match[3]}`;
  }

  try {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return '';
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return '';
  }
};


const isValidLandline = (landline) => {
  if (!landline) return false;
  const digits = landline.replace(REGEX_PATTERNS.digitOnly, '');
  return digits.length >= 10;
};


// --- OPTIMIZATION 4: Exponential Backoff with Rate Limit Checking ---
const retryWithBackoff = async (fn, maxRetries = RETRY_ATTEMPTS, initialDelay = INITIAL_BACKOFF_MS) => {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // PITFALL FIX: Check active requests before attempting
      if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
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

      const isRateLimit = error.code === 429 || 
                         error.message?.includes('RESOURCE_EXHAUSTED') ||
                         error.message?.includes('Rate limit');

      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.warn(`⏱️  Rate limited. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (!isRateLimit) {
        throw error;
      }
    }
  }

  throw lastError;
};


// --- OPTIMIZATION 2: Batch Database Inserts ---
export const batchInsertRecords = async (records, dbClient, batchSize = BATCH_SIZE_RECORDS) => {
  if (!records || records.length === 0) {
    console.log('⚠️  No records to insert');
    return { insertedCount: 0, batches: 0 };
  }

  let insertedCount = 0;
  let batchCount = 0;

  try {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      batchCount++;

      if (dbClient && typeof dbClient.insertBatch === 'function') {
        const result = await dbClient.insertBatch(batch);
        insertedCount += result.rowCount || batch.length;
      } else if (dbClient && typeof dbClient.collection === 'function') {
        const result = await dbClient.collection('records').insertMany(batch);
        insertedCount += result.insertedCount;
      }

      console.log(`📦 Batch ${batchCount}: Inserted ${batch.length} records`);
    }

    console.log(`✅ Total inserted: ${insertedCount} records in ${batchCount} batches`);
    return { insertedCount, batches: batchCount };
  } catch (error) {
    console.error('❌ Error in batch insert:', error.message);
    throw error;
  }
};


// --- OPTIMIZATION 3 & 7: Async File Operations ---
const readFileBuffered = async (tempPath) => {
  try {
    return await fsPromises.readFile(tempPath);
  } catch (error) {
    console.error(`❌ Failed to read file ${tempPath}:`, error.message);
    throw error;
  }
};


const cleanupTempFile = async (tempPath) => {
  try {
    await fsPromises.unlink(tempPath);
  } catch (error) {
    // PITFALL FIX: Non-fatal error handling
    if (error.code !== 'ENOENT') {
      console.warn(`⚠️  Failed to cleanup temp file ${tempPath}:`, error.message);
    }
  }
};


// --- OPTIMIZATION 5: Parallel JSON Generation ---
const generateJsonObjects = async (rawRecords, filteredRecords, entities, rawText, fileName) => {
  const [preProcessingJson, postProcessingJson] = await Promise.all([
    // Pre-processing JSON
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

    // Post-processing JSON
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


// --- OPTIMIZATION 5: Batch Record Processing in Parallel ---
const batchValidateRecords = async (records, batchSize = 100) => {
  if (records.length <= batchSize || !workerThreadPool) {
    // Fall back to main thread validation if too small or no worker pool
    return cleanAndValidate(records);
  }

  const batches = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }

  try {
    const validatedBatches = await Promise.all(
      batches.map(batch =>
        workerThreadPool.runTask({
          type: 'validate',
          records: batch,
          patterns: REGEX_PATTERNS
        })
      )
    );

    return validatedBatches.flat();
  } catch (error) {
    console.warn(`⚠️  Worker thread validation failed, falling back to main thread:`, error.message);
    return cleanAndValidate(records);
  }
};


const cleanAndValidate = (records) => {
  const cleanRecords = [];

  for (const record of records) {
    const rawFirst = record.first_name?.trim() || '';
    const rawLast = record.last_name?.trim() || '';
    const rawDob = record.dateofbirth?.trim() || '';
    const rawLastseen = record.lastseen?.trim() || '';

    const firstName = cleanName(rawFirst);
    const lastName = cleanName(rawLast);

    const mobile = record.mobile?.trim() || '';
    let address = record.address?.trim() || '';
    const email = record.email?.trim() || '';
    const rawLandline = record.landline?.trim() || '';

    address = fixAddressOrdering(address);

    const dateofbirth = normalizeDateField(rawDob);
    const lastseen = normalizeDateField(rawLastseen);

    if (!firstName || firstName.length <= 1) continue;
    if (!mobile) continue;

    const mobileDigits = mobile.replace(REGEX_PATTERNS.digitOnly, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) continue;

    if (!address || !/\d/.test(address.substring(0, 25))) continue;

    const landline = isValidLandline(rawLandline) ? rawLandline.replace(REGEX_PATTERNS.digitOnly, '') : '';

    cleanRecords.push({
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

  const uniqueRecords = [];
  const seenMobiles = new Set();
  for (const record of cleanRecords) {
    if (!seenMobiles.has(record.mobile)) {
      uniqueRecords.push(record);
      seenMobiles.add(record.mobile);
    }
  }

  return uniqueRecords;
};


// --- PDF Size Checking (PITFALL FIX) ---
const checkPdfSize = async (filePath, fileName) => {
  try {
    const stats = await fsPromises.stat(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (stats.size > MAX_PDF_SIZE_BYTES) {
      throw new Error(`PDF exceeds max size (${fileSizeMB.toFixed(1)}MB > 50MB)`);
    }

    if (stats.size > PDF_SIZE_WARN_BYTES) {
      console.warn(`⚠️  Large PDF detected: ${fileName} (${fileSizeMB.toFixed(1)}MB)`);
    }

    return true;
  } catch (error) {
    throw error;
  }
};


// --- Graceful Shutdown Handler ---
const setupGracefulShutdown = async () => {
  const cleanup = async () => {
    console.log('\n🛑 Shutting down gracefully...');
    if (workerThreadPool) {
      await workerThreadPool.terminate();
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Handle uncaught exceptions in promises
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });
};


// --- MAIN PROCESSING FUNCTION (Backward Compatible) ---

/**
 * Process PDFs with all optimizations + GCP safeguards
 * BACKWARD COMPATIBLE: Same interface as original
 * 
 * @param {Array} pdfFiles - Array of PDF file objects
 * @param {Number} batchSize - Unused (kept for compatibility)
 * @param {Number} maxWorkers - Unused (kept for compatibility, auto-determined)
 * @returns {Promise<Object>} Aggregated results from all files
 */
export const processPDFs = async (pdfFiles, batchSize = 10, maxWorkers = 4) => {
  // Initialize worker thread pool if needed
  if (!workerThreadPool && pdfFiles.length >= 10) {
    workerThreadPool = new WorkerThreadPool(WORKER_THREAD_POOL_SIZE);
    setupGracefulShutdown();
  }

  // Auto-scale workers with GCP safety limits
  let scaledWorkers = SAFE_MAX_WORKERS;
  if (pdfFiles.length === 1) {
    scaledWorkers = 2;  // Single file: minimal overhead
  } else if (pdfFiles.length === 2) {
    scaledWorkers = 5;  // Two files: use 5 workers for parallelization
  } else if (pdfFiles.length <= 10) {
    scaledWorkers = 5;  // Small batch: 5 workers
  } else if (pdfFiles.length <= 50) {
    scaledWorkers = 8;  // Medium batch: 8 workers
  } else {
    scaledWorkers = 12; // Large batch: 12 workers (GCP safe max)
  }

  console.log(`📊 Processing ${pdfFiles.length} files | Workers: ${scaledWorkers} | Pool: ${workerThreadPool ? WORKER_THREAD_POOL_SIZE : 0} threads`);
  const limit = pLimit(scaledWorkers);
  const startTime = Date.now();

  try {
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const processFile = async (file, index) => {
      const tempPath = path.join(tempDir, file.name);

      try {
        // Save uploaded file to temp
        await file.mv(tempPath);

        // PITFALL FIX: Check PDF size before processing
        await checkPdfSize(tempPath, file.name);

        // OPTIMIZATION 4: Retry with backoff
        const [result] = await retryWithBackoff(async () => {
          return await client.processDocument({
            name: `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`,
            rawDocument: {
              content: await readFileBuffered(tempPath),
              mimeType: "application/pdf",
            },
          });
        }, RETRY_ATTEMPTS, INITIAL_BACKOFF_MS);

        const entities = extractEntitiesSimple(result.document);
        const rawRecords = simpleGrouping(entities);

        // OPTIMIZATION 5: Batch validate records in parallel
        const filteredRecords = await batchValidateRecords(rawRecords, 100);

        rawRecords.forEach(r => r.file_name = file.name);
        filteredRecords.forEach(r => r.file_name = file.name);

        // OPTIMIZATION 5: Parallel JSON generation
        const { preProcessingJson, postProcessingJson } = await generateJsonObjects(
          rawRecords,
          filteredRecords,
          entities,
          result.document.text,
          file.name
        );

        console.log(`✅ [${index + 1}/${pdfFiles.length}] ${file.name} → ${filteredRecords.length} records`);

        return {
          rawRecords,
          filteredRecords,
          preProcessingJson,
          postProcessingJson,
        };
      } catch (fileError) {
        console.error(`❌ [${index + 1}/${pdfFiles.length}] ${file.name}:`, fileError.message);
        return {
          rawRecords: [],
          filteredRecords: [],
          preProcessingJson: null,
          postProcessingJson: null,
          error: fileError.message
        };
      } finally {
        // OPTIMIZATION 3: Async cleanup
        await cleanupTempFile(tempPath);
      }
    };

    // Process files with concurrency limit
    const processingPromises = pdfFiles.map((file, index) =>
      limit(() => processFile(file, index))
    );

    const results = await Promise.all(processingPromises);

    // Aggregate results
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

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const successRate = allRawRecords.length > 0 
      ? `${((allFilteredRecords.length / allRawRecords.length) * 100).toFixed(1)}%` 
      : "0%";

    console.log(`\n⏱️  Processing complete in ${processingTime}s | Success rate: ${successRate}`);

    // PITFALL FIX: Cleanup worker pool after batch
    if (workerThreadPool && pdfFiles.length >= 10 && activeRequests === 0) {
      // Keep pool alive for reuse
      console.log('🧵 Worker pool ready for reuse');
    }

    return {
      allRawRecords,
      allFilteredRecords,
      allPreProcessingJson,
      allPostProcessingJson,
    };
  } catch (error) {
    console.error("Error in processPDFs:", error);
    throw error;
  }
};


// --- Cleanup on module unload ---
process.on('exit', async () => {
  if (workerThreadPool) {
    await workerThreadPool.terminate();
  }
});

// export { batchInsertRecords };