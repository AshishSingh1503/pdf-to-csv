// server/test-connection.js
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import logger from './src/utils/logger.js';

dotenv.config({ path: path.resolve('.env') });

logger.info('🧪 Testing database connection...');
logger.debug('Environment variables:');
logger.debug('DB_HOST:', process.env.DB_HOST);
logger.debug('DB_PORT:', process.env.DB_PORT);
logger.debug('DB_NAME:', process.env.DB_NAME);
logger.debug('DB_USER:', process.env.DB_USER);
logger.debug('DB_PASSWORD:', process.env.DB_PASSWORD ? '***' : 'undefined');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'pdf2csv_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: false,
});

try {
  const client = await pool.connect();
  logger.info('✅ Database connection successful!');
  
  // Test query
  const result = await client.query('SELECT version()');
  logger.info(`✅ Database version: ${result.rows[0].version}`);
  
  client.release();
  await pool.end();
  logger.info('✅ Connection closed successfully!');
  process.exit(0);
} catch (error) {
  logger.error('❌ Database connection failed: %s', error.message);
  process.exit(1);
}
