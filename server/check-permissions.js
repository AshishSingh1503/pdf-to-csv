import { Pool } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from env.production
dotenv.config({ path: join(__dirname, 'env.production') });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false
});

async function checkPermissions() {
  try {
    console.log('Checking database permissions...');
    
    // Check connection
    const client = await pool.connect();
    console.log('✅ Successfully connected to database');

    // Check table permissions
    const tablePermissions = await client.query(`
      SELECT table_name, privilege_type
      FROM information_schema.table_privileges
      WHERE grantee = $1
      ORDER BY table_name, privilege_type;
    `, [process.env.DB_USER]);
    
    console.log('\nTable Permissions:');
    console.table(tablePermissions.rows);

    // Check role memberships
    const roleQuery = await client.query(`
      SELECT r.rolname, r.rolsuper, r.rolinherit,
             r.rolcreaterole, r.rolcreatedb, r.rolcanlogin,
             r.rolreplication, r.rolconnlimit
      FROM pg_catalog.pg_roles r
      WHERE r.rolname = $1;
    `, [process.env.DB_USER]);
    
    console.log('\nRole Information:');
    console.table(roleQuery.rows);

    // Check schema permissions
    const schemaPermissions = await client.query(`
      SELECT schema_name, privilege_type
      FROM information_schema.schema_privileges
      WHERE grantee = $1;
    `, [process.env.DB_USER]);
    
    console.log('\nSchema Permissions:');
    console.table(schemaPermissions.rows);

    client.release();
  } catch (error) {
    console.error('Error checking permissions:', error);
  } finally {
    await pool.end();
  }
}

checkPermissions();