// server/src/controllers/documentController.js
import path from "path";
import { processPDFs } from "../services/documentProcessor.js";
import { PreProcessRecord } from "../models/PreProcessRecord.js";
import { PostProcessRecord } from "../models/PostProcessRecord.js";
import { FileMetadata } from "../models/FileMetadata.js";
import { CloudStorageService } from "../services/cloudStorage.js";

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
