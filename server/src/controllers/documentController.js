// server/src/controllers/documentController.js
// FIXED VERSION - Parallel Processing

import path from "path";
import { processPDFs } from "../services/documentProcessor.js";
import { PreProcessRecord } from "../models/PreProcessRecord.js";
import { PostProcessRecord } from "../models/PostProcessRecord.js";
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

    if (!files) {
      return res.status(400).json({ error: "No PDF files uploaded" });
    }

    if (!collectionId) {
      return res.status(400).json({ error: "Collection ID is required" });
    }

    const fileArray = Array.isArray(files) ? files : [files];

    const fileMetadataPromises = fileArray.map(file => {
      return FileMetadata.create({
        collection_id: parseInt(collectionId),
        original_filename: file.name,
        file_size: file.size,
        processing_status: 'processing',
      });
    });
    const fileMetadatas = await Promise.all(fileMetadataPromises);

    res.json({
      success: true,
      files: fileMetadatas,
      message: `Successfully uploaded ${fileArray.length} file(s). Processing in background.`,
    });

    // FIXED: Process all files in the background in PARALLEL
    processPDFFilesParallel(fileArray, collectionId, fileMetadatas);

  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// FIXED VERSION: Parallel Processing
// ============================================
const processPDFFilesParallel = async (fileArray, collectionId, fileMetadatas) => {
  const BATCH_SIZE = 25;  // Process 25 files at a time
  
  console.log(`📊 Starting batch processing: ${fileArray.length} files in batches of ${BATCH_SIZE}`);

  // Process files in batches to avoid memory exhaustion
  for (let batchStart = 0; batchStart < fileArray.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, fileArray.length);
    const batch = fileArray.slice(batchStart, batchEnd);
    const batchMetadatas = fileMetadatas.slice(batchStart, batchEnd);
    
    console.log(`📦 Processing batch: files ${batchStart + 1}-${batchEnd} of ${fileArray.length}`);
    const batchStartTime = Date.now();

    try {
      // Create session directory for this batch
      const sessionDir = path.join(process.cwd(), "output", `session_${Date.now()}`);
      fs.mkdirSync(sessionDir, { recursive: true });

      // Process batch in parallel (but not all 30 at once)
      const { allRawRecords, allFilteredRecords } = 
        await processPDFs(batch, 10, 4);

      const processingTimestamp = new Date().toISOString();

      // Prepare records for both tables
      const preProcessRecords = allRawRecords.map((record) => ({
        collection_id: parseInt(collectionId),
        ...record,
        processing_timestamp: processingTimestamp
      }));

      const postProcessRecords = allFilteredRecords.map((record) => ({
        collection_id: parseInt(collectionId),
        ...record,
        processing_timestamp: processingTimestamp
      }));

      // Insert all records in parallel (both tables)
      const [insertedPre, insertedPost] = await Promise.all([
        PreProcessRecord.bulkCreate(preProcessRecords),
        PostProcessRecord.bulkCreate(postProcessRecords),
      ]);

      // Update file metadata status in parallel
      const updatePromises = batchMetadatas.map(async (metadata) => {
        try {
          return await metadata.updateStatus('completed');
        } catch (err) {
          console.error(`❌ Error updating status:`, err);
          return null;
        }
      });
      await Promise.all(updatePromises);

      // Upload files to cloud in parallel
      const uploadPromises = batch.map(async (file, idx) => {
        try {
          const uploadedFiles = await CloudStorageService.uploadProcessedFiles([file], collectionId);
          if (batchMetadatas[idx] && uploadedFiles && uploadedFiles) {
            await batchMetadatas[idx].updateCloudStoragePath(uploadedFiles.url);
          }
          return uploadedFiles;
        } catch (err) {
          console.error(`❌ Error uploading file ${file.name}:`, err);
          return null;
        }
      });
      await Promise.all(uploadPromises);

      // Broadcast completion
      const broadcastPromises = batchMetadatas.map(async (metadata) => {
        broadcast({ 
          type: 'FILES_PROCESSED', 
          collectionId: metadata.collection_id, 
          fileMetadata: metadata 
        });
      });
      await Promise.all(broadcastPromises);

      const batchTime = ((Date.now() - batchStartTime) / 1000).toFixed(2);
      const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`✅ Batch complete: ${batchTime}s | Memory: ${memoryUsage}MB | Files: ${batchEnd - batchStart}`);

    } catch (error) {
      console.error(`🔥 Error processing batch ${batchStart + 1}-${batchEnd}:`, error);
      
      // Mark all files in batch as failed
      const failurePromises = batchMetadatas.map(async (metadata) => {
        try {
          await metadata.updateStatus('failed');
          broadcast({ 
            type: 'FILES_PROCESSED', 
            collectionId: metadata.collection_id, 
            fileMetadata: metadata 
          });
        } catch (err) {
          console.error(`❌ Error updating failed status:`, err);
        }
      });
      await Promise.all(failurePromises);
      
      // Don't continue to next batch if current fails
      throw error;
    }
  }

  console.log(`🎉 All batches processed successfully!`);
};


// Keep old sequential version as backup (not used)
const processPDFFilesSequential = async (fileArray, collectionId, fileMetadatas) => {
  console.warn("⚠️  Using sequential processing (slow). Use processPDFFilesParallel instead.");
  
  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    let fileMetadata = fileMetadatas[i];
    try {
      const sessionDir = path.join(process.cwd(), "output", `session_${Date.now()}`);
      fs.mkdirSync(sessionDir, { recursive: true });

      const {
        allRawRecords,
        allFilteredRecords,
      } = await processPDFs([file], sessionDir);

      const processingTimestamp = new Date().toISOString();

      const preProcessRecords = allRawRecords.map(record => ({
        collection_id: parseInt(collectionId),
        ...record,
        processing_timestamp: processingTimestamp
      }));

      const postProcessRecords = allFilteredRecords.map(record => ({
        collection_id: parseInt(collectionId),
        ...record,
        processing_timestamp: processingTimestamp
      }));

      await PreProcessRecord.bulkCreate(preProcessRecords);
      await PostProcessRecord.bulkCreate(postProcessRecords);

      const uploadedFile = await CloudStorageService.uploadProcessedFiles([file], collectionId);
      fileMetadata = await fileMetadata.updateStatus('completed');
      await fileMetadata.updateCloudStoragePath(uploadedFile[0].url);

      broadcast({ type: 'FILES_PROCESSED', collectionId: fileMetadata.collection_id, fileMetadata });

    } catch (error) {
      console.error(`🔥 Error processing file ${file.name}:`, error);
      fileMetadata = await fileMetadata.updateStatus('failed');
      broadcast({ type: 'FILES_PROCESSED', collectionId: fileMetadata.collection_id, fileMetadata });
    }
  }
};

export const updateUploadProgress = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { progress } = req.body;
    const fileMetadata = await FileMetadata.findById(fileId);
    if (!fileMetadata) {
      return res.status(404).json({ error: 'File not found' });
    }
    await fileMetadata.updateUploadProgress(progress);
    broadcast({ type: 'UPLOAD_PROGRESS', fileId, progress });
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
    } = await processPDFs([file]);

    await PreProcessRecord.deleteByFileName(fileMetadata.original_filename);
    await PostProcessRecord.deleteByFileName(fileMetadata.original_filename);

    const processingTimestamp = new Date().toISOString();

    const preProcessRecords = allRawRecords.map(record => ({
      collection_id: fileMetadata.collection_id,
      ...record,
      processing_timestamp: processingTimestamp,
    }));

    const postProcessRecords = allFilteredRecords.map(record => ({
      collection_id: fileMetadata.collection_id,
      ...record,
      processing_timestamp: processingTimestamp,
    }));

    await PreProcessRecord.bulkCreate(preProcessRecords);
    await PostProcessRecord.bulkCreate(postProcessRecords);

    await fileMetadata.updateStatus('completed');

    broadcast({ type: 'FILE_REPROCESSED', collectionId: fileMetadata.collection_id });

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

const downloadCollectionFile = async (req, res, fileType) => {
  try {
    const { collectionId } = req.params;
    const { type } = req.query;
    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    let records;
    let fileName;
    if (type === 'post') {
      records = await PostProcessRecord.findAll(collectionId);
      fileName = `post-process.${fileType}`;
    } else {
      records = await PreProcessRecord.findAll(collectionId);
      fileName = `pre-process.${fileType}`;
    }

    const tempDir = path.join(process.cwd(), "temp", `collection-${collectionId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, fileName);

    if (fileType === 'xlsx') {
      const worksheet = xlsx.utils.json_to_sheet(records.map(r => ({...r})));
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, "Data");
      xlsx.writeFile(workbook, filePath);
    } else {
      const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: Object.keys(records[0] || {}).map(key => ({id: key, title: key}))
      });
      await csvWriter.writeRecords(records);
    }

    res.download(filePath, `${collection.name}-${fileName}`, (err) => {
      if (err) {
        console.error("🔥 Error downloading file:", err);
        res.status(500).json({ error: "Could not download the file." });
      }
      fs.unlinkSync(filePath);
    });
  } catch (err) {
    console.error(`🔥 Error in downloadCollectionFile (${fileType}):`, err);
    res.status(500).json({ error: err.message });
  }
}

export const downloadCollectionExcels = (req, res) => downloadCollectionFile(req, res, 'xlsx');
export const downloadCollectionCsvs = (req, res) => downloadCollectionFile(req, res, 'csv');

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