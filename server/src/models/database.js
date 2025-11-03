// server/src/models/database.js
import { Pool } from 'pg';
import { config } from '../config/index.js';

// Log environment variables for debugging
console.log('🔧 Environment Variables:', {
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_SSL: process.env.DB_SSL,
  NODE_ENV: process.env.NODE_ENV
});

// Database connection pool
const pool = new Pool({
  host: '/cloudsql/pdf2csv-475708:us-central1:pdf2csv-instance',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'pdf2csv_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: false, // Always disable SSL for Cloud SQL Unix socket connections
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Increased timeout for Cloud SQL connection
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Helper function to execute queries
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Helper function to get a client from the pool
export const getClient = async () => {
  return await pool.connect();
};

// Initialize database tables
export const initializeDatabase = async () => {
  console.log('🚀 Starting database initialization...');
  try {
    // Test connection first
    console.log('🔍 Testing database connection...');
    const testResult = await query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful:', testResult.rows[0]);
    // Create customers table
    await query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create collections table
    await query(`
      CREATE TABLE IF NOT EXISTS collections (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add customer_id column to collections table if it doesn't exist
    await query(`
      ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE
    `);

    // Create pre_process_records table
    await query(`
      CREATE TABLE IF NOT EXISTS pre_process_records (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
        full_name VARCHAR(255),
        dateofbirth VARCHAR(50),
        address TEXT,
        mobile VARCHAR(20),
        email VARCHAR(255),
        landline VARCHAR(20),
        lastseen VARCHAR(50),
        file_name VARCHAR(255),
        processing_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create post_process_records table
    await query(`
      CREATE TABLE IF NOT EXISTS post_process_records (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        dateofbirth VARCHAR(50),
        address TEXT,
        mobile VARCHAR(20),
        email VARCHAR(255),
        landline VARCHAR(20),
        lastseen VARCHAR(50),
        file_name VARCHAR(255),
        processing_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create file_metadata table
    await query(`
      CREATE TABLE IF NOT EXISTS file_metadata (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
        original_filename VARCHAR(255),
        cloud_storage_path VARCHAR(500),
        file_size BIGINT,
        processing_status VARCHAR(20) DEFAULT 'processing',
        upload_progress INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add upload_progress column if it doesn't exist
    await query(`
      ALTER TABLE file_metadata
      ADD COLUMN IF NOT EXISTS upload_progress INTEGER DEFAULT 0
    `);

    // Create indexes for performance
    await query(`
      CREATE INDEX IF NOT EXISTS idx_pre_collection_id ON pre_process_records(collection_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_post_collection_id ON post_process_records(collection_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_pre_mobile ON pre_process_records(mobile)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_post_mobile ON post_process_records(mobile)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_file_collection_id ON file_metadata(collection_id)
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
    // Don't throw to prevent app crash
    console.log('⚠️ Continuing without database...');
  }
};

export default pool;
