import { query } from './database.js';

export class RemovedRecord {
  constructor(data) {
    this.id = data.id;
    this.collection_id = data.collection_id;
    this.full_name = data.full_name;
    this.file_name = data.file_name;
    this.rejection_reason = data.rejection_reason;
    this.processing_timestamp = data.processing_timestamp;
    this.created_at = data.created_at;
  }

  static async create(recordData) {
    const { collection_id, full_name, file_name, rejection_reason, processing_timestamp } = recordData;

    const result = await query(
      `INSERT INTO removed_records
       (collection_id, full_name, file_name, rejection_reason, processing_timestamp)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [collection_id, full_name, file_name, rejection_reason, processing_timestamp]
    );

    return new RemovedRecord(result.rows[0]);
  }

  static async bulkCreate(records) {
    if (!records || records.length === 0) return [];

    const values = records.map((record, index) => {
      const baseIndex = index * 5;
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`;
    }).join(', ');

    const params = records.flatMap(record => [
      record.collection_id,
      record.full_name,
      record.file_name,
      record.rejection_reason,
      record.processing_timestamp
    ]);

    const result = await query(
      `INSERT INTO removed_records
       (collection_id, full_name, file_name, rejection_reason, processing_timestamp)
       VALUES ${values}
       RETURNING *`,
      params
    );

    return result.rows.map(row => new RemovedRecord(row));
  }

  static async findAll(collectionId = null, limit = null, offset = 0) {
    let queryText = 'SELECT * FROM removed_records';
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
    return result.rows.map(row => new RemovedRecord(row));
  }

  static async count(collectionId = null) {
    let queryText = 'SELECT COUNT(*) FROM removed_records';
    const params = [];

    if (collectionId) {
      queryText += ' WHERE collection_id = $1';
      params.push(collectionId);
    }

    const result = await query(queryText, params);
    return parseInt(result.rows[0].count);
  }

  static async deleteByCollectionId(collectionId) {
    const result = await query(
      'DELETE FROM removed_records WHERE collection_id = $1',
      [collectionId]
    );
    return result.rowCount;
  }

  static async deleteByFileName(fileName) {
    const result = await query(
      'DELETE FROM removed_records WHERE file_name = $1',
      [fileName]
    );
    return result.rowCount;
  }
}
