-- database_validation_queries.sql
-- SQL queries to validate batch processing behavior

-- Query 1: Verify batch_id consistency for recent batches
-- Returns batch_id, file_count and a sample of file names
SELECT batch_id,
       COUNT(*) AS file_count,
       array_agg(original_filename) AS files
FROM file_metadata
WHERE batch_id IS NOT NULL
GROUP BY batch_id
ORDER BY MAX(created_at) DESC
LIMIT 10;

-- Query 2: Find files stuck in 'processing' older than 10 minutes
SELECT id, original_filename, batch_id, processing_status, created_at
FROM file_metadata
WHERE processing_status = 'processing'
  AND created_at < NOW() - INTERVAL '10 minutes'
ORDER BY created_at ASC;

-- Query 3: Batch completion statistics (completed vs failed)
SELECT batch_id,
       COUNT(*) AS total_files,
       SUM(CASE WHEN processing_status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) AS failed
FROM file_metadata
WHERE batch_id IS NOT NULL
GROUP BY batch_id
ORDER BY MAX(created_at) DESC
LIMIT 20;

-- Query 4: Recent batch activity (last 5 batches)
SELECT batch_id,
       collection_id,
       COUNT(*) AS file_count,
       MIN(created_at) AS batch_start,
       MAX(created_at) AS batch_end,
       array_agg(DISTINCT processing_status) AS statuses
FROM file_metadata
WHERE batch_id IS NOT NULL
GROUP BY batch_id, collection_id
ORDER BY batch_start DESC
LIMIT 5;

-- Query 5: Recently uploaded files without batch_id (should be none)
SELECT id, original_filename, processing_status, created_at
FROM file_metadata
WHERE batch_id IS NULL
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 50;

-- Query 6: Batch processing time analysis (per-batch)
SELECT batch_id,
       COUNT(*) AS files,
       MIN(created_at) AS start_time,
       MAX(updated_at) AS end_time,
       EXTRACT(EPOCH FROM (MAX(updated_at) - MIN(created_at))) AS duration_seconds
FROM file_metadata
WHERE batch_id IS NOT NULL
GROUP BY batch_id
ORDER BY start_time DESC
LIMIT 10;

-- Query 7: Collection-specific batch summary (replace $1 with collection_id)
-- Example: SELECT ... FROM (...) WHERE collection_id = 42
SELECT batch_id, COUNT(*) AS files, array_agg(DISTINCT processing_status) AS statuses
FROM file_metadata
WHERE collection_id = $1
  AND batch_id IS NOT NULL
GROUP BY batch_id
ORDER BY MAX(created_at) DESC
LIMIT 20;

-- Notes:
-- - Run Query 2 to quickly find stuck files.
-- - Query 1 and Query 3 are helpful for sanity checks and auditing recent batches.
-- - If you find issues, consider checking server logs for errors during the processing window.
