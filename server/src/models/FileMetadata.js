// server/src/models/FileMetadata.js
import { query } from './database.js';

import { CloudStorageService } from '../services/cloudStorage.js';
import logger from '../utils/logger.js';

export class FileMetadata {
  constructor(data) {
    this.id = data.id;
    this.collection_id = data.collection_id;
    this.original_filename = data.original_filename;
    this.cloud_storage_path = data.cloud_storage_path;
    this.cloud_storage_path_raw = data.cloud_storage_path_raw;
    this.cloud_storage_path_processed = data.cloud_storage_path_processed;
    this.file_size = data.file_size;
    this.processing_status = data.processing_status;
    this.upload_progress = data.upload_progress;
    this.batch_id = data.batch_id;
    this.created_at = data.created_at;
  }

  // Create new file metadata
  static async create(metadata) {
    const {
      collection_id,
      original_filename,
      cloud_storage_path,
      file_size,
      processing_status = 'processing',
      upload_progress = 0,
      batch_id = null
    } = metadata;

    const result = await query(
      `INSERT INTO file_metadata 
       (collection_id, original_filename, cloud_storage_path, file_size, processing_status, upload_progress, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [collection_id, original_filename, cloud_storage_path, file_size, processing_status, upload_progress, batch_id]
    );
    return new FileMetadata(result.rows[0]);
  }

  // Update processing status
  async updateStatus(status) {
    const result = await query(
      'UPDATE file_metadata SET processing_status = $1 WHERE id = $2 RETURNING *',
      [status, this.id]
    );
    if (result.rows.length > 0) {
      this.processing_status = status;
      return this;
    }
    return null;
  }

  async updateCloudStoragePath(path) {
    const result = await query(
      'UPDATE file_metadata SET cloud_storage_path = $1 WHERE id = $2 RETURNING *',
      [path, this.id]
    );
    if (result.rows.length > 0) {
      this.cloud_storage_path = path;
      return this;
    }
    return null;
  }

  async updateCloudStoragePathRaw(path) {
    const result = await query(
      'UPDATE file_metadata SET cloud_storage_path_raw = $1 WHERE id = $2 RETURNING *',
      [path, this.id]
    );
    if (result.rows.length > 0) {
      this.cloud_storage_path_raw = path;
      return this;
    }
    return null;
  }

  async updateCloudStoragePathProcessed(path) {
    const result = await query(
      'UPDATE file_metadata SET cloud_storage_path_processed = $1 WHERE id = $2 RETURNING *',
      [path, this.id]
    );
    if (result.rows.length > 0) {
      this.cloud_storage_path_processed = path;
      return this;
    }
    return null;
  }

  async updateUploadProgress(progress) {
    const result = await query(
      'UPDATE file_metadata SET upload_progress = $1 WHERE id = $2 RETURNING *',
      [progress, this.id]
    );
    if (result.rows.length > 0) {
      this.upload_progress = progress;
      return this;
    }
    return null;
  }

  // Get files by collection ID
  static async findByCollectionId(collectionId) {
    const result = await query(
      'SELECT * FROM file_metadata WHERE collection_id = $1 ORDER BY created_at DESC',
      [collectionId]
    );
    return result.rows.map(row => new FileMetadata(row));
  }

  // Get all files (with optional collection filter)
  static async findAll(collectionId = null) {
    let queryText = 'SELECT * FROM file_metadata';
    let params = [];

    if (collectionId) {
      queryText += ' WHERE collection_id = $1';
      params.push(collectionId);
    }

    queryText += ' ORDER BY created_at DESC';

    const result = await query(queryText, params);
    return result.rows.map(row => new FileMetadata(row));
  }

  static async findById(id) {
    const result = await query(
      'SELECT * FROM file_metadata WHERE id = $1',
      [id]
    );
    return result.rows.length ? new FileMetadata(result.rows[0]) : null;
  }

  static async findByBatchId(batchId) {
    if (!batchId) return [];
    const result = await query(
      'SELECT * FROM file_metadata WHERE batch_id = $1 ORDER BY created_at DESC',
      [batchId]
    );
    return result.rows.map(r => new FileMetadata(r));
  }

  // Count files by status for a given batch_id in a single aggregate query
  static async countByStatusForBatch(batchId) {
    if (!batchId) return { completed: 0, failed: 0, total: 0 };
    const result = await query(
      `SELECT
         COUNT(*)::int AS total,
         SUM(CASE WHEN processing_status = 'completed' THEN 1 ELSE 0 END)::int AS completed,
         SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END)::int AS failed
       FROM file_metadata
       WHERE batch_id = $1`,
      [batchId]
    );
    const row = result.rows[0] || { total: 0, completed: 0, failed: 0 };
    return {
      total: parseInt(row.total || 0, 10),
      completed: parseInt(row.completed || 0, 10),
      failed: parseInt(row.failed || 0, 10),
    };
  }

  // Delete files by collection ID
  static async deleteByCollectionId(collectionId) {
    const files = await this.findByCollectionId(collectionId);

    for (const file of files) {
      if (file.cloud_storage_path_raw) {
        try {
          await CloudStorageService.deleteFile(file.cloud_storage_path_raw);
        } catch (error) {
          logger.error(`Failed to delete file from GCS: ${file.cloud_storage_path_raw}`, error);
        }
      }
    }
    const result = await query(
      'DELETE FROM file_metadata WHERE collection_id = $1',
      [collectionId]
    );
    return result.rowCount;
  }
}
