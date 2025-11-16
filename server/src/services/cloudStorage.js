// server/src/services/cloudStorage.js
import { Storage } from '@google-cloud/storage';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

// Initialize Cloud Storage client
const storageConfig = {
  projectId: config.projectId,
};

if (process.env.NODE_ENV !== 'production') {
  storageConfig.keyFilename = config.credentials;
}

const storage = new Storage(storageConfig);

const outputBucket = storage.bucket(config.outputBucket);

export class CloudStorageService {
  /**
   * Uploads a raw PDF file to GCS under the 'raw/' prefix.
   * @param {Object} file - The file object from the request.
   * @param {string} collectionId - The ID of the collection.
   * @param {string} batchId - The ID of the batch.
   * @returns {Promise<string>} The full GCS path of the uploaded file.
   */
 static async uploadRawFile(file, collectionId, batchId) {  
   const fileName = `raw/${collectionId}/${batchId}/${file.name}`;  
   const fileUpload = outputBucket.file(fileName);  
   
   return new Promise((resolve, reject) => {  
     const stream = fileUpload.createWriteStream({  
       metadata: {  
         contentType: file.mimetype || 'application/pdf',  
         metadata: {  
           originalName: file.name,  
           collectionId: collectionId.toString(),  
           batchId: batchId,  
         },  
       },  
     });  
   
     stream.on('error', (error) => {  
       // Enhanced error logging  
       logger.error(`Upload error for ${file.name}:`, {  
         error: error.message,  
         code: error.code,  
         fileName: fileName,  
         fileSize: file.size,  
         bucket: config.outputBucket,  
         collectionId: collectionId,  
         batchId: batchId,  
         stack: error.stack  
       });  
       reject(error);  
     });  
   
     stream.on('finish', () => {  
       const gcsPath = `gs://${config.outputBucket}/${fileName}`;  
       logger.info(`Uploaded raw file ${file.name} to ${gcsPath}`);  
       resolve(gcsPath);  
     });  
   
     // Add validation before writing  
     if (!file.data || file.data.length === 0) {  
       const error = new Error(`File ${file.name} has no data or is empty`);  
       logger.error('Invalid file data:', {  
         fileName: file.name,  
         hasData: !!file.data,  
         dataLength: file.data?.length || 0  
       });  
       reject(error);  
       return;  
     }  
   
     stream.end(file.data);  
   });  
 }

  /**
   * Uploads processed output files (like JSON) to GCS under the 'processed/' prefix.
   * @param {Array<Object>} files - Array of file objects with 'name' and 'content' properties.
   * @param {string} collectionId - The ID of the collection.
   * @param {string} batchId - The ID of the batch.
   * @returns {Promise<Array<string>>} A promise that resolves with an array of GCS paths.
   */
  static async uploadProcessedFiles(files, collectionId, batchId) {
    const uploadPromises = files.map(file => {
      const fileName = `processed/${collectionId}/${batchId}/${file.name}`;
      const fileUpload = outputBucket.file(fileName);
      const gcsPath = `gs://${config.outputBucket}/${fileName}`;

      return new Promise((resolve, reject) => {
        const stream = fileUpload.createWriteStream({
          metadata: { contentType: file.contentType || 'application/json' },
        });
        stream.on('error', reject);
        stream.on('finish', () => {
          logger.info(`Uploaded processed file to ${gcsPath}`);
          resolve(gcsPath);
        });
        stream.end(file.content);
      });
    });

    return Promise.all(uploadPromises);
  }

  /**
   * Checks if a file exists at the given GCS path.
   * @param {string} gcsPath - The full GCS path (e.g., 'gs://bucket/path/to/file').
   * @returns {Promise<boolean>} True if the file exists, false otherwise.
   */
  static async fileExists(gcsPath) {
    const { bucket, name } = this.parseGcsPath(gcsPath);
    if (!bucket || !name) return false;
    const [exists] = await storage.bucket(bucket).file(name).exists();
    return exists;
  }

  /**
   * Deletes a file from GCS with retry logic.
   * @param {string} gcsPath - The full GCS path.
   */
  static async deleteFile(gcsPath) {
    const { bucket, name } = this.parseGcsPath(gcsPath);
    if (!bucket || !name) throw new Error('Invalid GCS path');

    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await storage.bucket(bucket).file(name).delete();
        logger.info(`Deleted file from GCS: ${gcsPath}`);
        return;
      } catch (error) {
        lastError = error;
        if (error.code === 404) {
          logger.warn(`File not found during deletion (already deleted?): ${gcsPath}`);
          return;
        }
        logger.error(`Error deleting file (attempt ${attempt + 1}):`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

  /**
   * Downloads a file from GCS to a temporary local path.
   * @param {string} gcsPath - The full GCS path.
   * @returns {Promise<string>} The path to the temporary local file.
   */
  static async downloadFile(gcsPath) {
    const { bucket, name } = this.parseGcsPath(gcsPath);
    if (!bucket || !name) throw new Error('Invalid GCS path');

    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, path.basename(name));

    try {
      await storage.bucket(bucket).file(name).download({ destination: tempPath });
      return tempPath;
    } catch (error) {
      logger.error('Error downloading file:', error);
      throw error;
    }
  }
  
  /**
   * Parses a GCS path into its bucket and name components.
   * @param {string} gcsPath - The GCS path.
   * @returns {{bucket: string, name: string}}
   */
  static parseGcsPath(gcsPath) {
    if (!gcsPath || !gcsPath.startsWith('gs://')) {
      logger.error(`Invalid GCS path format: ${gcsPath}`);
      return { bucket: null, name: null };
    }
    const [bucket, ...nameParts] = gcsPath.substring(5).split('/');
    return { bucket, name: nameParts.join('/') };
  }
}
