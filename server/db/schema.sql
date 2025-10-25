-- server/db/schema.sql
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(50),
  created_at DATETIMEOFFSET DEFAULT GETDATE(),
  updated_at DATETIMEOFFSET DEFAULT GETDATE()
);
ALTER TABLE collections ADD customer_id INTEGER REFERENCES customers(id);
