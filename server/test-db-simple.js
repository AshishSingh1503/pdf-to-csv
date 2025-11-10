// server/test-db-simple.js
import { Pool } from 'pg';
import logger from './src/utils/logger.js';

logger.info('🧪 Testing database connection with hardcoded values...');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'pdf2csv_db',
  user: 'postgres',
  password: 'postgres',
  ssl: false,
});

try {
  const client = await pool.connect();
  logger.info('✅ Database connection successful!');
  
  // Test query
  const result = await client.query('SELECT version()');
  logger.info(`✅ Database version: ${result.rows[0].version}`);
  
  // Create tables
  logger.info('📋 Creating tables...');
  
  // Create collections table
  await client.query(`
    CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logger.info('✅ Collections table created');
  
  // Create pre_process_records table
  await client.query(`
    CREATE TABLE IF NOT EXISTS pre_process_records (
      id SERIAL PRIMARY KEY,
      collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      full_name VARCHAR(255),
      mobile VARCHAR(20),
      email VARCHAR(255),
      address TEXT,
      dateofbirth VARCHAR(50),
      landline VARCHAR(20),
      lastseen VARCHAR(50),
      file_name VARCHAR(255),
      processing_timestamp TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logger.info('✅ Pre-process records table created');
  
  // Create post_process_records table
  await client.query(`
    CREATE TABLE IF NOT EXISTS post_process_records (
      id SERIAL PRIMARY KEY,
      collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      mobile VARCHAR(20),
      email VARCHAR(255),
      address TEXT,
      dateofbirth VARCHAR(50),
      landline VARCHAR(20),
      lastseen VARCHAR(50),
      file_name VARCHAR(255),
      processing_timestamp TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logger.info('✅ Post-process records table created');
  
  // Create file_metadata table
  await client.query(`
    CREATE TABLE IF NOT EXISTS file_metadata (
      id SERIAL PRIMARY KEY,
      collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
      original_filename VARCHAR(255),
      cloud_storage_path VARCHAR(500),
      file_size BIGINT,
      processing_status VARCHAR(20) DEFAULT 'processing',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logger.info('✅ File metadata table created');
  
  // Create indexes
  await client.query('CREATE INDEX IF NOT EXISTS idx_pre_collection_id ON pre_process_records(collection_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_post_collection_id ON post_process_records(collection_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_pre_mobile ON pre_process_records(mobile)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_post_mobile ON post_process_records(mobile)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_file_collection_id ON file_metadata(collection_id)');
  logger.info('✅ Indexes created');
  
  // Test inserting a collection
  const insertResult = await client.query(
    'INSERT INTO collections (name, description) VALUES ($1, $2) RETURNING *',
    ['Test Collection', 'A test collection for verification']
  );
  logger.info('✅ Test collection created: ' + JSON.stringify(insertResult.rows[0]));
  
  client.release();
  await pool.end();
  logger.info('✅ All tests passed! Database is ready.');
  process.exit(0);
} catch (error) {
  logger.error('❌ Database test failed: %s', error.message);
  process.exit(1);
}
