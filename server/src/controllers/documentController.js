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
    const sessionDir = path.join(process.cwd(), "output", `session_${Date.now()}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    const { 
      allRawRecords, 
      allFilteredRecords, 
      allPreProcessingJson, 
      allPostProcessingJson 
    } = await processPDFs(fileArray, sessionDir);

    await saveFiles(
      allRawRecords, 
      allFilteredRecords, 
      allPreProcessingJson, 
      allPostProcessingJson, 
      sessionDir
    );
    const zipPath = await createZip(sessionDir);

    const processingTimestamp = new Date().toISOString();
    
    const preProcessRecords = allRawRecords.map(record => ({
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

    const postProcessRecords = allFilteredRecords.map(record => ({
      collection_id: parseInt(collectionId),
      first_name: record.first_name,
      last_name: record.last_name,
      mobile: record.mobile,
      email: record.email,
      address: record.address,
      dateofbirth: record.dateofbirth,
      landline: record.landline,
      lastseen: record.lastseen,
      file_name: record.file_name,
      processing_timestamp: processingTimestamp
    }));

    const savedPreRecords = await PreProcessRecord.bulkCreate(preProcessRecords);
    const savedPostRecords = await PostProcessRecord.bulkCreate(postProcessRecords);

    let uploadedFiles = [];
    try {
      uploadedFiles = await CloudStorageService.uploadProcessedFiles(fileArray, collectionId);
    } catch (error) {
      console.error('Error uploading to Cloud Storage:', error);
    }

    const fileMetadataPromises = fileArray.map((file, index) => {
      const uploadedFile = uploadedFiles[index];
      return FileMetadata.create({
        collection_id: parseInt(collectionId),
        original_filename: file.name,
        cloud_storage_path: uploadedFile ? uploadedFile.url : null,
        file_size: file.size,
        processing_status: 'completed'
      });
    });
    await Promise.all(fileMetadataPromises);

    broadcast({ type: 'FILES_PROCESSED', collectionId });

    const postProcessResults = savedPostRecords.map(record => ({
      id: record.id,
      first: record.first_name,
      last: record.last_name,
      mobile: record.mobile,
      email: record.email,
      address: record.address,
      dob: record.dateofbirth,
      seen: record.lastseen,
      source: record.file_name || ''
    }));

    const preProcessResults = savedPreRecords.map(record => ({
      id: record.id,
      full_name: record.full_name,
      mobile: record.mobile,
      email: record.email,
      address: record.address,
      dob: record.dateofbirth,
      seen: record.lastseen,
      source: record.file_name || ''
    }));
    
    res.json({ 
      success: true,
      postProcessResults: postProcessResults || [], 
      preProcessResults: preProcessResults || [],
      downloadLinks: {
        zip: `/api/documents/download?session=${path.basename(sessionDir)}&file=archive.zip`,
        rawCsv: `/api/documents/download?session=${path.basename(sessionDir)}&file=raw_data.csv`,
        filteredCsv: `/api/documents/download?session=${path.basename(sessionDir)}&file=filtered_data.csv`,
        rawExcel: `/api/documents/download?session=${path.basename(sessionDir)}&file=raw_data.xlsx`,
        filteredExcel: `/api/documents/download?session=${path.basename(sessionDir)}&file=filtered_data.xlsx`,
        combinedPreJson: `/api/documents/download?session=${path.basename(sessionDir)}&file=combined_pre_processing.json`,
        combinedPostJson: `/api/documents/download?session=${path.basename(sessionDir)}&file=combined_post_processing.json`,
      },
      message: `Successfully processed ${fileArray.length} file(s) and saved to collection`
    });
  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
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
