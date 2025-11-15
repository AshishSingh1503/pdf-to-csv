-- UP MIGRATION
-- Adds cloud_storage_path_raw and cloud_storage_path_processed to the file_metadata table.
-- Backfills cloud_storage_path_raw from the existing cloud_storage_path column.

-- 1. Add the new columns
ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS cloud_storage_path_raw VARCHAR(500);
ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS cloud_storage_path_processed VARCHAR(500);

-- 2. Backfill the raw path from the existing column (run this only once)
-- Condition ensures it only runs if the column has been freshly added and not yet backfilled.
DO $$
BEGIN
   IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='file_metadata' AND column_name='cloud_storage_path_raw') THEN
      UPDATE file_metadata SET cloud_storage_path_raw = cloud_storage_path WHERE cloud_storage_path_raw IS NULL AND cloud_storage_path IS NOT NULL;
   END IF;
END $$;

-- 3. Add an index for quicker lookups on the raw path
CREATE INDEX IF NOT EXISTS idx_file_metadata_raw_path ON file_metadata(cloud_storage_path_raw);


-- DOWN MIGRATION
-- Removes the new columns from the file_metadata table.

ALTER TABLE file_metadata DROP COLUMN IF EXISTS cloud_storage_path_raw;
ALTER TABLE file_metadata DROP COLUMN IF EXISTS cloud_storage_path_processed;
