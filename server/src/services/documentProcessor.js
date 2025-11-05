// server/src/services/documentProcessor.js
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import Parser from "name-parser";
import { config } from "../config/index.js";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import { Worker } from "worker_threads";
import os from "os";
import { promises as fsPromises } from "fs";
// import pkg from 'name-parser';
// const { Parser } = pkg;



// --- CONFIGURATION & CONSTANTS ---
const SAFE_MAX_WORKERS = 12; // Reduced from 20 to avoid GCP rate limiting
const WORKER_THREAD_POOL_SIZE = Math.min(os.cpus().length, 4); // 4-8 threads max
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB warning threshold
const PDF_SIZE_WARN_BYTES = 30 * 1024 * 1024; // 30MB soft limit
const BATCH_SIZE_RECORDS = 500;
const RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 600000; // 10 minutes for large PDFs



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


// const extractEntitiesSimple = (document) => {
//   return document.entities?.map(entity => ({
//     type: entity.type?.toLowerCase().trim(),
//     value: entity.mentionText?.trim(),
//   })) || [];
// };



// ⭐ UPDATED: Use name-parser library for accurate name splitting
const parseFullName = (fullName) => {
  if (!fullName) return { first: '', last: '' };

  try {
    // Use name-parser library for accurate parsing
    const parsed = new Parser(fullName);
    const firstName = parsed.firstName() || '';
    const lastName = parsed.lastName() || '';

    // Validate that we got meaningful results
    if (!firstName && !lastName) {
      console.warn(`⚠️  name-parser couldn't parse: "${fullName}"`);
      // Fallback to manual split if library fails
      const parts = fullName.trim().split(/\s+/);
      return {
        first: parts[0] || '',
        last: parts.slice(1).join(' ') || ''
      };
    }

    // If one is missing but we have the other, use manual fallback for completeness
    if ((!firstName || !lastName) && fullName.trim()) {
      const parts = fullName.trim().split(/\s+/);
      return {
        first: firstName || parts[0] || '',
        last: lastName || parts.slice(1).join(' ') || ''
      };
    }

    return { first: firstName, last: lastName };
  } catch (error) {
    console.error(`❌ Name parser error for "${fullName}":`, error.message);
    // Emergency fallback to manual parsing
    const parts = fullName.trim().split(/\s+/);
    return {
      first: parts[0] || '',
      last: parts.slice(1).join(' ') || ''
    };
  }
};

// --- Replace extractEntitiesSimple and simpleGrouping with this improved version ---

/**
 * extractEntitiesSimple
 * - returns entities with type, value, and best-effort startIndex/endIndex (numbers)
 * - falls back to using the entity order index if textAnchor is not present
 */
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
    try {
      const vertices = entity.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices;
      if (vertices && vertices.length >= 4) {
        const ys = vertices.map(v => v.y || 0);
        const xs = vertices.map(v => v.x || 0);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
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
      // keep original raw entity for debugging if needed
      __raw: entity,
      __order: idx
    };
  }).filter(e => e.value); // drop empties
};


const simpleGrouping = (entities) => {
  if (!Array.isArray(entities) || entities.length === 0) return [];


  // --- Fallback Grouping (Original startIndex logic) ---
  const fallbackGrouping = () => {
    console.warn('⚠️ simpleGrouping: Falling back to startIndex-based grouping.');
    const sorted = [...entities].sort((a, b) => {
      const aPos = a.startIndex !== null ? a.startIndex : Number.MAX_SAFE_INTEGER;
      const bPos = b.startIndex !== null ? b.startIndex : Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      return (a.__order || 0) - (b.__order || 0);
    });


    const nameEntities = sorted.filter(e => e.type === 'name');
    const records = [];


    for (let i = 0; i < nameEntities.length; i++) {
      const nameEnt = nameEntities[i];
      const nextName = nameEntities[i + 1];
      const nameStart = nameEnt.startIndex !== null ? nameEnt.startIndex : nameEnt.__order;
      const boundary = (nextName && nextName.startIndex !== null) ? nextName.startIndex : Number.MAX_SAFE_INTEGER;


      const slice = sorted.filter(e => {
        const pos = (e.startIndex !== null ? e.startIndex : e.__order);
        return pos >= nameStart && pos < boundary;
      });


      const record = {};
      const { first, last } = parseFullName(nameEnt.value);
      record.first_name = first;
      record.last_name = last;


      const getFirst = (type) => slice.find(s => s.type === type)?.value;
      record.mobile = getFirst('mobile');
      record.address = getFirst('address');
      record.email = getFirst('email');
      record.dateofbirth = getFirst('dateofbirth');
      record.landline = getFirst('landline');
      record.lastseen = getFirst('lastseen');
      records.push(record);
    }
    return records;
  };


  // --- Coordinate-based Grouping ---
  const withCoords = entities.filter(e => e.midY !== null && e.midX !== null);
  if (withCoords.length / entities.length < 0.5) {
    console.log(`[Diagnostic] Coordinate data found for ${withCoords.length}/${entities.length} entities. Not enough for coordinate-based grouping.`);
    return fallbackGrouping();
  }
  console.log(`[Diagnostic] Using Y-coordinate grouping for ${withCoords.length}/${entities.length} entities.`);


  const sorted = withCoords.sort((a, b) => {
    if (a.midY !== b.midY) return a.midY - b.midY;
    return a.midX - b.midX;
  });


  const rows = [];
  if (sorted.length > 0) {
    let currentRow = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (Math.abs(curr.midY - prev.midY) < 0.01) { // ROW_Y_TOLERANCE
        currentRow.push(curr);
      } else {
        rows.push(currentRow);
        currentRow = [curr];
      }
    }
    rows.push(currentRow);
  }


  return rows.map(row => {
    const record = {};
    const nameEntity = row.find(e => e.type === 'name');
    if (nameEntity) {
      const { first, last } = parseFullName(nameEntity.value);
      record.first_name = first;
      record.last_name = last;
    }


    const getFirst = (type) => row.find(e => e.type === type)?.value;
    record.mobile = getFirst('mobile');
    record.address = getFirst('address');
    record.email = getFirst('email');
    record.dateofbirth = getFirst('dateofbirth');
    record.landline = getFirst('landline');
    record.lastseen = getFirst('lastseen');
    return record;
  }).filter(r => r.first_name);
};



// const simpleGrouping = (entities) => {
//   const records = [];
//   const names = entities.filter(e => e.type === 'name').map(e => e.value);
//   const mobiles = entities.filter(e => e.type === 'mobile').map(e => e.value);
//   const addresses = entities.filter(e => e.type === 'address').map(e => e.value);
//   const emails = entities.filter(e => e.type === 'email').map(e => e.value);
//   const dobs = entities.filter(e => e.type === 'dateofbirth').map(e => e.value);
//   const landlines = entities.filter(e => e.type === 'landline').map(e => e.value);
//   const lastseens = entities.filter(e => e.type === 'lastseen').map(e => e.value);

//   const maxCount = Math.max(names.length, mobiles.length, addresses.length, emails.length, dobs.length, landlines.length, lastseens.length);

//   for (let i = 0; i < maxCount; i++) {
//     const record = {};

//     if (i < names.length) {
//       // ⭐ Use name-parser for accurate first/last name splitting
//       const { first, last } = parseFullName(names[i]);
//       record.first_name = first;
//       record.last_name = last;
//     }

//     if (i < mobiles.length) record.mobile = mobiles[i];
//     if (i < addresses.length) record.address = addresses[i];
//     if (i < emails.length) record.email = emails[i];
//     if (i < dobs.length) record.dateofbirth = dobs[i];
//     if (i < landlines.length) record.landline = landlines[i];
//     if (i < lastseens.length) record.lastseen = lastseens[i];

//     if (record.first_name) {
//       records.push(record);
//     }
//   }
//   return records;
// };



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

    return validatedBatches.flat();
  } catch (error) {
    console.warn(`⚠️  Worker thread validation failed, falling back to main thread:`, error.message);
    return cleanAndValidate(prepped);
  }
};



// ⭐ UPDATED: Use safe String().trim() for all field access
const cleanAndValidate = (records) => {
  const cleanRecords = [];

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

    if (!firstName || firstName.length <= 1) continue;
    if (!mobile) continue;

    const mobileDigits = mobile.replace(REGEX_PATTERNS.digitOnly, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) continue;

    // 👇 --- THIS IS THE FIX (matching the worker) --- 👇
    if (!address || !/\d/.test(address)) continue;

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
  return cleanRecords;
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

  // ⭐ NEW LOGIC: Scale workers based on file count
  let scaledWorkers = SAFE_MAX_WORKERS;

  if (pdfFiles.length === 1) {
    scaledWorkers = 2;
  } else if (pdfFiles.length === 2) {
    scaledWorkers = 5;
  } else if (pdfFiles.length <= 10) {
    scaledWorkers = 5;
  } else if (pdfFiles.length <= 30) {
    scaledWorkers = pdfFiles.length;  // ⭐ Send ALL to Google immediately!
  } else if (pdfFiles.length <= 100) {
    scaledWorkers = 50;  // ⭐ For 100 files, use 50 workers
  } else {
    scaledWorkers = 75;  // ⭐ For 100+ files, use 75 workers
  }

  console.log(`📊 Processing ${pdfFiles.length} files | Workers: ${scaledWorkers} | Pool: ${workerThreadPool ? WORKER_THREAD_POOL_SIZE : 0} threads`);
  const limit = pLimit(scaledWorkers);  // ⭐ Use dynamic concurrency
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
        // OPTIMIZATION 5: Batch validate records in parallel
        const filteredRecordsRaw = await batchValidateRecords(rawRecords, 100);


        // 👇 --- ADD THIS DE-DUPLICATION BLOCK --- 👇
        const uniqueRecords = [];
        const seenMobiles = new Set();
        for (const record of filteredRecordsRaw) {
          if (!seenMobiles.has(record.mobile)) {
            uniqueRecords.push(record);
            seenMobiles.add(record.mobile);
          }
        }
        const filteredRecords = uniqueRecords; // Use the de-duplicated list
        // 👆 --- END OF NEW BLOCK --- 👆
        console.log('📋 Extracted entities:', JSON.stringify(entities.map(e => ({
          type: e.type,
          value: e.value.substring(0, 30),
          startIndex: e.startIndex
        })), null, 2));

        const logData = JSON.stringify(entities.map(e => ({
          type: e.type,
          value: e.value.substring(0, 30),
          startIndex: e.startIndex
        })), null, 2);

        fs.writeFileSync('./entity-debug.json', logData);
        console.log('✅ Entities written to entity-debug.json');


        rawRecords.forEach(r => r.file_name = file.name);
        filteredRecords.forEach(r => r.file_name = file.name); // This now uses the unique list

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