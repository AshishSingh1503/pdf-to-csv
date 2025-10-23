// server/test-connection.js
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

console.log('🧪 Testing database connection...');
console.log('Environment variables:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '***' : 'undefined');

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
  console.log('✅ Database connection successful!');
  
  // Test query
  const result = await client.query('SELECT version()');
  console.log('✅ Database version:', result.rows[0].version);
  
  client.release();
  await pool.end();
  console.log('✅ Connection closed successfully!');
  process.exit(0);
} catch (error) {
  console.error('❌ Database connection failed:', error.message);
  process.exit(1);
}
