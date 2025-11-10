// server/src/models/database.js
import { Pool } from 'pg';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || config.dbHost || 'localhost',
  port: parseInt(process.env.DB_PORT) || config.dbPort || 5432,
  database: process.env.DB_NAME || config.dbName || 'pdf2csv_db',
  user: process.env.DB_USER || config.dbUser || 'postgres',
  password: process.env.DB_PASSWORD || config.dbPassword || 'postgres',
  ssl: process.env.DB_HOST?.includes('/cloudsql/')
    ? false
    : process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
  max: config.dbPoolMax || 200, // Maximum number of clients in the pool
  min: config.dbPoolMin || 2,
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Increased timeout for Cloud SQL connection
});

// Test database connection
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err });
  process.exit(-1);
});

// Periodic pool statistics for monitoring
try {
  setInterval(() => {
    try {
      logger.debug('Postgres pool stats', {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      });
    } catch (err) {
      logger.warn('Failed to read pool stats', { err });
    }
  }, 30000);
} catch (err) {
  logger.warn('Failed to schedule pool stats logging', { err });
}

// Helper function to execute queries
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Database query error', { error });
    throw error;
  }
};

// Helper function to get a client from the pool
export const getClient = async () => {
  return await pool.connect();
};

// Initialize database tables
export const initializeDatabase = async () => {
  try {
    // Create customers table
    await query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(100), -- increased from 20 to 100
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
        status VARCHAR(100) DEFAULT 'active', -- increased from 20 to 100
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
        mobile VARCHAR(100), -- increased from 20 to 100
        email VARCHAR(255),
        address TEXT,
        dateofbirth VARCHAR(50),
        landline VARCHAR(100), -- increased from 20 to 100
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
        full_name VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        mobile VARCHAR(100), -- increased from 20 to 100
        email VARCHAR(255),
        address TEXT,
        dateofbirth VARCHAR(50),
        landline VARCHAR(100), -- increased from 20 to 100
        lastseen VARCHAR(50),
        file_name VARCHAR(255),
        processing_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create removed_records table
    await query(`
      CREATE TABLE IF NOT EXISTS removed_records (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
        full_name VARCHAR(255),
        file_name VARCHAR(255),
        rejection_reason VARCHAR(255),
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
        processing_status VARCHAR(100) DEFAULT 'processing', -- increased from 20 to 100
        upload_progress INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add upload_progress column if it doesn't exist
    await query(`
      ALTER TABLE file_metadata
      ADD COLUMN IF NOT EXISTS upload_progress INTEGER DEFAULT 0
    `);

    // Add batch_id to file_metadata if missing (safe to run repeatedly)
    await query(`
      ALTER TABLE file_metadata
      ADD COLUMN IF NOT EXISTS batch_id VARCHAR(50)
    `);

    // Create index on batch_id for quick aggregations
    await query(`
      CREATE INDEX IF NOT EXISTS idx_file_metadata_batch_id ON file_metadata(batch_id)
    `);

    // Add full_name column to post_process_records if it doesn't exist
    await query(`
      ALTER TABLE post_process_records
      ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)
    `);

    // ✅ Ensure existing columns have correct sizes
    await query(`ALTER TABLE customers ALTER COLUMN phone TYPE VARCHAR(100);`);
    await query(`ALTER TABLE collections ALTER COLUMN status TYPE VARCHAR(100);`);
    await query(`ALTER TABLE pre_process_records ALTER COLUMN mobile TYPE VARCHAR(100);`);
    await query(`ALTER TABLE pre_process_records ALTER COLUMN landline TYPE VARCHAR(100);`);
    await query(`ALTER TABLE post_process_records ALTER COLUMN mobile TYPE VARCHAR(100);`);
    await query(`ALTER TABLE post_process_records ALTER COLUMN landline TYPE VARCHAR(100);`);
    await query(`ALTER TABLE file_metadata ALTER COLUMN processing_status TYPE VARCHAR(100);`);

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
    await query(`
      CREATE INDEX IF NOT EXISTS idx_removed_collection_id ON removed_records(collection_id)
    `);

    logger.info('Database tables initialized and verified successfully');
  } catch (error) {
    logger.error('Error initializing database:', error);
    throw error;
  }
};

export default pool;
