// server/src/models/Customer.js
import { query } from './database.js';

export class Customer {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.email = data.email;
    this.phone = data.phone;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  // Create new customer
  static async create({ name, email, phone }) {
    const result = await query(
      'INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3) RETURNING *',
      [name, email, phone]
    );
    return new Customer(result.rows[0]);
  }

  // Get all customers
  static async findAll() {
    const result = await query('SELECT * FROM customers ORDER BY created_at DESC');
    return result.rows.map(row => new Customer(row));
  }

  // Get customer by ID
  static async findById(id) {
    const result = await query('SELECT * FROM customers WHERE id = $1', [id]);
    return result.rows.length > 0 ? new Customer(result.rows[0]) : null;
  }

  // Update customer
  async update({ name, email, phone }) {
    const result = await query(
      'UPDATE customers SET name = $1, email = $2, phone = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [name, email, phone, this.id]
    );
    if (result.rows.length > 0) {
      Object.assign(this, result.rows[0]);
      return this;
    }
    return null;
  }

  // Delete customer
  async delete() {
    const result = await query('DELETE FROM customers WHERE id = $1 RETURNING *', [this.id]);
    return result.rows.length > 0;
  }
}
