// server/src/models/FileMetadata.js
import { query } from './database.js';

export class FileMetadata {
  constructor(data) {
    this.id = data.id;
    this.collection_id = data.collection_id;
    this.original_filename = data.original_filename;
    this.cloud_storage_path = data.cloud_storage_path;
    this.file_size = data.file_size;
    this.processing_status = data.processing_status;
    this.created_at = data.created_at;
  }

  // Create new file metadata
  static async create(metadata) {
    const {
      collection_id,
      original_filename,
      cloud_storage_path,
      file_size,
      processing_status = 'processing'
    } = metadata;

    const result = await query(
      `INSERT INTO file_metadata 
       (collection_id, original_filename, cloud_storage_path, file_size, processing_status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [collection_id, original_filename, cloud_storage_path, file_size, processing_status]
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

  // Delete files by collection ID
  static async deleteByCollectionId(collectionId) {
    const result = await query(
      'DELETE FROM file_metadata WHERE collection_id = $1',
      [collectionId]
    );
    return result.rowCount;
  }
}
