# Debugging Batch Processing

This document focuses on practical debugging steps for issues that arise around batch processing (server ↔ WebSocket ↔ UI).

## Common Issues and Actionable Steps

### Issue: Files stuck in 'processing' state

Symptoms
- Files show `processing` indefinitely in the UI and DB.

Steps
1. Check server logs for exceptions in `processPDFFilesParallel`.
2. Verify the heartbeat is still broadcasting (server should emit progress heartbeats every ~15s).
3. Query the database:
   ```sql
   SELECT * FROM file_metadata WHERE processing_status = 'processing' AND created_at < NOW() - INTERVAL '10 minutes';
   ```
4. If server crashed mid-batch, locate last logs and note the `batch_id` used.
5. As a remediation, you can mark files as failed:
   ```sql
   UPDATE file_metadata SET processing_status = 'failed' WHERE batch_id = '<batch_id>';
   ```

Prevention
- Ensure `progressInterval` is cleared in both success and failure paths (look at `finally` blocks in `documentController.js`).

### Issue: Batch events not received in UI

Steps
1. Confirm the WebSocket connection is established in the browser (Network → WS in DevTools).
2. Check websocket server logs for broadcast errors.
3. Inspect the event payloads in DevTools — do events include `collectionId` and `batchId`?
4. Verify `UploadedFilesSidebar.jsx`'s matching logic (collection inference and `batchId` handling).

### Issue: Multiple batches interfering

Steps
1. Inspect `activeBatches` in React DevTools for unexpected keys.
2. Confirm unique `batch_id` values in server logs and DB.
3. Check whether any client-side filtering incorrectly matches unrelated batches.

### Issue: Heartbeat stops prematurely

Steps
1. Search server logs for uncaught exceptions after heartbeat started.
2. Ensure broadcast code is wrapped in try/catch and that errors do not break the heartbeat loop.

### Issue: Batch completion does not refresh file list

Steps
1. Confirm client received `BATCH_PROCESSING_COMPLETED` frame in DevTools.
2. If received, ensure `UploadedFilesSidebar` called `scheduleFetchFiles()` in response.
3. Check server endpoint `/api/files/:collectionId` to confirm it returns updated statuses.

## Useful Commands

- Restart server and tail logs (example):
```powershell
# adjust path and start command as needed
npm run dev
# then watch logs or terminal output
```

- Run quick DB checks (psql example):
```sql
-- find stuck files
SELECT id, original_filename, created_at FROM file_metadata WHERE processing_status = 'processing' AND created_at < NOW() - INTERVAL '10 minutes';
```

## Monitoring points in code

- Server: `documentController.js` — where batches are started, heartbeat emitted, DB insert and cloud upload occur.
- Client: `client/src/components/UploadedFilesSidebar.jsx` — where batch events are handled and state is updated.
- WebSocket: `server/src/services/websocket.js` — broadcast implementation and safety guards.

## Emergency Recovery

1. Identify stuck `batch_id`:
   ```sql
   SELECT DISTINCT batch_id FROM file_metadata WHERE processing_status = 'processing';
   ```
2. Mark all files as failed for that batch:
   ```sql
   UPDATE file_metadata SET processing_status = 'failed' WHERE batch_id = '<batch_id>';
   ```
3. Re-run processing on the collection or re-upload files once root cause is addressed.
