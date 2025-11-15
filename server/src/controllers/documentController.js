// server/src/controllers/documentController.js
// FIXED VERSION - Parallel Processing

import path from "path";
import crypto from 'crypto';
import { processPDFs } from "../services/documentProcessor.js";
import { PreProcessRecord } from "../models/PreProcessRecord.js";
import { PostProcessRecord } from "../models/PostProcessRecord.js";
import { RemovedRecord } from "../models/RemovedRecord.js";
import { FileMetadata } from "../models/FileMetadata.js";
import { CloudStorageService } from "../services/cloudStorage.js";
import { Collection } from "../models/Collection.js";
import { createObjectCsvWriter } from "csv-writer";
import archiver from "archiver";
import fs from "fs";
import xlsx from "xlsx";
import { saveFiles, createZip } from '../utils/fileHelpers.js';
import { broadcast } from '../services/websocket.js';
import logger from '../utils/logger.js';
import batchQueueManager from '../services/batchQueueManager.js';
import { config } from '../config/index.js';

// Listen to queue events to broadcast queue state to clients
batchQueueManager.on('batch:enqueued', ({ batchId, collectionId, fileCount, position, estimatedWaitTime, totalQueued, queueStatus }) => {
  try {
    // Include queue metadata to help clients show position and ETA
    const payload = { type: 'BATCH_QUEUED', batchId, collectionId, fileCount, position, estimatedWaitTime, totalQueued, queueStatus, timestamp: new Date().toISOString() };
    broadcast(payload);
    logger.info('Broadcasted BATCH_QUEUED', { batchId, position, estimatedWaitTime, totalQueued });
  } catch (e) {
    logger.warn('Failed to broadcast BATCH_QUEUED', e && e.message);
  }
});

batchQueueManager.on('batch:dequeued', async ({ batchId, collectionId, fileCount, startedAt, totalQueued, activeCount, availableSlots }) => {
  try {
    // when the queue manager starts a batch, emit both a BATCH_DEQUEUED and the official started event
    // Attempt to fetch file metadata for richer client payloads (best-effort)
    let files = [];
    try {
      files = await FileMetadata.findByBatchId(batchId);
    } catch (e) {
      logger.warn('Unable to fetch FileMetadata for dequeued batch', e && e.message);
      files = [];
    }

    const fc = typeof fileCount === 'number' ? fileCount : (Array.isArray(files) ? files.length : undefined);

    // Use the startedAt provided by the queue manager so timestamps are consistent
    const started = startedAt || new Date().toISOString();

    const payload = { batchId, collectionId, fileCount: fc, files, startedAt: started, totalQueued, activeCount, availableSlots };

    try {
      // Broadcast a specific dequeued event first
      broadcast({ type: 'BATCH_DEQUEUED', ...payload, timestamp: new Date().toISOString() });
      logger.info('Broadcasted BATCH_DEQUEUED', { batchId, totalQueued, activeCount, availableSlots });
    } catch (e) {
      logger.warn('Failed to broadcast BATCH_DEQUEUED', e && e.message);
    }

    try {
      // Backwards-compatible started event
      broadcast({ type: 'BATCH_PROCESSING_STARTED', ...payload, timestamp: new Date().toISOString() });
      logger.info('Broadcasted BATCH_PROCESSING_STARTED from queue', { batchId, totalQueued, activeCount, availableSlots });
    } catch (e) {
      logger.warn('Failed to broadcast BATCH_PROCESSING_STARTED from queue', e && e.message);
    }
  } catch (e) {
    logger.warn('Failed in batch:dequeued handler', e && e.message);
  }
});

batchQueueManager.on('batch:completed', ({ batchId, collectionId, totalQueued, activeCount, availableSlots }) => {
  try {
    const payload = { type: 'BATCH_QUEUE_COMPLETED', batchId, collectionId, totalQueued, activeCount, availableSlots, timestamp: new Date().toISOString() };
    broadcast(payload);
    logger.info('Broadcasted BATCH_QUEUE_COMPLETED', { batchId, collectionId, totalQueued, activeCount, availableSlots });
  } catch (e) {
    logger.warn('Failed to broadcast BATCH_QUEUE_COMPLETED', e && e.message);
  }
});

// Queue full: broadcast to clients so uploaders get immediate feedback
batchQueueManager.on('queue:full', ({ batchId, queueLength, maxLength, collectionId }) => {
  try {
    const payload = { type: 'QUEUE_FULL', batchId, collectionId, queueLength, maxLength, message: 'Server is at capacity. Please try again in a few minutes.', timestamp: new Date().toISOString() };
    broadcast(payload);
    logger.warn('Broadcasted QUEUE_FULL', { batchId, collectionId, queueLength, maxLength });
  } catch (e) {
    logger.warn('Failed to broadcast QUEUE_FULL', e && e.message);
  }
});

// Batch timeout: notify clients that a batch has been failed due to timeout
batchQueueManager.on('batch:timeout', async ({ batchId, timeoutMs }) => {
  try {
    // Mark files for this batch as failed to avoid leaving them stuck in 'processing'
    try {
      const files = await FileMetadata.findByBatchId(batchId);
      if (Array.isArray(files) && files.length > 0) {
        const updated = [];
        for (const meta of files) {
          try {
            const status = (meta.processing_status || '').toLowerCase();
            if (status === 'processing') {
              const latest = await FileMetadata.findById(meta.id);
              if (latest) {
                const changed = await latest.updateStatus('failed');
                updated.push(changed || latest);
              }
            } else {
              updated.push(meta);
            }
          } catch (e) {
            logger.warn('Failed to mark file as failed after batch timeout', { batchId, fileId: meta && meta.id, err: e && e.message });
          }
        }

        // Broadcast per-file FILES_PROCESSED events so UI updates deterministically
        try {
          const fileBroadcasts = (updated || []).map(async (metadata) => {
            if (!metadata) return null;
            const camel = normalizeMetadata(metadata);
            const cid = metadata.collection_id || metadata.collectionId || null;
            broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: cid, fileMetadata: camel, file_metadata: metadata });
          });
          await Promise.all(fileBroadcasts);
        } catch (e) {
          logger.warn('Failed to broadcast per-file FILES_PROCESSED after timeout', e && e.message);
        }
      }
    } catch (e) {
      logger.warn('Error while marking files failed on batch timeout', { batchId, err: e && e.message });
    }

    // Keep existing batch-level failure broadcast
    try {
      const payload = { type: 'BATCH_PROCESSING_FAILED', batchId, error: 'Batch processing timeout exceeded', timeoutMs, timestamp: new Date().toISOString() };
      broadcast(payload);
      logger.error('Broadcasted batch timeout failure', { batchId, timeoutMs });
    } catch (e) {
      logger.warn('Failed to broadcast batch timeout', e && e.message);
    }
  } catch (e) {
    logger.warn('Failed in batch:timeout handler', e && e.message);
  }
});

// Listen for position update events from the queue manager and forward to clients
batchQueueManager.on('batch:position-updated', ({ batchId, collectionId, position, estimatedWaitTime, totalQueued, reason }) => {
  try {
    const payload = { type: 'BATCH_QUEUE_POSITION_UPDATED', batchId, collectionId, position, estimatedWaitTime, totalQueued, reason, timestamp: new Date().toISOString() };
    broadcast(payload);
    logger.debug('Broadcasted BATCH_QUEUE_POSITION_UPDATED', { batchId, position, estimatedWaitTime, reason });
  } catch (e) {
    logger.warn('Failed to broadcast BATCH_QUEUE_POSITION_UPDATED', e && e.message);
  }
});

// Log document controller startup and queue configuration
try {
  logger.info('Document controller initialized with queue configuration', { maxConcurrentBatches: config.maxConcurrentBatches, enableQueueLogging: config.enableQueueLogging });
} catch (e) { /* ignore logging errors */ }

// Helper: normalize metadata to camelCase for client consumption while keeping snake_case fallback
const normalizeMetadata = (meta) => {
  if (!meta) return meta;
  // if meta is a plain object from DB (snake_case), map common fields
  const normalized = {
    id: meta.id,
    collectionId: meta.collection_id ?? meta.collectionId,
    originalFilename: meta.original_filename ?? meta.originalFilename,
    fileSize: meta.file_size ?? meta.fileSize,
    processingStatus: meta.processing_status ?? meta.processingStatus,
    cloudStoragePath: meta.cloud_storage_path ?? meta.cloudStoragePath,
    createdAt: meta.created_at ?? meta.createdAt,
    batchId: meta.batch_id ?? meta.batchId,
  };

  // copy any remaining keys that aren't explicitly normalized to preserve data
  Object.keys(meta).forEach((k) => {
    if (!Object.values(normalized).includes(meta[k]) && !Object.prototype.hasOwnProperty.call(normalized, k)) {
      // only add keys not already normalized (avoid collisions)
      if (!(k in normalized)) normalized[k] = meta[k];
    }
  });

  return normalized;
};

export const processDocuments = async (req, res) => {
  try {
    // Accept both 'pdfs' (server) and 'files' (tests/other tooling) to be compatible
    const files = req.files?.pdfs || req.files?.files;
    const { collectionId } = req.body;

    // normalize collectionId once
    const collectionIdNum = parseInt(collectionId, 10);

    if (!files) {
      return res.status(400).json({ error: "No PDF files uploaded" });
    }

    if (!collectionId) {
      return res.status(400).json({ error: "Collection ID is required" });
    }

    // Validate parsed collection id is a finite number before proceeding.
    if (Number.isNaN(collectionIdNum) || !Number.isFinite(collectionIdNum)) {
      return res.status(400).json({ error: 'Invalid collection ID' });
    }

    const fileArray = Array.isArray(files) ? files : [files];

    // generate a unique batch id (use crypto.randomUUID when available)
    const batchId = (crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // include a startedAt timestamp so clients opening mid-batch can align elapsed time
    const startedAt = new Date().toISOString();

    // Check whether the queue can accept this new batch before creating DB records
    try {
      if (!batchQueueManager.canAcceptNewBatch()) {
        logger.warn('Upload rejected: queue at capacity before creating file metadata', { batchId, collectionId: collectionIdNum });
        // Notify uploader immediately
        try { broadcast({ type: 'QUEUE_FULL', batchId, collectionId: collectionIdNum, queueLength: batchQueueManager.queue.length, maxLength: batchQueueManager.MAX_QUEUE_LENGTH, message: 'Server is at capacity. Please try again in a few minutes.' }) } catch (e) {}
        return res.status(503).json({ success: false, error: 'Server is at capacity. Please try again in a few minutes.', queueFull: true });
      }
    } catch (e) {
      logger.warn('Failed to check queue capacity; proceeding with enqueue', e && e.message);
    }

    // Step 1: Create initial metadata records
    const initialMetadataPromises = fileArray.map(file => 
      FileMetadata.create({
        collection_id: collectionIdNum,
        original_filename: file.name,
        file_size: file.size,
        processing_status: 'uploading', // Start with 'uploading' status
        batch_id: batchId,
      })
    );
    const fileMetadatas = await Promise.all(initialMetadataPromises);

    // Step 2: Upload raw files to GCS and update metadata with the raw path
    const uploadAndUpdatePromises = fileMetadatas.map(async (metadata, index) => {
      const file = fileArray[index];
      try {
        const rawGcsPath = await CloudStorageService.uploadRawFile(file, collectionIdNum, batchId);
        // This is a bit inefficient (N+1 updates), but necessary to associate path with record.
        // Could be optimized with a bulk update if the model supported it.
        await metadata.updateCloudStoragePathRaw(rawGcsPath);
        await metadata.updateStatus('processing'); // Now ready for processing
        return metadata;
      } catch (uploadError) {
        logger.error(`Failed to upload raw file ${file.name} for batch ${batchId}.`, uploadError);
        await metadata.updateStatus('failed'); // Mark as failed if upload fails
        return null; // Indicates failure
      }
    });

    const updatedMetadatas = (await Promise.all(uploadAndUpdatePromises)).filter(Boolean);

    // If all uploads failed, we can't proceed.
    if (updatedMetadatas.length === 0) {
      logger.error(`All file uploads failed for batch ${batchId}. Aborting enqueue.`);
      return res.status(500).json({ success: false, error: 'All file uploads failed. Cannot process batch.' });
    }

    // Enqueue the batch for processing via BatchQueueManager
    // Use the shared processor wrapper that adapts our processor to the queue manager
    const processorFunction = processBatchWrapper;

    let position;
    try {
      position = batchQueueManager.enqueue({ batchId, collectionId: collectionIdNum, fileArray, fileMetadatas, fileCount: fileArray.length, processorFunction });
      // Recompute effective position because enqueue may return a transient value
      // Ensure clients receive accurate position (0 = processing started)
      try {
        const recalculated = batchQueueManager.getQueuePosition(batchId);
        if (typeof recalculated === 'number') {
          position = recalculated;
        }
      } catch (e) {
        logger.warn('Unable to recalculate queue position after enqueue', e && e.message);
      }

      logger.info(`Enqueued batch ${batchId} collection ${collectionIdNum} files=${fileArray.length} position=${position}`);

      // Fetch overall queue status and include in response so clients get metadata (length, slots, averages)
      let queueStatus = null
      try {
        queueStatus = batchQueueManager.getQueueStatus()
      } catch (e) {
        logger.warn('Unable to fetch queue status after enqueue', e && e.message)
        queueStatus = null
      }

      if (position === -1) {
        // validation failure reported by queue manager
        logger.error(`Batch enqueue validation failed for batch ${batchId}`);
        // mark all created file metadata as failed to avoid leaving them stuck in 'processing'
        try {
          await Promise.all(fileMetadatas.map(async (m) => {
            try {
              const latest = await FileMetadata.findById(m.id);
              if (latest) await latest.updateStatus('failed');
            } catch (e) { /* best-effort */ }
          }));
        } catch (e) { /* ignore */ }
        // If the rejection was likely due to queue capacity, return 503 so clients can retry later
        try {
          const likelyQueueFull = (batchQueueManager.queue.length >= batchQueueManager.MAX_QUEUE_LENGTH && batchQueueManager.activeSlots.size >= batchQueueManager.maxConcurrentBatches);
          if (likelyQueueFull) {
            return res.status(503).json({ success: false, error: 'Server is at capacity. Please try again in a few minutes.', queueFull: true });
          }
        } catch (e) {
          // ignore and fallthrough to generic 500
        }
        return res.status(500).json({ success: false, error: 'Failed to enqueue batch for processing' });
      }
    } catch (e) {
      logger.error('Exception while enqueueing batch:', e && e.message);
      try {
        await Promise.all(fileMetadatas.map(async (m) => {
          try {
            const latest = await FileMetadata.findById(m.id);
            if (latest) await latest.updateStatus('failed');
          } catch (e) { /* best-effort */ }
        }));
      } catch (e) { /* ignore */ }
      return res.status(500).json({ success: false, error: 'Failed to enqueue batch for processing' });
    }

    // Respond to client with metadata, batchId and queue position (0 = processing, >0 = queued)
    const responsePayload = {
      success: true,
      batchId,
      files: fileMetadatas,
      position,
      message: position === 0 ? `Successfully uploaded ${fileArray.length} file(s). Processing started.` : `Successfully uploaded ${fileArray.length} file(s). Queued at position ${position}.`,
    }
    if (queueStatus) {
      responsePayload.queueLength = queueStatus.queueLength
      responsePayload.availableSlots = queueStatus.availableSlots
      responsePayload.averageWaitTimeSeconds = queueStatus.averageWaitTimeSeconds
      responsePayload.estimatedWaitTime = (typeof position === 'number') ? batchQueueManager.estimateWaitTime(position) : null
    }
    res.json(responsePayload)

  } catch (err) {
    logger.error("Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// FIXED VERSION: Parallel Processing
// ============================================
const processPDFFilesParallel = async (fileArray, collectionIdNum, fileMetadatas, batchId = null, startedAt = null) => {
  let progressInterval = null;
  try {
    // Download raw files from GCS to a temporary local directory
    const filesToProcess = [];
    for (const meta of fileMetadatas) {
        try {
            const tempPath = await CloudStorageService.downloadFile(meta.cloud_storage_path_raw);
            // Attach temporary info directly to the class instance to preserve its methods
            meta.tempPath = tempPath;
            meta.name = meta.original_filename;
            meta.mv = (newPath) => fs.promises.rename(tempPath, newPath);
            filesToProcess.push(meta);
        } catch (downloadError) {
            logger.error(`Failed to download raw file ${meta.original_filename} from ${meta.cloud_storage_path_raw}`, downloadError);
            await meta.updateStatus('failed');
        }
    }
    if (filesToProcess.length === 0) {
      logger.error(`Batch ${batchId} aborted: all raw file downloads failed.`);
      return; // All downloads failed, nothing to process
    }

    logger.info(`Starting parallel processing for ${filesToProcess.length} files...`);

    // Emit initial batch progress and start heartbeat
    try {
      // initial progress: 0%
      broadcast({ type: 'BATCH_PROCESSING_PROGRESS', batchId, collectionId: collectionIdNum, status: 'started', message: 'Processing PDFs with Document AI...', progress: 0, startedAt });
    } catch (e) {
      logger.warn('Unable to broadcast initial batch progress:', e && e.message);
    }

    // heartbeat: include numeric progress if we can compute it from DB via a single aggregate query
    // Use recursive setTimeout to avoid overlapping runs under load. Use a stopped guard for deterministic termination.
    let heartbeatInFlight = false;
    let stopped = false;
    const HEARTBEAT_INTERVAL = 15000;

    const runHeartbeat = async () => {
      try {
        if (stopped) return;
        if (heartbeatInFlight) return; // skip if previous run still in-flight
        heartbeatInFlight = true;
        let progress = undefined;
        try {
          const counts = await FileMetadata.countByStatusForBatch(batchId);
          const total = counts.total || 0;
          const processed = (counts.completed || 0) + (counts.failed || 0);
          if (total > 0) {
            progress = Math.round((processed / total) * 100);
          }
        } catch (e) {
          progress = undefined;
        }

        broadcast({ type: 'BATCH_PROCESSING_PROGRESS', batchId, collectionId: collectionIdNum, status: 'processing', message: 'Still processing...', timestamp: new Date().toISOString(), startedAt, progress });
      } catch (err) {
        logger.warn('Failed to broadcast heartbeat:', err && err.message);
      } finally {
        heartbeatInFlight = false;
        // schedule next heartbeat only if not stopped
        try {
          if (!stopped) {
            progressInterval = setTimeout(runHeartbeat, HEARTBEAT_INTERVAL);
          }
        } catch (e) {
          // ignore schedule errors
        }
      }
    };

    // start first heartbeat
    progressInterval = setTimeout(runHeartbeat, HEARTBEAT_INTERVAL);

    // STEP 1: Process ALL files at once with high concurrency
    const { allRawRecords, allFilteredRecords, allRemovedRecords, allPreProcessingJson, allPostProcessingJson } =
        await processPDFs(filesToProcess, 10, 4);

    const processingTimestamp = new Date().toISOString();
    
    // ⭐ OPTIMIZATION: Prepare ALL records at once
   const allPreProcessRecords = allRawRecords.map((record) => ({  
     collection_id: collectionIdNum,  
     full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),  
     mobile: record.mobile,  
     email: record.email,  
     address: record.address,  
     dateofbirth: record.dateofbirth,  
     landline: record.landline,  
     lastseen: record.lastseen,  
     file_name: record.file_name,  
     processing_timestamp: processingTimestamp  
   }));

    const allPostProcessRecords = allFilteredRecords.map((record) => ({
      collection_id: collectionIdNum,
      ...record,
      full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      processing_timestamp: processingTimestamp
    }));

    const allRemovedRecordsForDB = (allRemovedRecords || []).map((record) => ({
      collection_id: collectionIdNum,
      full_name: record.full_name,
      file_name: record.file_name,
      rejection_reason: record.rejection_reason,
      processing_timestamp: processingTimestamp
    }));

  logger.info(`Prepared: ${allPreProcessRecords.length} pre + ${allPostProcessRecords.length} post records`);
    // ⭐ KEY OPTIMIZATION: Insert in chunks to avoid hitting parameter limits and excessive memory
    logger.info(`Inserting into database with chunking...`);
  const CHUNK_SIZE = parseInt(process.env.DB_INSERT_CHUNK_SIZE, 10) || 5000;

    const chunkAndInsert = async (Model, records, label) => {
      if (!records || records.length === 0) return 0;
      let totalInserted = 0;

      // Determine columns per row from first record
      const columnsPerRow = (records[0] && typeof records[0] === 'object') ? Object.keys(records[0]).length : 8;
      const PARAM_LIMIT = 60000;

      // Compute an effective safe chunk size for this dataset
      const safeChunk = Math.max(1, Math.floor(PARAM_LIMIT / Math.max(columnsPerRow, 1)));
      let effectiveChunk = Math.min(CHUNK_SIZE, safeChunk);

      if (CHUNK_SIZE > safeChunk) {
        logger.warn(`Reducing chunk size from ${CHUNK_SIZE} to safe size ${effectiveChunk} to avoid DB parameter limits (${columnsPerRow} cols per row).`);
      }

      for (let i = 0; i < records.length; i += effectiveChunk) {
        const chunk = records.slice(i, i + effectiveChunk);
        const inserted = await Model.bulkCreate(chunk);
        const insertedCount = Array.isArray(inserted) ? inserted.length : (inserted.rowCount || 0);
        totalInserted += insertedCount;
        logger.info(`Inserted chunk ${Math.floor(i / effectiveChunk) + 1} for ${label}: ${insertedCount} rows`);
      }
      return totalInserted;
    };

    try {
        const insertedPreCount = await chunkAndInsert(PreProcessRecord, allPreProcessRecords, 'pre-process');
        const insertedPostCount = await chunkAndInsert(PostProcessRecord, allPostProcessRecords, 'post-process');
        const insertedRemovedCount = await chunkAndInsert(RemovedRecord, allRemovedRecordsForDB, 'removed');
        logger.info(`Inserted total: ${insertedPreCount} pre, ${insertedPostCount} post, ${insertedRemovedCount} removed records`);
    } catch (dbError) {
        logger.error('Database insert failed for batch.', dbError);
        for (const meta of fileMetadatas) {
            await meta.updateStatus('error_db_insert');
        }
        // Broadcast a failure event
        broadcast({ type: 'BATCH_PROCESSING_FAILED', batchId, collectionId: collectionIdNum, error: 'Database insert failed' });
        return; // Stop further processing for this batch
    }


    // After successful DB inserts, proceed with uploading processed files and deleting raw files.
    for (const meta of filesToProcess) {
        try {
            const preJson = allPreProcessingJson.find(j => j.file_name === meta.original_filename);
            const postJson = allPostProcessingJson.find(j => j.file_name === meta.original_filename);

            const processedFiles = [];
            if (preJson) {
              processedFiles.push({ name: `${meta.original_filename}.pre-processing.json`, content: JSON.stringify(preJson, null, 2), contentType: 'application/json' });
            }
            if (postJson) {
              processedFiles.push({ name: `${meta.original_filename}.post-processing.json`, content: JSON.stringify(postJson, null, 2), contentType: 'application/json' });
            }

            if (processedFiles.length > 0) {
              const processedGcsPaths = await CloudStorageService.uploadProcessedFiles(processedFiles, meta.collection_id, meta.batch_id);
              const processedDir = path.dirname(processedGcsPaths[0]);
              await meta.updateCloudStoragePathProcessed(processedDir);
            }

            // Now that DB and processed file uploads are successful, conditionally delete the raw file.
            if (config.deleteRawAfterProcess) {
                try {
                    await CloudStorageService.deleteFile(meta.cloud_storage_path_raw);
                    logger.info(`Successfully deleted raw PDF: ${meta.cloud_storage_path_raw}`);
                    // Nullify the path in the database after successful deletion
                    await meta.updateCloudStoragePathRaw(null);
                } catch (deleteError) {
                    logger.error(`Failed to delete raw PDF ${meta.cloud_storage_path_raw}. Please check GCS permissions.`, deleteError);
                    await meta.updateStatus('error_delete');
                }
            }
            await meta.updateStatus('completed');
        } catch (postProcessError) {
            logger.error(`Error during post-processing for file ${meta.original_filename}`, postProcessError);
            await meta.updateStatus('error_processed_upload');
        }
    }


    // Broadcast DB insert milestone
    try {
      // milestone: DB insert ~33%
      broadcast({ type: 'BATCH_PROCESSING_PROGRESS', batchId, collectionId: collectionIdNum, status: 'database_insert_complete', message: 'Records inserted into database', progress: 33, startedAt });
    } catch (e) {
      logger.warn('Unable to broadcast database insert milestone:', e && e.message);
    }

    // STEP 4: Broadcast completion
    // Broadcast batch completion (refresh file metadata so clients receive up-to-date objects)
    try {
      // completion: 100% - refresh metadata so clients receive up-to-date objects
      const refreshedMetadatas = await Promise.all(fileMetadatas.map(m => FileMetadata.findById(m.id)));
      broadcast({ type: 'BATCH_PROCESSING_COMPLETED', batchId, collectionId: collectionIdNum, fileCount: fileMetadatas.length, files: refreshedMetadatas, message: 'Batch processing completed successfully', progress: 100, startedAt });
    } catch (e) {
      logger.warn('Unable to broadcast batch completion:', e && e.message);
    }

    // Reload each metadata from DB before broadcasting to avoid stale processing_status
    const broadcastPromises = fileMetadatas.map(async (metadata) => {
      try {
        const fresh = await FileMetadata.findById(metadata.id);
        const payloadMeta = fresh || metadata;
        const camel = normalizeMetadata(payloadMeta);
        const cid = payloadMeta ? (payloadMeta.collection_id || payloadMeta.collectionId) : collectionIdNum;
        // include both camelCase and snake_case for backward compatibility
        broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: cid, fileMetadata: camel, file_metadata: payloadMeta });
      } catch (e) {
        // fallback to broadcasting existing object
        try {
          const camel = normalizeMetadata(metadata);
          broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: metadata.collection_id, fileMetadata: camel, file_metadata: metadata });
        } catch (err) {
          logger.warn('Unable to broadcast FILES_PROCESSED for metadata', metadata && metadata.id, err && err.message);
        }
      }
    });

    await Promise.all(broadcastPromises);
    logger.info('Broadcast complete events');

    logger.info(`All ${fileArray.length} files processed successfully!`);

  } catch (error) {
    logger.error("Error in processPDFFilesParallel:", error);

    // Only mark files that are still in 'processing' as 'failed'. Do not overwrite already-completed files.
    const updatedMetadatas = await Promise.all(fileMetadatas.map(async (metadata) => {
      try {
        const latest = await FileMetadata.findById(metadata.id);
        if (!latest) return null;
        const status = (latest.processing_status || '').toLowerCase();
        if (status === 'processing') {
          try {
            return await latest.updateStatus('failed');
          } catch (uErr) {
            logger.error('Error updating metadata to failed for', latest.id, uErr && uErr.message);
            return latest;
          }
        }
        // keep completed/failed as-is
        return latest;
      } catch (err) {
        logger.error(`Error fetching latest metadata for id ${metadata.id}:`, err && err.message);
        return null;
      }
    }));

    // Determine if this is a partial failure (some files completed)
    const completedCount = (updatedMetadatas || []).filter(m => m && (m.processing_status || '').toLowerCase() === 'completed').length;
    const anyCompleted = completedCount > 0;

    // Broadcast batch failure using updated metadata. If some files succeeded, mark partial:true
    try {
      broadcast({ type: 'BATCH_PROCESSING_FAILED', batchId, collectionId: collectionIdNum, fileCount: fileMetadatas.length, error: error?.message, files: updatedMetadatas, startedAt, partial: anyCompleted });
      } catch (e) {
      logger.warn('Unable to broadcast batch failure:', e && e.message);
    }

    // Broadcast individual FILES_PROCESSED events with normalized payloads
    try {
      const broadcastPromises = (updatedMetadatas || []).map(async (metadata) => {
        if (!metadata) return null;
        const camel = normalizeMetadata(metadata);
        // include both camelCase and snake_case for backward compatibility
        broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: metadata.collection_id || metadata.collectionId, fileMetadata: camel, file_metadata: metadata });
      });
      await Promise.all(broadcastPromises);
    } catch (e) {
      logger.warn('Unable to broadcast individual failure events:', e && e.message);
    }

    throw error;
  } finally {
    // Ensure heartbeat interval is cleared on all exits (success, partial failure, exception)
    try {
      // stop future heartbeats deterministically
      try { stopped = true; } catch (e) {}
      if (progressInterval) clearTimeout(progressInterval);
    } catch (e) {
      logger.warn('Error clearing progressInterval:', e && e.message);
    }
  }
};


// Keep old sequential version as backup (not used)
// const processPDFFilesSequential = async (fileArray, collectionId, fileMetadatas) => {
//   console.warn("⚠️  Using sequential processing (slow). Use processPDFFilesParallel instead.");
  
//   for (let i = 0; i < fileArray.length; i++) {
//     const file = fileArray[i];
//     let fileMetadata = fileMetadatas[i];
//     try {
//       const sessionDir = path.join(process.cwd(), "output", `session_${Date.now()}`);
//       fs.mkdirSync(sessionDir, { recursive: true });

//       const {
//         allRawRecords,
//         allFilteredRecords,
//       } = await processPDFs([file], sessionDir);

//       const processingTimestamp = new Date().toISOString();

//       const preProcessRecords = allRawRecords.map(record => ({
//         collection_id: parseInt(collectionId),
//         ...record,
//         processing_timestamp: processingTimestamp
//       }));

//       const postProcessRecords = allFilteredRecords.map(record => ({
//         collection_id: parseInt(collectionId),
//         ...record,
//         processing_timestamp: processingTimestamp
//       }));

//       await PreProcessRecord.bulkCreate(preProcessRecords);
//       await PostProcessRecord.bulkCreate(postProcessRecords);

//       const uploadedFile = await CloudStorageService.uploadProcessedFiles([file], collectionId);
//       fileMetadata = await fileMetadata.updateStatus('completed');
//       await fileMetadata.updateCloudStoragePath(uploadedFile[0].url);

//       broadcast({ type: 'FILES_PROCESSED', collectionId: fileMetadata.collection_id, fileMetadata });

//     } catch (error) {
//       console.error(`🔥 Error processing file ${file.name}:`, error);
//       fileMetadata = await fileMetadata.updateStatus('failed');
//       broadcast({ type: 'FILES_PROCESSED', collectionId: fileMetadata.collection_id, fileMetadata });
//     }
//   }
// };

export const updateUploadProgress = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { progress } = req.body;
    const fileMetadata = await FileMetadata.findById(fileId);
    if (!fileMetadata) {
      return res.status(404).json({ error: 'File not found' });
    }
  await fileMetadata.updateUploadProgress(progress);
  // include collectionId and batchId to help clients filter events deterministically
  broadcast({ type: 'UPLOAD_PROGRESS', fileId, progress, collectionId: fileMetadata.collection_id, batchId: fileMetadata.batch_id || null });
    res.json({ success: true });
  } catch (err) {
    logger.error('Error in updateUploadProgress:', err);
    res.status(500).json({ error: err.message });
  }
};

const reprocessLocks = new Set();

export const reprocessFile = async (req, res) => {
  const { fileId } = req.params;
  
  if (reprocessLocks.has(fileId)) {
    return res.status(409).json({ error: 'Reprocessing for this file is already in progress.' });
  }

  try {
    reprocessLocks.add(fileId);

    const fileMetadata = await FileMetadata.findById(fileId);
    if (!fileMetadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!fileMetadata.cloud_storage_path_raw) {
        return res.status(409).json({ error: 'Raw PDF path not found - cannot reprocess.' });
    }

    const rawFileExists = await CloudStorageService.fileExists(fileMetadata.cloud_storage_path_raw);
    if (!rawFileExists) {
      return res.status(409).json({ error: 'Raw PDF deleted - cannot reprocess.' });
    }
    
    await fileMetadata.updateStatus('reprocessing');
    broadcast({ type: 'FILE_REPROCESSING_STARTED', fileId: fileMetadata.id, collectionId: fileMetadata.collection_id });


    const tempPath = await CloudStorageService.downloadFile(fileMetadata.cloud_storage_path_raw);
    const file = {
      name: fileMetadata.original_filename,
      mv: async (path) => fs.promises.rename(tempPath, path),
    };

    const {
      allRawRecords,
      allFilteredRecords,
      allRemovedRecords,
      allPreProcessingJson,
      allPostProcessingJson
    } = await processPDFs([file]);

    // Clear old data
    await PreProcessRecord.deleteByFileName(fileMetadata.original_filename);
    await PostProcessRecord.deleteByFileName(fileMetadata.original_filename);
    await RemovedRecord.deleteByFileName(fileMetadata.original_filename);

    const processingTimestamp = new Date().toISOString();
    const collectionIdNum = fileMetadata.collection_id;

    // Insert new data (logic copied and adapted from main processing flow)
    const allPreProcessRecords = allRawRecords.map((record) => ({
        collection_id: collectionIdNum,
        full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
        ...record,
        processing_timestamp: processingTimestamp
    }));

    const allPostProcessRecords = allFilteredRecords.map((record) => ({
        collection_id: collectionIdNum,
        ...record,
        full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
        processing_timestamp: processingTimestamp
    }));
    
    const allRemovedRecordsForDB = (allRemovedRecords || []).map((record) => ({
        collection_id: collectionIdNum,
        ...record,
        processing_timestamp: processingTimestamp
    }));

    await PreProcessRecord.bulkCreate(allPreProcessRecords);
    await PostProcessRecord.bulkCreate(allPostProcessRecords);
    await RemovedRecord.bulkCreate(allRemovedRecordsForDB);

    // Upload new processed files
    const processedFiles = [];
    if (allPreProcessingJson[0]) {
      processedFiles.push({ name: `${file.name}.pre-processing.json`, content: JSON.stringify(allPreProcessingJson[0], null, 2), contentType: 'application/json' });
    }
    if (allPostProcessingJson[0]) {
      processedFiles.push({ name: `${file.name}.post-processing.json`, content: JSON.stringify(allPostProcessingJson[0], null, 2), contentType: 'application/json' });
    }

    if (processedFiles.length > 0) {
      const processedGcsPaths = await CloudStorageService.uploadProcessedFiles(processedFiles, fileMetadata.collection_id, fileMetadata.batch_id);
      const processedDir = path.dirname(processedGcsPaths[0]);
      await fileMetadata.updateCloudStoragePathProcessed(processedDir);
    }

    await fileMetadata.updateStatus('completed');
    const finalMetadata = await FileMetadata.findById(fileId);

    broadcast({ type: 'FILE_REPROCESSED', collectionId: fileMetadata.collection_id, fileId: fileMetadata.id, fileMetadata: finalMetadata });

    res.json({ success: true, message: `File ${fileId} has been reprocessed.` });

  } catch (err) {
    logger.error('Error in reprocessFile:', err);
    const fileMetadata = await FileMetadata.findById(fileId);
    if(fileMetadata) await fileMetadata.updateStatus('failed');
    broadcast({ type: 'FILE_REPROCESSING_FAILED', fileId: fileId });
    res.status(500).json({ error: err.message });
  } finally {
    reprocessLocks.delete(fileId);
  }
};

export const downloadFile = (req, res) => {
    const { session, file } = req.query;
    if (!session || !file) {
        return res.status(400).json({ error: "Session and file are required for download." });
    }
    const filePath = path.join(process.cwd(), "output", session, file);
    res.download(filePath, (err) => {
      if (err) {
        logger.error("Error downloading file:", err);
        res.status(500).json({ error: "Could not download the file." });
      }
    });
};

// FIXED: Excel Download with Proper Formatting

const downloadCollectionFile = async (req, res, fileType) => {
  try {
    const { collectionId } = req.params;
    const { type } = req.query;

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    let records;
    if (type === 'post') {
      records = await PostProcessRecord.findAll(collectionId);
    } else {
      records = await PreProcessRecord.findAll(collectionId);
    }

    if (!records || records.length === 0) {
      return res.status(404).json({ error: "No records found" });
    }

  logger.info(`Exporting ${fileType.toUpperCase()}: ${records.length} records`);

    const tempDir = path.join(process.cwd(), "temp", `collection-${collectionId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const fileName = `${type === 'post' ? 'post' : 'pre'}-process.${fileType}`;
    const filePath = path.join(tempDir, fileName);

    if (fileType === 'xlsx') {
      // ⭐ FORMAT RECORDS: Convert all fields to strings to preserve formatting
      const formattedRecords = records.map(record => {
        const formatted = {};
        for (const [key, value] of Object.entries(record)) {
          // Convert all values to strings to prevent Excel formatting issues
          if (value === null || value === undefined) {
            formatted[key] = '';
          } else if (typeof value === 'number') {
            // Force numbers to be strings (prevent scientific notation for mobile, prevent #### for dates)
            formatted[key] = String(value);
          } else {
            formatted[key] = String(value);
          }
        }
        return formatted;
      });

      // Create worksheet with formatted data
      const worksheet = xlsx.utils.json_to_sheet(formattedRecords);

      // ⭐ SET COLUMN WIDTHS: Auto-fit columns
      const columnWidths = {};
      const headers = Object.keys(formattedRecords[0] || {});
      
      headers.forEach(header => {
        // Min width 12, max width 30
        const maxLength = Math.max(
          header.length,
          Math.max(
            ...formattedRecords.map(r => String(r[header] || '').length)
          )
        );
        columnWidths[header] = { wch: Math.min(Math.max(maxLength + 2, 12), 30) };
      });

      worksheet['!cols'] = headers.map(h => columnWidths[h] || { wch: 12 });

      // Create workbook and add worksheet
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, type === 'post' ? 'Post-Process' : 'Pre-Process');

      // Write file
      xlsx.writeFile(workbook, filePath);
  logger.info(`Created ${fileName}: ${fs.statSync(filePath).size} bytes`);

    } else {
      // CSV export
      const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: Object.keys(records[0] || {}).map(key => ({ id: key, title: key }))
      });
      await csvWriter.writeRecords(records);
  logger.info(`Created ${fileName}: ${fs.statSync(filePath).size} bytes`);
    }

    // Download file
      res.download(filePath, `${collection.name}-${fileName}`, (err) => {
      if (err) {
        logger.error("Error downloading file:", err.message);
      } else {
        logger.info(`Downloaded ${fileName}`);
      }
      
      // Cleanup
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        logger.warn(`Cleanup error: ${cleanupErr.message}`);
      }
    });

    } catch (err) {
    logger.error(`Error in downloadCollectionFile:`, err);
    res.status(500).json({ error: err.message });
  }
};

// Export functions that call this
export const downloadCollectionCsvs = (req, res) => downloadCollectionFile(req, res, 'csv');
export const downloadCollectionExcels = (req, res) => downloadCollectionFile(req, res, 'xlsx');

export const downloadCollectionSummary = async (req, res) => {
  try {
    const { collectionId } = req.params;

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    // Query counts in parallel
    const [totalCount, filteredCount, removedCount] = await Promise.all([
      PreProcessRecord.count(collectionId),
      PostProcessRecord.count(collectionId),
      RemovedRecord.count(collectionId),
    ]);

    // Fetch removed records details
    const removedRecords = await RemovedRecord.findAll(collectionId);

    // Build text content
    const lines = [];
    lines.push(`Total Records: ${totalCount}`);
    lines.push(`Filtered Records: ${filteredCount}`);
    lines.push(`Removed Records: ${removedCount}`);
    lines.push('');
    lines.push('Removed Records Details:');
    lines.push('ID, Name, Filename, Reason');

    for (const record of removedRecords) {
      lines.push(`${record.id}, ${record.full_name || ''}, ${record.file_name || ''}, ${record.rejection_reason || ''}`);
    }

    const textContent = lines.join('\n');

    const tempDir = path.join(process.cwd(), "temp", `collection-${collectionId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Use a unique temp filename to avoid race conditions
    const uniqueSuffix = Date.now();
    const fileName = `summary-${uniqueSuffix}.txt`;
    const filePath = path.join(tempDir, fileName);

    // Helper to escape CSV-like fields and normalize newlines
    const escapeField = (val) => {
      if (val === null || val === undefined) return '""';
      let s = String(val);
      // normalize newlines to a single space
      s = s.replace(/\r\n|\r|\n/g, ' ');
      // escape double quotes by doubling them
      s = s.replace(/"/g, '""');
      return `"${s}"`;
    };

    // Rebuild lines with escaped fields for removed records
    const headerLines = [];
    headerLines.push(`Total Records: ${totalCount}`);
    headerLines.push(`Filtered Records: ${filteredCount}`);
    headerLines.push(`Removed Records: ${removedCount}`);
    headerLines.push('');
    headerLines.push('Removed Records Details:');
    headerLines.push('ID, Name, Filename, Reason');

    const recordLines = (removedRecords || []).map(record => {
      const id = escapeField(record.id);
      const name = escapeField(record.full_name || '');
      const fname = escapeField(record.file_name || '');
      const reason = escapeField(record.rejection_reason || '');
      return `${id}, ${name}, ${fname}, ${reason}`;
    });

    const finalText = [...headerLines, ...recordLines].join('\n');

    // Write file asynchronously to avoid blocking the event loop
    await fs.promises.writeFile(filePath, finalText, 'utf8');

    res.download(filePath, `${collection.name}-summary.txt`, (err) => {
      if (err) {
        logger.error("Error downloading summary file:", err.message);
      } else {
        logger.info(`Downloaded ${fileName}`);
      }

      // Cleanup the uniquely named temp file
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        logger.warn(`Cleanup error: ${cleanupErr.message}`);
      }
    });

  } catch (err) {
    logger.error(`Error in downloadCollectionSummary:`, err);
    res.status(500).json({ error: err.message });
  }
};


export const getUploadedFiles = async (req, res) => {
  try {
    const { collectionId } = req.params;
    const files = await FileMetadata.findAll(collectionId);
    res.json({ success: true, data: files });
  } catch (err) {
    logger.error('Error in getUploadedFiles:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getBatchStatus = async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });

    const counts = await FileMetadata.countByStatusForBatch(batchId);
    const files = await FileMetadata.findByBatchId(batchId);

    // Derive a startedAt value from the oldest file created_at in this batch (best-effort)
    let startedAt = null;
    try {
      if (files && files.length > 0) {
        const times = files.map(f => new Date(f.created_at).getTime()).filter(t => !Number.isNaN(t));
        if (times.length > 0) {
          const minTs = Math.min(...times);
          startedAt = new Date(minTs).toISOString();
        }
      }
    } catch (e) {
      // ignore and return null startedAt
      startedAt = null;
    }

    return res.json({ success: true, batchId, counts, files, startedAt });
  } catch (err) {
    logger.error('Error in getBatchStatus:', err);
    res.status(500).json({ error: err.message });
  }
};

// Adapter wrapper so the BatchQueueManager can call the processor with a single object argument.
// This wrapper preserves logging, error propagation, and ensures the returned promise reflects
// the underlying processing result so the queue manager can release slots appropriately.
const processBatchWrapper = async ({ fileArray, collectionId, fileMetadatas, batchId, startedAt }) => {
  try {
    logger.info(`processBatchWrapper: starting batch=${batchId} collection=${collectionId} fileCount=${Array.isArray(fileArray) ? fileArray.length : 0}`);
    const result = await processPDFFilesParallel(fileArray, collectionId, fileMetadatas, batchId, startedAt);
    logger.info(`processBatchWrapper: completed batch=${batchId}`);
    return result;
  } catch (err) {
    logger.error(`processBatchWrapper: error for batch=${batchId}:`, err && err.message);
    // re-throw so the queue manager can catch and release slots
    throw err;
  }
};

// Monitoring endpoint: return queue status from BatchQueueManager
export const getQueueStatus = async (req, res) => {
  try {
    const status = batchQueueManager.getQueueStatus();
    return res.json({ success: true, status });
  } catch (err) {
    logger.error('Error in getQueueStatus:', err && err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};