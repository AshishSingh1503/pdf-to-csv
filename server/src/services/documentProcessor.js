import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import logger from "../utils/logger.js";
import path from "path";
import pLimit from "p-limit";
import { Worker } from "worker_threads";
import os from "os";
import { promises as fsPromises } from "fs";
import fs from "fs";
// import pkg from 'name-parser';
// const { Parser } = pkg;



// --- CONFIGURATION & CONSTANTS ---
const SAFE_MAX_WORKERS = 24; // Upper bound for high-resource environment (8 vGPU/64GB) - allows aggressive parallelization
const BASE_WORKER_THREAD_POOL = Number(config.workerThreadPoolSize) || Math.max(2, Math.min(os.cpus().length, 16)); // configurable base pool size
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB warning threshold
const PDF_SIZE_WARN_BYTES = 30 * 1024 * 1024; // 30MB soft limit
// Increased for high-resource environment (8 vGPU/64GB) to reduce DB round-trips during bulk inserts
const BATCH_SIZE_RECORDS = 5000; // Increased for high-resource environment (8 vGPU/64GB)
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
// NOTE: Raised to match SAFE_MAX_WORKERS for high-performance environments so large batches can reach
// the requested scaled worker counts (e.g. 120 workers for 100-file batches).
const MAX_CONCURRENT_REQUESTS = 150; // Hard cap for in-flight Document AI requests (ceiling)


try {
  const clientConfig = {};
  if (process.env.NODE_ENV !== 'production') {
    clientConfig.keyFilename = config.credentials;
  }
  client = new DocumentProcessorServiceClient(clientConfig);
  logger.info('Document AI client initialized successfully');
} catch (error) {
  logger.error("Failed to initialize Document AI client:", error);
  // Do not throw here, as it can crash the server on startup.
  // The error will be handled in processPDFs.
}



// --- OPTIMIZATION 6: Pre-compiled Regex Patterns ---
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



// ⭐ UPDATED: Use name-parser library for accurate name splitting
const parseFullName = (fullName) => {
  if (!fullName) return { first: '', last: '' };

  try {
    // Use name-parser library for accurate parsing
    // const parsed = new Parser(fullName);
    // const firstName = parsed.firstName() || '';
    // const lastName = parsed.lastName() || '';

    // Validate that we got meaningful results
    // if (!firstName && !lastName) {
    //   logger.warn(`name-parser couldn't parse: "${fullName}"`);
    // Fallback to manual split if library fails
    const parts = fullName.trim().split(/\s+/);
    return {
      first: parts[0] || '',
      last: parts.slice(1).join(' ') || ''
    };
    // }

    // If one is missing but we have the other, use manual fallback for completeness
    /*
    if ((!firstName || !lastName) && fullName.trim()) {
      const parts = fullName.trim().split(/\s+/);
      return {
        first: firstName || parts[0] || '',
        last: lastName || parts.slice(1).join(' ') || ''
      };
    }

    return { first: firstName, last: lastName };
    */
  } catch (error) {
    // logger.error(`Name parser error for "${fullName}":`, error.message);
    // Emergency fallback to manual parsing
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
    // normalize type and text value
    const type = (entity.type || '').toLowerCase().trim();
    const value = String(entity.mentionText || entity.text || '').trim();

    // Attempt to pull startIndex / endIndex from textAnchor.textSegments
    let startIndex = undefined;
    let endIndex = undefined;
    try {
      const ta = entity.textAnchor || {};
      const segs = ta.textSegments || (ta.textSegments === 0 ? [] : ta.textSegments);
      if (Array.isArray(segs) && segs.length > 0) {
        // textSegments usually contains objects with startIndex/endIndex (strings or numbers)
        const seg = segs[0];
        // Some SDKs return strings for int64 — coerce to Number if possible
        startIndex = seg.startIndex !== undefined ? Number(seg.startIndex) : undefined;
        endIndex = seg.endIndex !== undefined ? Number(seg.endIndex) : undefined;
      }
    } catch (e) {
      // non-fatal — we'll fallback to order index below
    }

    // --- NEW: Extract Bounding Box Coordinates ---
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
      // if startIndex is NaN or undefined, set to null so we can detect missing anchors
      startIndex: Number.isFinite(startIndex) ? startIndex : null,
      endIndex: Number.isFinite(endIndex) ? endIndex : null,
      midY,
      midX,
      minY,
      maxY,
      // keep original raw entity for debugging if needed
      __raw: entity,
      __order: idx
    };
  }).filter(e => e.value); // drop empties
};


// --- NEW: Entity Deduplication ---
const deduplicateEntities = (entities) => {
  // Sort by type then minY
  const sorted = [...entities].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.minY - b.minY;
  });

  const result = [];

  for (const entity of sorted) {
    if (result.length === 0) {
      result.push(entity);
      continue;
    }

    const prev = result[result.length - 1];

    // Check if same type
    if (prev.type === entity.type) {
      // Check vertical overlap or proximity
      const prevHeight = prev.maxY - prev.minY;
      const currHeight = entity.maxY - entity.minY;

      // If they overlap or are very close (gap < 20% of height)
      const gap = Math.max(0, entity.minY - prev.maxY);
      const isClose = gap < 0.2 * Math.min(prevHeight, currHeight);
      const isOverlapping = entity.minY < prev.maxY;

      if (isClose || isOverlapping) {
        // Check value similarity (exact match or substring)
        const val1 = prev.value.toLowerCase().replace(/\s+/g, '');
        const val2 = entity.value.toLowerCase().replace(/\s+/g, '');

        if (val1.includes(val2) || val2.includes(val1)) {
          // MERGE
          // Keep the one with longer value (or prev if equal)
          if (entity.value.length > prev.value.length) {
            prev.value = entity.value;
          }
          // Expand bounds
          prev.minY = Math.min(prev.minY, entity.minY);
          prev.maxY = Math.max(prev.maxY, entity.maxY);
          prev.midY = (prev.minY + prev.maxY) / 2;
          prev.midX = Math.min(prev.midX, entity.midX); // simplified
          // Skip adding 'entity' to result
          continue;
        }
      }
    }

    result.push(entity);
  }
  return result;
};


const simpleGrouping = (entities) => {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  // Apply deduplication first
  const dedupedEntities = deduplicateEntities(entities);
  if (dedupedEntities.length < entities.length) {
    logger.debug(`Deduplicated entities: ${entities.length} -> ${dedupedEntities.length}`);
  }

  const pureStartIndexGrouping = (entitySubset) => {
    // This is the original fallback logic, to be used when coordinate data is insufficient
    const sorted = [...entitySubset].sort((a, b) => (a.startIndex ?? a.__order) - (b.startIndex ?? b.__order));
    const nameEntities = sorted.filter(e => e.type === 'name');
    const records = [];


    for (let i = 0; i < nameEntities.length; i++) {
      const nameEnt = nameEntities[i];
      const nextName = nameEntities[i + 1];
      const nameStart = nameEnt.startIndex ?? nameEnt.__order;
      const boundary = nextName?.startIndex ?? Number.MAX_SAFE_INTEGER;
      const slice = sorted.filter(e => (e.startIndex ?? e.__order) >= nameStart && (e.startIndex ?? e.__order) < boundary);


      const record = {};
      const { first, last } = parseFullName(nameEnt.value);
      record.first_name = first;
      record.last_name = last;


      const getFirst = (type) => slice.find(s => s.type === type)?.value;
      record.mobile = getFirst('mobile');
      // JOIN multiple address parts
      record.address = slice.filter(s => s.type === 'address').map(s => s.value).join(' ');
      record.email = getFirst('email');
      record.dateofbirth = getFirst('dateofbirth');
      record.landline = getFirst('landline');
      record.lastseen = getFirst('lastseen');
      records.push(record);
    }
    return records;
  };


  const withCoords = dedupedEntities.filter(e => e.minY != null && e.maxY != null);
  const withoutCoords = dedupedEntities.filter(e => e.minY == null || e.maxY == null);


  if (withCoords.length / dedupedEntities.length < 0.5) {
    logger.debug('Insufficient coordinate data. Using pure startIndex grouping.');
    return pureStartIndexGrouping(dedupedEntities);
  }
  logger.debug('Using overlap-based coordinate grouping.');


  // --- NEW: Overlap-Based Grouping Logic (First Fit with Constraints) ---
  // 1. Sort by Y coordinate (top to bottom)
  const sortedWithCoords = withCoords.sort((a, b) => a.minY - b.minY);
  const rows = [];

  for (const entity of sortedWithCoords) {
    let placed = false;

    // Try to fit into an existing row
    for (const row of rows) {
      // Constraint: One Name Per Row
      // If the row already has a name, and we are trying to add another name, 
      // force a new row (unless they are on the same line, but for safety we split).
      if (entity.type === 'name' && row.some(e => e.type === 'name')) {
        continue;
      }

      // Calculate row bounds
      const rowMinY = Math.min(...row.map(e => e.minY));
      const rowMaxY = Math.max(...row.map(e => e.maxY));
      const rowHeight = rowMaxY - rowMinY;

      // Entity bounds
      const entHeight = entity.maxY - entity.minY;

      // Calculate overlap
      const intersectionStart = Math.max(rowMinY, entity.minY);
      const intersectionEnd = Math.min(rowMaxY, entity.maxY);
      const intersectionHeight = Math.max(0, intersectionEnd - intersectionStart);

      // Overlap threshold: 30% of the smaller height
      const minHeight = Math.min(rowHeight, entHeight);

      // If we have significant overlap, add to row
      if (intersectionHeight > 0.3 * minHeight) {
        row.push(entity);
        placed = true;
        break;
      }
    }

    // If not placed, start a new row
    if (!placed) {
      rows.push([entity]);
    }
  }

  // 2. Create a map of row boundaries based on startIndex (for unslotted fallback)
  const rowBoundaries = rows.map(row => {
    const indices = row.map(e => e.startIndex).filter(idx => idx !== null);
    return {
      row,
      minIdx: Math.min(...indices, Number.MAX_SAFE_INTEGER),
      maxIdx: Math.max(...indices, -1),
    };
  });


  // 3. Slot entities without coordinates into the coordinate-based rows
  const unslotted = [];
  for (const entity of withoutCoords) {
    if (entity.startIndex === null) {
      unslotted.push(entity);
      continue;
    }
    const targetRow = rowBoundaries.find(b => entity.startIndex >= b.minIdx && entity.startIndex <= b.maxIdx);
    if (targetRow) {
      targetRow.row.push(entity);
    } else {
      unslotted.push(entity);
    }
  }


  // 4. Build records from the completed coordinate-based rows
  const coordRecords = rows.map(row => {
    row.sort((a, b) => (a.midX ?? a.startIndex ?? a.__order) - (b.midX ?? b.startIndex ?? b.__order));
    const record = {};
    const nameEntity = row.find(e => e.type === 'name');
    if (nameEntity) {
      const { first, last } = parseFullName(nameEntity.value);
      record.first_name = first;
      record.last_name = last;
    }
    const getFirst = (type) => row.find(e => e.type === type)?.value;

    record.mobile = getFirst('mobile');
    // JOIN multiple address parts
    record.address = row.filter(e => e.type === 'address').map(e => e.value).join(' ');
    record.email = getFirst('email');
    record.dateofbirth = getFirst('dateofbirth');
    record.landline = getFirst('landline');
    record.lastseen = getFirst('lastseen');

    return record;
  });


  // 5. Process any remaining unslotted entities using the original fallback logic
  const fallbackRecords = pureStartIndexGrouping(unslotted);


  // 6. Filter out records without a name (likely artifacts/orphans)
  const validRecords = [...coordRecords, ...fallbackRecords].filter(r => r.first_name || r.last_name);

  if (validRecords.length < (coordRecords.length + fallbackRecords.length)) {
    logger.info(`Filtered ${coordRecords.length + fallbackRecords.length - validRecords.length} records without names (likely artifacts).`);
  }

  return validRecords;
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
      // Use a dynamic cap based on runtime scaled workers when available, but never exceed MAX_CONCURRENT_REQUESTS or SAFE_MAX_WORKERS
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
      // Only treat explicit internal 'Request timeout' errors as retryable timeouts.
      // Avoid broad 'timeout' substring matches that may misclassify unrelated errors.
      const isTimeout = msg === 'Request timeout' || msg.toLowerCase() === 'request timeout' || msg.includes('Request timeout');

      // Retry on rate limits or timeouts with exponential backoff
      if ((isRateLimit || isTimeout) && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        logger.warn(`${isRateLimit ? 'Rate limited' : 'Request timeout'}. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (!isRateLimit && !isTimeout) {
        // Non-retryable error — rethrow immediately
        throw error;
      }
    }
  }

  throw lastError;
};



// --- OPTIMIZATION 2: Batch Database Inserts ---
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
      // Protect against PostgreSQL parameter limits: estimate params = rows * columns_per_row
      const columnsPerRow = (batch[0] && typeof batch[0] === 'object') ? Object.keys(batch[0]).length : 8;
      const PARAM_LIMIT = 60000;
      let maxRowsPerInsert = Math.floor(PARAM_LIMIT / Math.max(columnsPerRow, 1));
      if (maxRowsPerInsert < 1) maxRowsPerInsert = 1;

      if (batch.length > maxRowsPerInsert) {
        logger.warn(`Batch of ${batch.length} rows would exceed DB parameter limit (${columnsPerRow} cols * rows > ${PARAM_LIMIT}). Splitting into chunks of ${maxRowsPerInsert}.`);
      }

      // If needed, split the current batch into safe-sized sub-batches
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



// --- OPTIMIZATION 3 & 7: Async File Operations ---
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
    // PITFALL FIX: Non-fatal error handling
    if (error.code !== 'ENOENT') {
      logger.warn(`Failed to cleanup temp file ${tempPath}:`, error.message);
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
  // ✅ PRE-NORMALIZE addresses (and trim strings) BEFORE any validation/worker
  const prepped = records.map(r => ({
    ...r,
    first_name: String(r.first_name ?? '').trim(),
    last_name: String(r.last_name ?? '').trim(),
    dateofbirth: String(r.dateofbirth ?? '').trim(),
    lastseen: String(r.lastseen ?? '').trim(),
    mobile: String(r.mobile ?? '').trim(),
    email: String(r.email ?? '').trim(),
    landline: String(r.landline ?? '').trim(),
    // 👇 ensure address is reordered before any “starts-with-number” checks
    address: fixAddressOrdering(String(r.address ?? '').trim()),
  }));

  if (prepped.length <= batchSize || !workerThreadPool) {
    // Fall back to main thread validation if too small or no worker pool
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
          // ✅ send already-normalized records to the worker
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



// ⭐ UPDATED: Use safe String().trim() for all field access
const cleanAndValidate = (records) => {
  const cleanRecords = [];
  const rejectedRecords = [];

  for (const record of records) {
    // ⭐ Use String() to safely convert any type to string before trim()
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
        rejection_reason: 'Invalid first name (single character)'
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

  // De-duplication has been moved to processPDFs
  return { validRecords: cleanRecords, rejectedRecords };
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
      logger.warn(`Large PDF detected: ${fileName} (${fileSizeMB.toFixed(1)}MB)`);
    }

    return true;
  } catch (error) {
    throw error;
  }
};



// --- Graceful Shutdown Handler ---
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

  // Handle uncaught exceptions in promises
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
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
  // Initialize worker thread pool if needed (use a safe base pool size)
  const initialPoolSize = Math.min(BASE_WORKER_THREAD_POOL, SAFE_MAX_WORKERS);
  if (!workerThreadPool && pdfFiles.length >= 2) {
    workerThreadPool = new WorkerThreadPool(initialPoolSize);
    setupGracefulShutdown();
  }

  // Determine concurrency based on file count with aggressive scaling for high-resource environments
  const determineScaledWorkers = (count) => {
    // Aggressive scaling targets for 8 vGPU / 64GB environments
    if (count <= 1) return 4; // small jobs get a handful of workers
    if (count === 2) return 8;
    if (count <= 10) return 10;
    if (count <= 30) return Math.min(count * 2, 50); // medium batches scale up to 50
    if (count < 100) return 80; // counts less than 100 use 80
    if (count === 100) return 120; // exactly 100 files should use 120 workers
    return 120; // counts greater than 100 use 120 (within SAFE_MAX_WORKERS=150)
  };

  const scaledWorkers = determineScaledWorkers(pdfFiles.length);
  // Defensive clamp against SAFE_MAX_WORKERS to future-proof deployments
  const cappedWorkers = Math.min(scaledWorkers, SAFE_MAX_WORKERS);
  // Expose current scaled workers to retry/backoff logic — use the capped value so backoff gating matches p-limit
  currentScaledWorkers = cappedWorkers;
  const effectiveRequestCap = Math.min(MAX_CONCURRENT_REQUESTS, SAFE_MAX_WORKERS, cappedWorkers);
  logger.info(`[HIGH-PERFORMANCE MODE] Processing ${pdfFiles.length} files | Requested Workers: ${scaledWorkers} | Capped Workers: ${cappedWorkers} | Effective Request Cap: ${effectiveRequestCap} | Validation Thread Pool: ${initialPoolSize} threads | Max Capacity: ${SAFE_MAX_WORKERS}`);
  const limit = pLimit(cappedWorkers); // dynamic concurrency but capped by SAFE_MAX_WORKERS
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

        // OPTIMIZATION 5: Batch validate records in parallel (worker returns both valid and rejected)
        const { validRecords: filteredRecordsRaw, rejectedRecords: validationRejected } = await batchValidateRecords(rawRecords, 100);

        // 👇 --- DEDUPLICATION BLOCK (also track duplicates as rejected) --- 👇
        const uniqueRecords = [];
        const seenMobiles = new Set();
        const duplicateRejected = [];
        for (const record of (filteredRecordsRaw || [])) {
          if (!seenMobiles.has(record.mobile)) {
            uniqueRecords.push(record);
            seenMobiles.add(record.mobile);
          } else {
            duplicateRejected.push({
              ...record,
              rejection_reason: 'Duplicate mobile number'
            });
          }
        }
        const filteredRecords = uniqueRecords; // Use the de-duplicated list
        // 👆 --- END DEDUPLICATION --- 👆

        try {
          // SAVE RAW DOCAI OUTPUT FOR DEBUGGING
          // Always save this for now as requested by the user to inspect data
          const safeName = String(file.name || 'unknown').replace(/[^a-z0-9_.-]/gi, '_');
          const debugDir = path.join(process.cwd(), 'debug_output');
          if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

          const outName = path.join(debugDir, `docai-raw-${safeName}-${Date.now()}.json`);
          // We save the full document object which contains entities, text, pages, etc.
          fs.writeFileSync(outName, JSON.stringify(result.document, null, 2));
          logger.info(`Raw DocAI output saved to: ${outName}`);

          // Also save entity debug file if needed
          if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') {
            const entityOutName = path.join(debugDir, `entity-debug-${safeName}-${Date.now()}.json`);
            const logData = JSON.stringify(entities.map(e => ({ type: e.type, value: e.value.substring(0, 30), startIndex: e.startIndex })), null, 2);
            fs.writeFileSync(entityOutName, logData);
          }
        } catch (e) {
          logger.warn('Failed to write debug file', e && e.message);
        }


        // Assign file name to all record types
        rawRecords.forEach(r => r.file_name = file.name);
        filteredRecords.forEach(r => r.file_name = file.name); // This now uses the unique list

        const allRejectedForFile = [...(validationRejected || []), ...duplicateRejected];
        allRejectedForFile.forEach(r => r.file_name = file.name);

        // OPTIMIZATION 5: Parallel JSON generation
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

    // Aggregate removed/rejected records from each file
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

    // PITFALL FIX: Cleanup worker pool after batch
    if (workerThreadPool && pdfFiles.length >= 10 && activeRequests === 0) {
      // Keep pool alive for reuse
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



// --- Cleanup on module unload ---
process.on('exit', async () => {
  if (workerThreadPool) {
    await workerThreadPool.terminate();
  }
});