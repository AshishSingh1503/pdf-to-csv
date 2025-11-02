-- Grant basic permissions to pdf2csv_user
GRANT CONNECT ON DATABASE pdf2csv_db TO pdf2csv_user;
GRANT USAGE ON SCHEMA public TO pdf2csv_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pdf2csv_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pdf2csv_user;