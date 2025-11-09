-- Drop existing tables and recreate with pdf2csv_user ownership
DROP TABLE IF EXISTS file_metadata CASCADE;
DROP TABLE IF EXISTS post_process_records CASCADE;
DROP TABLE IF EXISTS pre_process_records CASCADE;
DROP TABLE IF EXISTS collections CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
-- Align privileges and ownership with setup_new_db.sql
-- Grant and default privileges for application role
GRANT ALL PRIVILEGES ON DATABASE pdf2csv_new_db TO pdf2csv_app_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO pdf2csv_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO pdf2csv_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO pdf2csv_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO pdf2csv_app_user;

-- Create tables as application role
SET ROLE pdf2csv_app_user;

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE collections (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pre_process_records (
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
);

CREATE TABLE post_process_records (
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
);

CREATE TABLE file_metadata (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  original_filename VARCHAR(255),
  cloud_storage_path VARCHAR(500),
  file_size BIGINT,
  processing_status VARCHAR(20) DEFAULT 'processing',
  upload_progress INTEGER DEFAULT 0,
  batch_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_batch_id ON file_metadata(batch_id);

-- Transfer ownership to application role
ALTER TABLE customers OWNER TO pdf2csv_app_user;
ALTER TABLE collections OWNER TO pdf2csv_app_user;
ALTER TABLE pre_process_records OWNER TO pdf2csv_app_user;
ALTER TABLE post_process_records OWNER TO pdf2csv_app_user;
ALTER TABLE file_metadata OWNER TO pdf2csv_app_user;

-- Grant sequence permissions to application role
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pdf2csv_app_user;

-- Insert test data
INSERT INTO customers (name, email, phone) VALUES ('Test Customer', 'test@example.com', '1234567890');
INSERT INTO collections (name, description, customer_id) VALUES ('Test Collection', 'Test collection', 1);