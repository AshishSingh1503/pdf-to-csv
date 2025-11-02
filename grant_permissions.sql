-- Grant all permissions to pdf2csv_user
GRANT ALL PRIVILEGES ON DATABASE pdf2csv_db TO pdf2csv_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO pdf2csv_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pdf2csv_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pdf2csv_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO pdf2csv_user;

-- Grant permissions on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO pdf2csv_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO pdf2csv_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO pdf2csv_user;

-- Make pdf2csv_user owner of existing tables
ALTER TABLE customers OWNER TO pdf2csv_user;
ALTER TABLE collections OWNER TO pdf2csv_user;
ALTER TABLE pre_process_records OWNER TO pdf2csv_user;
ALTER TABLE post_process_records OWNER TO pdf2csv_user;
ALTER TABLE file_metadata OWNER TO pdf2csv_user;