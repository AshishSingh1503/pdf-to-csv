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

export const processDocuments = async (req, res) => {
  try {
    const files = req.files?.pdfs;
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

    const fileMetadataPromises = fileArray.map(file => {
      return FileMetadata.create({
        collection_id: collectionIdNum,
        original_filename: file.name,
        file_size: file.size,
        processing_status: 'processing',
        batch_id: batchId,
      });
    });
    const fileMetadatas = await Promise.all(fileMetadataPromises);

    res.json({
      success: true,
      files: fileMetadatas,
      message: `Successfully uploaded ${fileArray.length} file(s). Processing in background.`,
    });

    // Emit batch start event (include startedAt to help clients show elapsed time accurately)
    broadcast({
      type: 'BATCH_PROCESSING_STARTED',
      batchId,
      collectionId: collectionIdNum,
      fileCount: fileArray.length,
      files: fileMetadatas,
      startedAt
    });

    // FIXED: Process all files in the background in PARALLEL
    processPDFFilesParallel(fileArray, collectionIdNum, fileMetadatas, batchId, startedAt);

  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// FIXED VERSION: Parallel Processing
// ============================================
const processPDFFilesParallel = async (fileArray, collectionIdNum, fileMetadatas, batchId = null, startedAt = null) => {
  let progressInterval = null;
  try {
    console.log(`📊 Starting parallel processing for ${fileArray.length} files...`);

    // Emit initial batch progress and start heartbeat
    try {
      // initial progress: 0%
      broadcast({ type: 'BATCH_PROCESSING_PROGRESS', batchId, collectionId: collectionIdNum, status: 'started', message: 'Processing PDFs with Document AI...', progress: 0, startedAt });
    } catch (e) {
      console.warn('⚠️  Unable to broadcast initial batch progress:', e && e.message);
    }

    // heartbeat: include numeric progress if we can compute it from DB via a single aggregate query
    progressInterval = setInterval(async () => {
      try {
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
        console.warn('⚠️  Failed to broadcast heartbeat:', err && err.message);
      }
    }, 15000);

    // STEP 1: Process ALL files at once with high concurrency
    const { allRawRecords, allFilteredRecords, allRemovedRecords } = 
      await processPDFs(fileArray, 10, 4);

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

    console.log(`📦 Prepared: ${allPreProcessRecords.length} pre + ${allPostProcessRecords.length} post records`);

    // ⭐ KEY OPTIMIZATION: Insert ALL at once (uses only 2 connections!)
    console.log(`💾 Inserting into database...`);
    // Guard bulkCreate calls to avoid ORM/DB edge cases with empty arrays
    const insertedPre = (allPreProcessRecords && allPreProcessRecords.length > 0) ? await PreProcessRecord.bulkCreate(allPreProcessRecords) : [];
    const insertedPost = (allPostProcessRecords && allPostProcessRecords.length > 0) ? await PostProcessRecord.bulkCreate(allPostProcessRecords) : [];
    const insertedRemoved = (allRemovedRecordsForDB && allRemovedRecordsForDB.length > 0) ? await RemovedRecord.bulkCreate(allRemovedRecordsForDB) : [];

    console.log(`✅ Inserted: ${insertedPre.length} pre, ${insertedPost.length} post, ${insertedRemoved.length} removed records`);

    // Broadcast DB insert milestone
    try {
      // milestone: DB insert ~33%
      broadcast({ type: 'BATCH_PROCESSING_PROGRESS', batchId, collectionId: collectionIdNum, status: 'database_insert_complete', message: 'Records inserted into database', progress: 33, startedAt });
    } catch (e) {
      console.warn('⚠️  Unable to broadcast database insert milestone:', e && e.message);
    }

    // NOTE: Defer marking files as 'completed' until after each successful upload
    // This prevents temporary 'completed' state before uploads finish.

    // STEP 3: Upload files to cloud in parallel
    const uploadPromises = fileArray.map(async (file, idx) => {
      try {
        const uploadedFiles = await CloudStorageService.uploadProcessedFiles([file], collectionIdNum);
        // uploadedFiles may be an array (common) or an object. Guard both shapes.
        if (fileMetadatas[idx]) {
          let uploadedUrl = null;
          if (Array.isArray(uploadedFiles) && uploadedFiles.length > 0 && uploadedFiles[0] && uploadedFiles[0].url) {
            uploadedUrl = uploadedFiles[0].url;
          } else if (uploadedFiles && typeof uploadedFiles === 'object' && uploadedFiles.url) {
            uploadedUrl = uploadedFiles.url;
          }

          const ok = !!uploadedUrl;
          if (ok) {
            await fileMetadatas[idx].updateCloudStoragePath(uploadedUrl);
            // mark this file as completed now that upload succeeded
            try {
              await fileMetadatas[idx].updateStatus('completed');
              return uploadedFiles;
            } catch (statusErr) {
              // If we fail to mark as completed, consider this file failed so it doesn't stay 'processing'
              console.warn('⚠️  Failed to update file status to completed for', fileMetadatas[idx].id, statusErr && statusErr.message);
              try {
                await fileMetadatas[idx].updateStatus('failed');
              } catch (failedErr) {
                console.error('❌ Also failed to mark file as failed for', fileMetadatas[idx].id, failedErr && failedErr.message);
              }
              return null;
            }
          } else {
            // Treat missing URL as a failed upload. Do not update DB here; let the centralized handler mark failed files
            return null;
          }
        }
      } catch (err) {
        console.error(`❌ Error uploading file ${file.name}:`, err);
        return null;
      }
    });

    const uploadResults = await Promise.all(uploadPromises);
    const succeededCount = uploadResults.filter(r => r).length;
    console.log(`✅ Uploaded ${succeededCount} files to cloud`);

    // If any upload failed, mark files as failed and emit batch failure
    const anyUploadFailed = uploadResults.some(r => !r);
    if (anyUploadFailed) {
      console.error('❌ One or more uploads failed for this batch. Marking failed files only.');

      // Determine which indices failed
      const failedIndices = uploadResults.map((r, i) => (!r ? i : -1)).filter(i => i >= 0);

      // Update only failed file metadata to 'failed' (skip if already failed)
      const failedUpdatePromises = failedIndices.map(async (idx) => {
        const metadata = fileMetadatas[idx];
        if (!metadata) return null;
        try {
          const latest = await FileMetadata.findById(metadata.id);
          if (!latest) return null;
          if ((latest.processing_status || '').toLowerCase() === 'failed') return latest;
          // mark as failed
          return await latest.updateStatus('failed');
        } catch (err) {
          console.error('❌ Error marking metadata as failed for index', idx, err);
          return null;
        }
      });
      const updatedFailedMetadatas = await Promise.all(failedUpdatePromises);

      // Refresh current metadata states (mix of completed and failed)
      const currentMetadatas = await Promise.all(fileMetadatas.map(async (m) => {
        try { return await FileMetadata.findById(m.id); } catch (e) { return m; }
      }));

      // Ensure no file is still in 'processing' state - convert to failed if found
      for (let i = 0; i < currentMetadatas.length; i++) {
        const cm = currentMetadatas[i];
        if (!cm) continue;
        if ((cm.processing_status || '').toLowerCase() === 'processing') {
          try {
            currentMetadatas[i] = await cm.updateStatus('failed');
          } catch (e) {
            console.warn('⚠️ Failed to flip processing->failed for', cm.id, e && e.message);
          }
        }
      }

      // Broadcast failure milestone with partial flag
      try {
        broadcast({ type: 'BATCH_PROCESSING_FAILED', batchId, collectionId: collectionIdNum, fileCount: fileMetadatas.length, error: 'One or more uploads failed', partial: true, files: currentMetadatas, startedAt });
      } catch (e) {
        console.warn('⚠️  Unable to broadcast cloud upload failure milestone:', e && e.message);
      }

      // Emit FILES_PROCESSED for each file with its current metadata so UI can update individual statuses
      try {
        const failureBroadcasts = (currentMetadatas || []).map(async (metadata) => {
          const cid = metadata ? metadata.collection_id : collectionIdNum;
          broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: cid, fileMetadata: metadata });
        });
        await Promise.all(failureBroadcasts);
      } catch (e) {
        console.warn('⚠️  Unable to broadcast individual file statuses after partial failure:', e && e.message);
      }

      return;
    }

    // Broadcast cloud upload milestone
    try {
      // milestone: cloud upload ~66%
      broadcast({ type: 'BATCH_PROCESSING_PROGRESS', batchId, collectionId: collectionIdNum, status: 'cloud_upload_complete', message: 'Files uploaded to cloud storage', progress: 66, startedAt });
    } catch (e) {
      console.warn('⚠️  Unable to broadcast cloud upload milestone:', e && e.message);
    }

    // STEP 4: Broadcast completion
    // Broadcast batch completion (refresh file metadata so clients receive up-to-date objects)
    try {
      // completion: 100% - refresh metadata so clients receive up-to-date objects
      const refreshedMetadatas = await Promise.all(fileMetadatas.map(m => FileMetadata.findById(m.id)));
      broadcast({ type: 'BATCH_PROCESSING_COMPLETED', batchId, collectionId: collectionIdNum, fileCount: fileMetadatas.length, files: refreshedMetadatas, message: 'Batch processing completed successfully', progress: 100, startedAt });
    } catch (e) {
      console.warn('⚠️  Unable to broadcast batch completion:', e && e.message);
    }

    // Reload each metadata from DB before broadcasting to avoid stale processing_status
    const broadcastPromises = fileMetadatas.map(async (metadata) => {
      try {
        const fresh = await FileMetadata.findById(metadata.id);
        broadcast({
          type: 'FILES_PROCESSED',
          batchId,
          collectionId: fresh ? fresh.collection_id : metadata.collection_id,
          fileMetadata: fresh || metadata,
        });
      } catch (e) {
        // fallback to broadcasting existing object
        try {
          broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: metadata.collection_id, fileMetadata: metadata });
        } catch (err) {
          console.warn('⚠️  Unable to broadcast FILES_PROCESSED for metadata', metadata && metadata.id, err && err.message);
        }
      }
    });

    await Promise.all(broadcastPromises);
    console.log(`✅ Broadcast complete events`);

  console.log(`🎉 All ${fileArray.length} files processed successfully!`);

  } catch (error) {
    console.error("🔥 Error in processPDFFilesParallel:", error);

    // First, mark all files as failed and gather updated metadata
    const failurePromises = fileMetadatas.map(async (metadata) => {
      try {
        return await metadata.updateStatus('failed');
      } catch (err) {
        console.error(`❌ Error updating failed status:`, err);
        return null;
      }
    });

    const updatedFailedMetadatas = await Promise.all(failurePromises);

    // Broadcast batch failure using updated metadata
    try {
      broadcast({ type: 'BATCH_PROCESSING_FAILED', batchId, collectionId: collectionIdNum, fileCount: fileMetadatas.length, error: error?.message, files: updatedFailedMetadatas, startedAt });
    } catch (e) {
      console.warn('⚠️  Unable to broadcast batch failure:', e && e.message);
    }

    // Broadcast individual file processed events with failed state
    try {
      const broadcastPromises = (updatedFailedMetadatas || []).map(async (metadata) => {
        broadcast({ type: 'FILES_PROCESSED', batchId, collectionId: metadata ? metadata.collection_id : collectionIdNum, fileMetadata: metadata });
      });
      await Promise.all(broadcastPromises);
    } catch (e) {
      console.warn('⚠️  Unable to broadcast individual failure events:', e && e.message);
    }

    throw error;
  } finally {
    // Ensure heartbeat interval is cleared on all exits (success, partial failure, exception)
    try {
      if (progressInterval) clearInterval(progressInterval);
    } catch (e) {
      console.warn('⚠️  Error clearing progressInterval:', e && e.message);
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
    console.error('🔥 Error in updateUploadProgress:', err);
    res.status(500).json({ error: err.message });
  }
};

export const reprocessFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileMetadata = await FileMetadata.findById(fileId);
    if (!fileMetadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    const tempPath = await CloudStorageService.downloadFile(fileMetadata.cloud_storage_path);
    const file = {
      name: fileMetadata.original_filename,
      mv: async (path) => {
        fs.renameSync(tempPath, path);
      },
    };

    const {
      allRawRecords,
      allFilteredRecords,
      allRemovedRecords
    } = await processPDFs([file]);

    await PreProcessRecord.deleteByFileName(fileMetadata.original_filename);
    await PostProcessRecord.deleteByFileName(fileMetadata.original_filename);
    await RemovedRecord.deleteByFileName(fileMetadata.original_filename);

    const processingTimestamp = new Date().toISOString();

   const preProcessRecords = allRawRecords.map(record => ({  
     collection_id: fileMetadata.collection_id,  
     full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),  
     mobile: record.mobile,  
     email: record.email,  
     address: record.address,  
     dateofbirth: record.dateofbirth,  
     landline: record.landline,  
     lastseen: record.lastseen,  
     file_name: record.file_name,  
     processing_timestamp: processingTimestamp,  
   }));

    const postProcessRecords = allFilteredRecords.map(record => ({
      collection_id: fileMetadata.collection_id,
      ...record,
      full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      processing_timestamp: processingTimestamp,
    }));

    const removedRecords = (allRemovedRecords || []).map(record => ({
      collection_id: fileMetadata.collection_id,
      full_name: record.full_name,
      file_name: record.file_name,
      rejection_reason: record.rejection_reason,
      processing_timestamp: processingTimestamp,
    }));

    await Promise.all([
      PreProcessRecord.bulkCreate(preProcessRecords),
      PostProcessRecord.bulkCreate(postProcessRecords),
      RemovedRecord.bulkCreate(removedRecords),
    ]);

    await fileMetadata.updateStatus('completed');

  broadcast({ type: 'FILE_REPROCESSED', collectionId: fileMetadata.collection_id, batchId: fileMetadata.batch_id || null, fileId: fileMetadata.id });

    res.json({ success: true, message: `File ${fileId} has been reprocessed.` });
  } catch (err) {
    console.error('🔥 Error in reprocessFile:', err);
    res.status(500).json({ error: err.message });
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
            console.error("🔥 Error downloading file:", err);
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

    console.log(`📊 Exporting ${fileType.toUpperCase()}: ${records.length} records`);

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
      console.log(`✅ Created ${fileName}: ${fs.statSync(filePath).size} bytes`);

    } else {
      // CSV export
      const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: Object.keys(records[0] || {}).map(key => ({ id: key, title: key }))
      });
      await csvWriter.writeRecords(records);
      console.log(`✅ Created ${fileName}: ${fs.statSync(filePath).size} bytes`);
    }

    // Download file
    res.download(filePath, `${collection.name}-${fileName}`, (err) => {
      if (err) {
        console.error("🔥 Error downloading file:", err.message);
      } else {
        console.log(`✅ Downloaded ${fileName}`);
      }
      
      // Cleanup
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.warn(`⚠️  Cleanup error: ${cleanupErr.message}`);
      }
    });

  } catch (err) {
    console.error(`🔥 Error in downloadCollectionFile:`, err);
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
        console.error("🔥 Error downloading summary file:", err.message);
      } else {
        console.log(`✅ Downloaded ${fileName}`);
      }

      // Cleanup the uniquely named temp file
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupErr) {
        console.warn(`⚠️  Cleanup error: ${cleanupErr.message}`);
      }
    });

  } catch (err) {
    console.error(`🔥 Error in downloadCollectionSummary:`, err);
    res.status(500).json({ error: err.message });
  }
};


export const getUploadedFiles = async (req, res) => {
  try {
    const { collectionId } = req.params;
    const files = await FileMetadata.findAll(collectionId);
    res.json({ success: true, data: files });
  } catch (err) {
    console.error('🔥 Error in getUploadedFiles:', err);
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
    console.error('🔥 Error in getBatchStatus:', err);
    res.status(500).json({ error: err.message });
  }
};