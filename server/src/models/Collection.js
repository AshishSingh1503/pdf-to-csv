// server/src/models/Collection.js
import { query } from './database.js';

export class Collection {
  constructor(data) {
    this.id = data.id;
    this.customer_id = data.customer_id;
    this.name = data.name;
    this.description = data.description;
    this.status = data.status || 'active';
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  // Get all collections
  static async findAll(customerId) {
    let queryText = 'SELECT * FROM collections';
    const params = [];

    if (customerId) {
      queryText += ' WHERE customer_id = $1';
      params.push(customerId);
    }
    
    queryText += ' ORDER BY created_at DESC';
    
    const result = await query(queryText, params);
    return result.rows.map(row => new Collection(row));
  }

  // Get collection by ID
  static async findById(id) {
    const result = await query(
      'SELECT * FROM collections WHERE id = $1 AND status = $2',
      [id, 'active']
    );
    return result.rows.length > 0 ? new Collection(result.rows[0]) : null;
  }

  // Create new collection
  static async create({ name, description = '', customer_id }) {
    const result = await query(
      'INSERT INTO collections (name, description, customer_id) VALUES ($1, $2, $3) RETURNING *',
      [name, description, customer_id]
    );
    return new Collection(result.rows[0]);
  }

  // Update collection
  async update({ name, description }) {
    const result = await query(
      'UPDATE collections SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [name, description, this.id]
    );
    if (result.rows.length > 0) {
      Object.assign(this, result.rows[0]);
      return this;
    }
    return null;
  }

  // Archive collection (soft delete)
  async archive() {
    const result = await query(
      'UPDATE collections SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      ['archived', this.id]
    );
    if (result.rows.length > 0) {
      this.status = 'archived';
      return this;
    }
    return null;
  }

  // Delete collection (hard delete)
  async delete() {
    const result = await query(
      'DELETE FROM collections WHERE id = $1 RETURNING *',
      [this.id]
    );
    return result.rows.length > 0;
  }

  // Get collection statistics
  async getStats() {
    // Single query with sub-selects to return all three counts in one roundtrip
    const q = await query(
      `SELECT
         (SELECT COUNT(*) FROM pre_process_records WHERE collection_id = $1) AS pre_count,
         (SELECT COUNT(*) FROM post_process_records WHERE collection_id = $1) AS post_count,
         (SELECT COUNT(*) FROM file_metadata WHERE collection_id = $1) AS file_count
       `,
      [this.id]
    );

    const row = q.rows[0] || { pre_count: 0, post_count: 0, file_count: 0 };
    return {
      preProcessRecords: parseInt(row.pre_count, 10) || 0,
      postProcessRecords: parseInt(row.post_count, 10) || 0,
      totalFiles: parseInt(row.file_count, 10) || 0,
    };
  }

  // Check if collection name exists
  static async nameExists(name, excludeId = null) {
    let queryText = 'SELECT id FROM collections WHERE name = $1';
    let params = [name];
    
    if (excludeId) {
      queryText += ' AND id != $2';
      params.push(excludeId);
    }
    
    const result = await query(queryText, params);
    return result.rows.length > 0;
  }
}
