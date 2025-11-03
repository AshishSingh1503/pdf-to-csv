-- Connect as postgres and grant permissions to pdf2csv_user
GRANT ALL PRIVILEGES ON DATABASE pdf2csv_db TO pdf2csv_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO pdf2csv_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pdf2csv_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pdf2csv_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO pdf2csv_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO pdf2csv_user;

-- Transfer table ownership
ALTER TABLE customers OWNER TO pdf2csv_user;
ALTER TABLE collections OWNER TO pdf2csv_user;
ALTER TABLE pre_process_records OWNER TO pdf2csv_user;
ALTER TABLE post_process_records OWNER TO pdf2csv_user;
ALTER TABLE file_metadata OWNER TO pdf2csv_user;

-- Grant sequence permissions
GRANT ALL ON SEQUENCE customers_id_seq TO pdf2csv_user;
GRANT ALL ON SEQUENCE collections_id_seq TO pdf2csv_user;
GRANT ALL ON SEQUENCE pre_process_records_id_seq TO pdf2csv_user;
GRANT ALL ON SEQUENCE post_process_records_id_seq TO pdf2csv_user;
GRANT ALL ON SEQUENCE file_metadata_id_seq TO pdf2csv_user;