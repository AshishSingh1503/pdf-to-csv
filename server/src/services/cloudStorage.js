// server/src/services/cloudStorage.js
import { Storage } from '@google-cloud/storage';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

// Initialize Cloud Storage client
const storage = new Storage({
  keyFilename: config.credentials,
  projectId: config.projectId,
});

const inputBucket = storage.bucket(config.inputBucket);
const outputBucket = storage.bucket(config.outputBucket);

export class CloudStorageService {
  // Upload processed files to Cloud Storage
  static async uploadProcessedFiles(files, collectionId) {
    const uploadPromises = [];
    const uploadedFiles = [];

    for (const file of files) {
      try {
        // Create unique filename with collection ID and timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${collectionId}/${timestamp}_${file.name}`;
        
        // Upload to output bucket
        const fileUpload = outputBucket.file(fileName);
        
        const uploadPromise = new Promise((resolve, reject) => {
          const stream = fileUpload.createWriteStream({
            metadata: {
              contentType: file.mimetype || 'application/octet-stream',
              metadata: {
                originalName: file.name,
                collectionId: collectionId.toString(),
                uploadedAt: new Date().toISOString()
              }
            }
          });

          stream.on('error', (error) => {
            logger.error('Upload error:', error);
            reject(error);
          });

          stream.on('finish', () => {
            logger.info(`Uploaded ${file.name} to Cloud Storage`);
            resolve({
              fileName: fileName,
              originalName: file.name,
              size: file.size,
              url: `gs://${config.outputBucket}/${fileName}`
            });
          });

          // Write file buffer to stream
          stream.end(file.data);
        });

        uploadPromises.push(uploadPromise);
      } catch (error) {
        logger.error(`Error uploading ${file.name}:`, error);
        uploadPromises.push(Promise.reject(error));
      }
    }

    try {
      const results = await Promise.all(uploadPromises);
      uploadedFiles.push(...results);
    } catch (error) {
      logger.error('Some files failed to upload:', error);
    }

    return uploadedFiles;
  }

  // Upload CSV/Excel files to Cloud Storage
  static async uploadProcessedData(csvBuffer, excelBuffer, collectionId, processingTimestamp) {
    const uploadPromises = [];
    const uploadedFiles = [];

    try {
      // Upload CSV
      if (csvBuffer) {
        const csvFileName = `${collectionId}/processed_data_${processingTimestamp}.csv`;
        const csvFile = outputBucket.file(csvFileName);
        
        const csvUpload = new Promise((resolve, reject) => {
          const stream = csvFile.createWriteStream({
            metadata: {
              contentType: 'text/csv',
              metadata: {
                collectionId: collectionId.toString(),
                type: 'processed_csv',
                processedAt: processingTimestamp
              }
            }
          });

          stream.on('error', reject);
            stream.on('finish', () => {
              logger.info(`Uploaded CSV to Cloud Storage: ${csvFileName}`);
              resolve({
                fileName: csvFileName,
                type: 'csv',
                url: `gs://${config.outputBucket}/${csvFileName}`
              });
            });

          stream.end(csvBuffer);
        });

        uploadPromises.push(csvUpload);
      }

      // Upload Excel
      if (excelBuffer) {
        const excelFileName = `${collectionId}/processed_data_${processingTimestamp}.xlsx`;
        const excelFile = outputBucket.file(excelFileName);
        
        const excelUpload = new Promise((resolve, reject) => {
          const stream = excelFile.createWriteStream({
            metadata: {
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              metadata: {
                collectionId: collectionId.toString(),
                type: 'processed_excel',
                processedAt: processingTimestamp
              }
            }
          });

          stream.on('error', reject);
          stream.on('finish', () => {
            logger.info(`Uploaded Excel to Cloud Storage: ${excelFileName}`);
            resolve({
              fileName: excelFileName,
              type: 'excel',
              url: `gs://${config.outputBucket}/${excelFileName}`
            });
          });

          stream.end(excelBuffer);
        });

        uploadPromises.push(excelUpload);
      }

      const results = await Promise.all(uploadPromises);
      uploadedFiles.push(...results);

    } catch (error) {
      logger.error('Error uploading processed data:', error);
      throw error;
    }

    return uploadedFiles;
  }

  // Generate signed URL for file download
  static async generateSignedUrl(fileName, expirationMinutes = 60) {
    try {
      const file = outputBucket.file(fileName);
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + expirationMinutes * 60 * 1000,
      });
      return signedUrl;
    } catch (error) {
      logger.error('Error generating signed URL:', error);
      throw error;
    }
  }

  // List files in a collection
  static async listCollectionFiles(collectionId) {
    try {
      const [files] = await outputBucket.getFiles({
        prefix: `${collectionId}/`,
      });
      
      return files.map(file => ({
        name: file.name,
        size: file.metadata.size,
        created: file.metadata.timeCreated,
        url: `gs://${config.outputBucket}/${file.name}`
      }));
    } catch (error) {
      logger.error('Error listing collection files:', error);
      throw error;
    }
  }

  // Delete file from Cloud Storage
  static async deleteFile(fileName) {
    try {
      await outputBucket.file(fileName).delete();
      logger.info(`Deleted file from Cloud Storage: ${fileName}`);
    } catch (error) {
      logger.error('Error deleting file:', error);
      throw error;
    }
  }

  static async downloadFile(fileName) {
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, path.basename(fileName));
    try {
      await outputBucket.file(fileName).download({ destination: tempPath });
      return tempPath;
    } catch (error) {
      logger.error('Error downloading file:', error);
      throw error;
    }
  }
}
