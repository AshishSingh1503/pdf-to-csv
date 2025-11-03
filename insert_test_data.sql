-- Insert test data
INSERT INTO customers (name, email, phone) VALUES ('Test Customer', 'test@example.com', '1234567890') ON CONFLICT DO NOTHING;
INSERT INTO collections (name, description, customer_id) VALUES ('Test Collection', 'Test collection for new database', 1) ON CONFLICT (name) DO NOTHING;