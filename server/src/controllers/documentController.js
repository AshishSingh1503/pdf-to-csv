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
    const { preProcessingJson, postProcessingJson, zipPath } = await processPDFs(fileArray);

    // Prepare data for database insertion
    const processingTimestamp = new Date().toISOString();
    
    // Format pre-process records for database
    const preProcessRecords = preProcessingJson.raw_records.map(record => ({
      collection_id: parseInt(collectionId),
      full_name: record.full_name,
      mobile: record.mobile,
      email: record.email,
      address: record.address,
      dateofbirth: record.dateofbirth,
      landline: record.landline,
      lastseen: record.lastseen,
      file_name: record.file_name,
      processing_timestamp: processingTimestamp
    }));

    // Format post-process records for database
    const postProcessRecords = postProcessingJson.filtered_records.map(record => ({
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

    // Save to database
    const savedPreRecords = await PreProcessRecord.bulkCreate(preProcessRecords);
    const savedPostRecords = await PostProcessRecord.bulkCreate(postProcessRecords);

    // Upload files to Cloud Storage
    let uploadedFiles = [];
    try {
      uploadedFiles = await CloudStorageService.uploadProcessedFiles(fileArray, collectionId);
      console.log(`✅ Uploaded ${uploadedFiles.length} files to Cloud Storage`);
    } catch (error) {
      console.error('Error uploading to Cloud Storage:', error);
      // Continue processing even if Cloud Storage upload fails
    }

    // Save file metadata with Cloud Storage paths
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

    // Format response data for frontend
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
      zipPath: `/api/documents/download?file=${path.basename(zipPath)}`,
      message: `Successfully processed ${fileArray.length} file(s) and saved to collection`
    });
  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

export const downloadZip = (req, res) => {
    const { file } = req.query;
    if (!file) {
        return res.status(400).json({ error: "No file specified for download." });
    }
    const filePath = path.join(process.cwd(), "output", file);
    res.download(filePath, (err) => {
        if (err) {
            console.error("🔥 Error downloading file:", err);
            res.status(500).json({ error: "Could not download the file." });
        }
    });
};

export const downloadCollectionExcels = async (req, res) => {
  try {
    const { collectionId } = req.params;
    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    const preProcessRecords = await PreProcessRecord.findAll(collectionId);
    const postProcessRecords = await PostProcessRecord.findAll(collectionId);

    const tempDir = path.join(process.cwd(), "temp", `collection-${collectionId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const preProcessExcelPath = path.join(tempDir, "pre-process.xlsx");
    const postProcessExcelPath = path.join(tempDir, "post-process.xlsx");

    const preProcessWorksheet = xlsx.utils.json_to_sheet(preProcessRecords.map(r => ({...r})));
    const postProcessWorksheet = xlsx.utils.json_to_sheet(postProcessRecords.map(r => ({...r})));

    const preProcessWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(preProcessWorkbook, preProcessWorksheet, "Pre-Process");
    xlsx.writeFile(preProcessWorkbook, preProcessExcelPath);

    const postProcessWorkbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(postProcessWorkbook, postProcessWorksheet, "Post-Process");
    xlsx.writeFile(postProcessWorkbook, postProcessExcelPath);

    const zipPath = path.join(process.cwd(), "temp", `collection-${collectionId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, `${collection.name}.zip`, (err) => {
        if (err) {
          console.error("🔥 Error downloading file:", err);
          res.status(500).json({ error: "Could not download the file." });
        }
        fs.unlinkSync(preProcessExcelPath);
        fs.unlinkSync(postProcessExcelPath);
        fs.unlinkSync(zipPath);
      });
    });

    archive.pipe(output);
    archive.file(preProcessExcelPath, { name: "pre-process.xlsx" });
    archive.file(postProcessExcelPath, { name: "post-process.xlsx" });
    archive.finalize();
  } catch (err) {
    console.error("🔥 Error in downloadCollectionExcels:", err);
    res.status(500).json({ error: err.message });
  }
};

export const downloadCollectionCsvs = async (req, res) => {
  try {
    const { collectionId } = req.params;
    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }

    const preProcessRecords = await PreProcessRecord.findAll(collectionId);
    const postProcessRecords = await PostProcessRecord.findAll(collectionId);

    const tempDir = path.join(process.cwd(), "temp", `collection-${collectionId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const preProcessCsvPath = path.join(tempDir, "pre-process.csv");
    const postProcessCsvPath = path.join(tempDir, "post-process.csv");

    const preProcessCsvWriter = createObjectCsvWriter({
      path: preProcessCsvPath,
      header: [
        { id: "full_name", title: "Full Name" },
        { id: "mobile", title: "Mobile" },
        { id: "email", title: "Email" },
        { id: "address", title: "Address" },
        { id: "dateofbirth", title: "Date of Birth" },
        { id: "landline", title: "Landline" },
        { id: "lastseen", title: "Last Seen" },
        { id: "file_name", title: "File Name" },
      ],
    });

    const postProcessCsvWriter = createObjectCsvWriter({
      path: postProcessCsvPath,
      header: [
        { id: "first_name", title: "First Name" },
        { id: "last_name", title: "Last Name" },
        { id: "mobile", title: "Mobile" },
        { id: "email", title: "Email" },
        { id: "address", title: "Address" },
        { id: "dateofbirth", title: "Date of Birth" },
        { id: "landline", title: "Landline" },
        { id: "lastseen", title: "Last Seen" },
        { id: "file_name", title: "File Name" },
      ],
    });

    await preProcessCsvWriter.writeRecords(preProcessRecords);
    await postProcessCsvWriter.writeRecords(postProcessRecords);

    const zipPath = path.join(process.cwd(), "temp", `collection-${collectionId}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      res.download(zipPath, `${collection.name}.zip`, (err) => {
        if (err) {
          console.error("🔥 Error downloading file:", err);
          res.status(500).json({ error: "Could not download the file." });
        }
        fs.unlinkSync(preProcessCsvPath);
        fs.unlinkSync(postProcessCsvPath);
        fs.unlinkSync(zipPath);
      });
    });

    archive.pipe(output);
    archive.file(preProcessCsvPath, { name: "pre-process.csv" });
    archive.file(postProcessCsvPath, { name: "post-process.csv" });
    archive.finalize();
  } catch (err) {
    console.error("🔥 Error in downloadCollectionCsvs:", err);
    res.status(500).json({ error: err.message });
  }
};
