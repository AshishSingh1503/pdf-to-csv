-- Drop existing tables and recreate with pdf2csv_user ownership
DROP TABLE IF EXISTS file_metadata CASCADE;
DROP TABLE IF EXISTS post_process_records CASCADE;
DROP TABLE IF EXISTS pre_process_records CASCADE;
DROP TABLE IF EXISTS collections CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- Create tables as pdf2csv_user
SET ROLE pdf2csv_user;

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

-- Insert test data
INSERT INTO customers (name, email, phone) VALUES ('Test Customer', 'test@example.com', '1234567890');
INSERT INTO collections (name, description, customer_id) VALUES ('Test Collection', 'Test collection', 1);