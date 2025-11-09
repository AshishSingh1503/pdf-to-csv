-- Migration: add_batch_id_to_file_metadata.sql
-- Purpose: Add batch_id column to file_metadata table and create index
-- Date: 2025-11-08

-- Add column if it doesn't exist
ALTER TABLE file_metadata
  ADD COLUMN IF NOT EXISTS batch_id VARCHAR(50);

-- Create index on batch_id for faster queries
CREATE INDEX IF NOT EXISTS idx_file_metadata_batch_id ON file_metadata(batch_id);

-- Rollback (for reference):
-- ALTER TABLE file_metadata DROP COLUMN IF EXISTS batch_id;
-- DROP INDEX IF EXISTS idx_file_metadata_batch_id;
