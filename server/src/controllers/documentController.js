// server/src/controllers/documentController.js
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

    // Process files in the background
    processPDFFiles(fileArray, collectionId, fileMetadatas);

  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

const processPDFFiles = async (fileArray, collectionId, fileMetadatas) => {
  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    const fileMetadata = fileMetadatas[i];
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
      await fileMetadata.updateStatus('completed');
      await fileMetadata.updateCloudStoragePath(uploadedFile[0].url);

      broadcast({ type: 'FILES_PROCESSED', collectionId: fileMetadata.collection_id, fileMetadata });

    } catch (error) {
      console.error(`🔥 Error processing file ${file.name}:`, error);
      await fileMetadata.updateStatus('failed');
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
