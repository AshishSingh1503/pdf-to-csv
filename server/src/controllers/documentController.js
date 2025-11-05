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
  try {
    const sessionDir = path.join(process.cwd(), "output", `session_${Date.now()}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    console.log(`📊 Starting parallel processing for ${fileArray.length} files...`);

    // STEP 1: Process ALL files at once with high concurrency
    const { allRawRecords, allFilteredRecords } = 
      await processPDFs(fileArray, 10, 4);

    const processingTimestamp = new Date().toISOString();

    // ⭐ OPTIMIZATION: Prepare ALL records at once
   const allPreProcessRecords = allRawRecords.map((record) => ({  
     collection_id: parseInt(collectionId),  
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
      collection_id: parseInt(collectionId),
      ...record,
      full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      processing_timestamp: processingTimestamp
    }));

    console.log(`📦 Prepared: ${allPreProcessRecords.length} pre + ${allPostProcessRecords.length} post records`);

    // ⭐ KEY OPTIMIZATION: Insert ALL at once (uses only 2 connections!)
    console.log(`💾 Inserting into database...`);
    const [insertedPre, insertedPost] = await Promise.all([
      PreProcessRecord.bulkCreate(allPreProcessRecords),
      PostProcessRecord.bulkCreate(allPostProcessRecords),
    ]);

    console.log(`✅ Inserted: ${insertedPre.length} pre, ${insertedPost.length} post records`);

    // STEP 2: Update file metadata in parallel
    const updatePromises = fileMetadatas.map(async (metadata) => {
      try {
        return await metadata.updateStatus('completed');
      } catch (err) {
        console.error(`❌ Error updating status:`, err);
        return null;
      }
    });

    const updatedMetadatas = await Promise.all(updatePromises);
    console.log(`✅ Updated status for ${updatedMetadatas.filter(m => m).length} files`);

    // STEP 3: Upload files to cloud in parallel
    const uploadPromises = fileArray.map(async (file, idx) => {
      try {
        const uploadedFiles = await CloudStorageService.uploadProcessedFiles([file], collectionId);
        if (fileMetadatas[idx] && uploadedFiles && uploadedFiles) {
          await fileMetadatas[idx].updateCloudStoragePath(uploadedFiles.url);
        }
        return uploadedFiles;
      } catch (err) {
        console.error(`❌ Error uploading file ${file.name}:`, err);
        return null;
      }
    });

    const uploadResults = await Promise.all(uploadPromises);
    console.log(`✅ Uploaded ${uploadResults.filter(r => r).length} files to cloud`);

    // STEP 4: Broadcast completion
    const broadcastPromises = fileMetadatas.map(async (metadata) => {
      broadcast({ 
        type: 'FILES_PROCESSED', 
        collectionId: metadata.collection_id, 
        fileMetadata: metadata 
      });
    });

    await Promise.all(broadcastPromises);
    console.log(`✅ Broadcast complete events`);

    console.log(`🎉 All ${fileArray.length} files processed successfully!`);

  } catch (error) {
    console.error("🔥 Error in processPDFFilesParallel:", error);
    
    // Mark all files as failed
    const failurePromises = fileMetadatas.map(async (metadata) => {
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
    throw error;
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