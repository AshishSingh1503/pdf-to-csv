// server/src/models/PostProcessRecord.js
import { query } from './database.js';

export class PostProcessRecord {
  constructor(data) {
    this.id = data.id;
    this.collection_id = data.collection_id;
    this.first_name = data.first_name;
    this.last_name = data.last_name;
    this.mobile = data.mobile;
    this.email = data.email;
    this.address = data.address;
    this.dateofbirth = data.dateofbirth;
    this.landline = data.landline;
    this.lastseen = data.lastseen;
    this.file_name = data.file_name;
    this.processing_timestamp = data.processing_timestamp;
    this.created_at = data.created_at;
  }

  // Create new post-process record
  static async create(recordData) {
    const {
      collection_id,
      first_name,
      last_name,
      mobile,
      email,
      address,
      dateofbirth,
      landline,
      lastseen,
      file_name,
      processing_timestamp
    } = recordData;

    const result = await query(
      `INSERT INTO post_process_records 
       (collection_id, first_name, last_name, mobile, email, address, dateofbirth, landline, lastseen, file_name, processing_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [collection_id, first_name, last_name, mobile, email, address, dateofbirth, landline, lastseen, file_name, processing_timestamp]
    );
    return new PostProcessRecord(result.rows[0]);
  }

  // Bulk create post-process records
  static async bulkCreate(records) {
    if (records.length === 0) return [];

    const values = records.map((record, index) => {
      const baseIndex = index * 11;
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11})`;
    }).join(', ');

    const params = records.flatMap(record => [
      record.collection_id,
      record.first_name,
      record.last_name,
      record.mobile,
      record.email,
      record.address,
      record.dateofbirth,
      record.landline,
      record.lastseen,
      record.file_name,
      record.processing_timestamp
    ]);

    const result = await query(
      `INSERT INTO post_process_records 
       (collection_id, first_name, last_name, mobile, email, address, dateofbirth, landline, lastseen, file_name, processing_timestamp)
       VALUES ${values}
       RETURNING *`,
      params
    );

    return result.rows.map(row => new PostProcessRecord(row));
  }

  // Get records by collection ID
  static async findByCollectionId(collectionId, limit = null, offset = 0) {
    let queryText = 'SELECT * FROM post_process_records WHERE collection_id = $1 ORDER BY created_at DESC';
    let params = [collectionId];

    if (limit) {
      queryText += ' LIMIT $2 OFFSET $3';
      params.push(limit, offset);
    }

    const result = await query(queryText, params);
    return result.rows.map(row => new PostProcessRecord(row));
  }

  // Get all records (with optional collection filter)
  static async findAll(collectionId = null, limit = null, offset = 0) {
    let queryText = 'SELECT * FROM post_process_records';
    let params = [];
    let paramCount = 0;

    if (collectionId) {
      queryText += ' WHERE collection_id = $1';
      params.push(collectionId);
      paramCount = 1;
    }

    queryText += ' ORDER BY created_at DESC';

    if (limit) {
      queryText += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await query(queryText, params);
    return result.rows.map(row => new PostProcessRecord(row));
  }

  // Search records
  static async search(searchTerm, collectionId = null, limit = null, offset = 0) {
    let queryText = `
      SELECT * FROM post_process_records 
      WHERE (
        LOWER(first_name) LIKE LOWER($1) OR
        LOWER(last_name) LIKE LOWER($1) OR
        LOWER(mobile) LIKE LOWER($1) OR
        LOWER(email) LIKE LOWER($1) OR
        LOWER(address) LIKE LOWER($1) OR
        LOWER(file_name) LIKE LOWER($1)
      )
    `;
    let params = [`%${searchTerm}%`];
    let paramCount = 1;

    if (collectionId) {
      queryText += ' AND collection_id = $2';
      params.push(collectionId);
      paramCount = 2;
    }

    queryText += ' ORDER BY created_at DESC';

    if (limit) {
      queryText += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limit, offset);
    }

    const result = await query(queryText, params);
    return result.rows.map(row => new PostProcessRecord(row));
  }

  // Get count of records
  static async count(collectionId = null, searchTerm = null) {
    let queryText = 'SELECT COUNT(*) FROM post_process_records';
    let params = [];
    let paramCount = 0;

    if (collectionId) {
      queryText += ' WHERE collection_id = $1';
      params.push(collectionId);
      paramCount = 1;
    }

    if (searchTerm) {
      queryText += ` ${paramCount > 0 ? 'AND' : 'WHERE'} (
        LOWER(first_name) LIKE LOWER($${paramCount + 1}) OR
        LOWER(last_name) LIKE LOWER($${paramCount + 1}) OR
        LOWER(mobile) LIKE LOWER($${paramCount + 1}) OR
        LOWER(email) LIKE LOWER($${paramCount + 1}) OR
        LOWER(address) LIKE LOWER($${paramCount + 1}) OR
        LOWER(file_name) LIKE LOWER($${paramCount + 1})
      )`;
      params.push(`%${searchTerm}%`);
    }

    const result = await query(queryText, params);
    return parseInt(result.rows[0].count);
  }

  // Delete records by collection ID
  static async deleteByCollectionId(collectionId) {
    const result = await query(
      'DELETE FROM post_process_records WHERE collection_id = $1',
      [collectionId]
    );
    return result.rowCount;
  }
}
