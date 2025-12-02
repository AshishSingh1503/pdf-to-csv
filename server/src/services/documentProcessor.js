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

// --- Pre-compiled Regex Patterns ---
const REGEX_PATTERNS = {
  addressStatePostcodeStart: /^\s*([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i,
  addressPostcodeStateEnd: /^\s*(\d{4})\s+(.+?)\s+([A-Za-z]{2,3})\s*$/i,
  addressStatePostcodeMiddle: /^(.+?)\s+([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i,
  addressStatePostcodeAny: /([A-Za-z]{2,3})\s+(\d{4})/i,
  nameInvalidChars: /[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]/g,
  nameSpecialChars: /|･･･|…|•|\u2026/g,
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
    logger.info(`Worker thread pool initialized with ${this.poolSize} slots`);
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
      logger.error('Worker error:', error);
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
          logger.warn('Error terminating worker:', err.message);
        }
      }
    }
    logger.info('Worker thread pool terminated');
  }
}

const parseFullName = (fullName) => {
  if (!fullName) return { first: '', last: '' };

  try {
    const parts = fullName.trim().split(/\s+/);
    return {
      first: parts[0] || '',
      last: parts.slice(1).join(' ') || ''
    };
  } catch (error) {
    const parts = fullName.trim().split(/\s+/);
    return {
      first: parts[0] || '',
      last: parts.slice(1).join(' ') || ''
    };
  }
};

const extractEntitiesSimple = (document) => {
  const raw = document.entities || [];
  return raw.map((entity, idx) => {
    const type = (entity.type || '').toLowerCase().trim();
    const value = String(entity.mentionText || entity.text || '').trim();

    let startIndex = undefined;
    let endIndex = undefined;
    try {
      const ta = entity.textAnchor || {};
      const segs = ta.textSegments || (ta.textSegments === 0 ? [] : ta.textSegments);
      if (Array.isArray(segs) && segs.length > 0) {
        const seg = segs[0];
        startIndex = seg.startIndex !== undefined ? Number(seg.startIndex) : undefined;
        endIndex = seg.endIndex !== undefined ? Number(seg.endIndex) : undefined;
      }
    } catch (e) {
      // non-fatal
    }

    let midY = null;
    let midX = null;
    let minY = null;
    let maxY = null;
    try {
      const vertices = entity.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices;
      if (vertices && vertices.length >= 4) {
        const ys = vertices.map(v => v.y || 0);
        const xs = vertices.map(v => v.x || 0);
        minY = Math.min(...ys);
        maxY = Math.max(...ys);
        const minX = Math.min(...xs);
        midY = (minY + maxY) / 2;
        midX = minX;
      }
    } catch (e) {
      // non-fatal
    }

    return {
      type,
      value,
      startIndex: Number.isFinite(startIndex) ? startIndex : null,
      endIndex: Number.isFinite(endIndex) ? endIndex : null,
      midY,
      midX,
      minY,
      maxY,
      __raw: entity,
      __order: idx
    };
  }).filter(e => e.value);
};

// --- Anchor-Based Clustering Logic ---
const clusterByVerticalAnchors = (entities) => {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  // 1. Extract Anchors (Names)
  const anchors = entities
    .filter(e => e.type === 'name')
    .sort((a, b) => (a.minY || 0) - (b.minY || 0));

  if (anchors.length === 0) {
    logger.warn('No name anchors found. Falling back to empty records.');
    return [];
  }

  // Initialize records with anchors
  const records = anchors.map(anchor => {
    const { first, last } = parseFullName(anchor.value);
    return {
      first_name: first,
      last_name: last,
      _anchorY: anchor.midY || 0,
      _anchor: anchor,
      mobile: null,
      address: null,
      email: null,
      dateofbirth: null,
      landline: null,
      lastseen: null
    };
  });

  // 2. Cluster Attributes by Vertical Proximity
  const attributeTypes = ['mobile', 'address', 'email', 'dateofbirth', 'landline', 'lastseen'];
  const attributes = entities.filter(e => attributeTypes.includes(e.type));

  for (const attr of attributes) {
    const attrY = attr.midY || 0;
    let bestRecord = null;
    let minDiff = Number.MAX_VALUE;

    for (const record of records) {
      const diff = Math.abs(attrY - record._anchorY);
      if (diff < minDiff) {
        minDiff = diff;
        bestRecord = record;
      }
    }

    if (bestRecord && minDiff < 0.2) {
      const currentVal = bestRecord[attr.type];
      const currentDistKey = `_dist_${attr.type}`;
      const currentDist = bestRecord[currentDistKey] !== undefined ? bestRecord[currentDistKey] : Number.MAX_VALUE;

      if (!currentVal || minDiff < currentDist) {
        bestRecord[attr.type] = attr.value;
        bestRecord[currentDistKey] = minDiff;
      }
    }
  }

  // 3. Final Cleanup and Formatting
  return records.map(r => {
    const finalRecord = {
      first_name: r.first_name,
      last_name: r.last_name,
      mobile: fixJumbledMobile(r.mobile),
      address: r.address,
      email: r.email,
      dateofbirth: r.dateofbirth,
      landline: fixJumbledLandline(r.landline),
      lastseen: r.lastseen
    };

    return finalRecord;
  });
};

const simpleGrouping = (entities) => {
  return clusterByVerticalAnchors(entities);
};

const _single_line_address = (address) => {
  if (!address) return '';
  let s = address.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/[,;\|/]+/g, ' ');
  s = s.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
  s = s.endsWith('.') ? s.slice(0, -1) : s;
  return s;
};

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

const fixJumbledMobile = (rawMobile) => {
  if (!rawMobile) return '';
  const clean = rawMobile.replace(/\s+/g, '');
  if (/^04\d{8}$/.test(clean)) return clean;

  const match = rawMobile.match(/(04\d{2})/);
  if (match) {
    const prefix = match[1];
    const parts = rawMobile.split(prefix);
    if (parts.length >= 2) {
      const before = parts[0].replace(/\D/g, '');
      const after = parts.slice(1).join('').replace(/\D/g, '');
      const rotated = prefix + after + before;
      if (/^04\d{8}$/.test(rotated)) return rotated;
    }
  }
  return clean.replace(/\D/g, '');
};

const fixJumbledLandline = (rawLandline) => {
  if (!rawLandline) return '';
  const s = rawLandline.trim();
  const parts = s.split(/\s+/);
  if (parts.length === 3) {
    const last = parts[2];
    if (/^(0[2378])$/.test(last)) {
      return parts.reverse().join(' ');
    }
  }
  return s.replace(/\D/g, '');
};

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
        await file.mv(tempPath);
        await checkPdfSize(tempPath, file.name);

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
