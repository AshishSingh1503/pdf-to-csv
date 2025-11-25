# Batch Processing — Testing Guide

This guide describes how to manually and semi-automatically test the batch processing feature (server + websocket + UI).

Date: 2025-11-09

## Prerequisites

- A running local instance of the application (server and client). Start the server with your normal command (for example: `npm run start` in `server/` or the workspace root if configured).
- A Postgres connection to the project's database and credentials that allow reading the `file_metadata` table.
- Browser with DevTools (Chrome, Edge, or Firefox recommended).
- A collection available in the UI with write/upload permissions.
- Test PDF files: prepare at least 25 small PDFs to trigger batch processing. Put them in a directory such as `test_files/25_pdfs/`.

## Manual Testing Procedures

### Test Case 1 — Complete Batch Upload Flow (25+ files)

1. Open the web app and select the collection you will test against.
2. Open the Developer Tools → Network → WS (WebSocket) filter.
3. Upload 25 PDF files using the UI. Observe the HTTP upload progress and ensure the POST request returns 200.
4. Expected server behaviour (approx):
   - Immediately: `BATCH_PROCESSING_STARTED` WebSocket event with `{ batchId, collectionId, fileCount }`.
   - Shortly after: `BATCH_PROCESSING_PROGRESS` with status `'started'`.
   - Every ~15s: `BATCH_PROCESSING_PROGRESS` heartbeat messages while the batch is processing.
   - After DB writes: `BATCH_PROCESSING_PROGRESS` with status `'database_insert_complete'`.
   - After cloud uploads: `BATCH_PROCESSING_PROGRESS` with status `'cloud_upload_complete'`.
   - Finally: `BATCH_PROCESSING_COMPLETED` with the final batch summary.
   - Multiple `FILES_PROCESSED` events should arrive (one per file) as file records are updated.
5. On UI: the `UploadedFilesSidebar` should display a batch entry in "Processing batches", show progress (if provided), update elapsed time, and remove the batch after completion. The file list should refresh and show `processing_status = 'completed'`.

### Test Case 2 — WebSocket Event Order Verification

1. In DevTools Network → WS, click the WebSocket connection and inspect incoming frames.
2. Upload a 5–10 file batch to generate events faster for manual inspection.
3. Expected sequence (frames):
   1. `BATCH_PROCESSING_STARTED`
   2. `BATCH_PROCESSING_PROGRESS` (status: 'started')
   3. One or more `BATCH_PROCESSING_PROGRESS` (heartbeat every ~15s) while processing
   4. `BATCH_PROCESSING_PROGRESS` (status: 'database_insert_complete')
   5. `BATCH_PROCESSING_PROGRESS` (status: 'cloud_upload_complete')
   6. `BATCH_PROCESSING_COMPLETED`
   7. `FILES_PROCESSED` events (per file)
4. Capture screenshots or save the WS frames for reference.

### Test Case 3 — UI Batch Progress Display

1. While the batch is running, open the `UploadedFilesSidebar`.
2. Confirm the "Processing batches (X)" header appears and lists the active batch(es).
3. For each batch, verify:
   - The message text reflects the stage.
   - The elapsed time increments.
   - If `batch.progress` is provided, a progress bar and numeric percent are visible and update.
   - Milestone messages (DB insert, cloud upload) appear in the Recent Batch Messages list.
4. When the batch completes, the success message should appear and auto-dismiss after ~5s. The file list should refresh and show final statuses.

### Test Case 4 — Failure Scenarios

#### Scenario A — Simulated Document AI failure or timeout

1. Either set invalid credentials for Document AI calls (in a safe test environment) or temporarily block calls to the remote API.
2. Upload a 10–25 file batch.
3. Expected: the server should detect failure, mark file metadata statuses as `'failed'`, broadcast `BATCH_PROCESSING_FAILED`, and the UI should show error messages for the batch and mark files as failed.

#### Scenario B — Network interruption during upload

1. In DevTools Network tab select "Offline" or throttle to "Slow 3G" during the upload.
2. Observe whether uploads retry or fail gracefully. Expect the UI to show failed uploads or eventually recover when network is restored.

#### Scenario C — Cloud storage upload failure

1. Simulate an error in Cloud Storage (e.g., revoke write permission for the test bucket) or mock the cloud upload to return an error.
2. Upload files and verify `BATCH_PROCESSING_FAILED` is broadcast and that file records are marked as failed.

### Test Case 5 — Multiple Concurrent Batches

1. Upload 50 files quickly (or from two browser windows) to trigger two concurrent batches.
2. Verify the UI displays `Processing batches (2)` and shows distinct entries for each `batchId`.
3. Confirm both batches progress independently and complete without cross-contamination.

### Test Case 6 — Database Validation

1. After a batch completes, run the SQL validation queries in `sql/database_validation_queries.sql` (see the SQL file for exact queries).
2. Verify that all files in a batch have the same `batch_id`, and that `processing_status` is either `completed` or `failed` (none in `processing`).

## Debugging tips

- If you see events but the UI doesn't update, check `UploadedFilesSidebar`'s `collectionId` matching logic and whether the socket handler is attached.
- If files are stuck in `processing`, inspect server logs for exceptions in `processPDFFilesParallel` and confirm `clearInterval` is being executed.
- Use React DevTools to inspect `UploadedFilesSidebar` state (`activeBatches`, `batchMessages`, `files`).

## Queue-related Tests

These tests focus on the BatchQueueManager behaviour and should be run in an isolated environment.

1. Queue Overflow (MAX_QUEUE_LENGTH)
   - Configure `MAX_QUEUE_LENGTH` to a small value (e.g., 3) in a test env.
   - Rapidly send 10 concurrent upload requests. Expect:
     - First N requests accepted (where N depends on active slots and queue length), subsequent requests receive HTTP 503 with `{ queueFull: true }`.
     - A `QUEUE_FULL` WebSocket broadcast is emitted when the queue rejects.

2. Per-batch Timeout
   - Set `BATCH_QUEUE_TIMEOUT` to a low value (e.g., 5000 ms).
   - Start a batch that intentionally hangs in the processor (mock the processor to sleep longer).
   - Expect `batch:timeout` event, `BATCH_PROCESSING_FAILED` broadcast, slot release, and that subsequent queued batches start.

3. Position Update Debouncing
   - Enqueue several batches and trigger multiple position-changing events quickly (enqueue/dequeue).
   - Verify that `BATCH_QUEUE_POSITION_UPDATED` events are debounced by the configured interval and that counters in `/api/admin/queue-metrics` show `positionUpdatesEmitted` and `positionUpdatesSuppressed` metrics.

4. Graceful Shutdown
   - With `ENABLE_GRACEFUL_SHUTDOWN=true`, start a long-running batch and send SIGTERM to the server.
   - Verify the server calls `prepareShutdown()`, waits up to `GRACEFUL_SHUTDOWN_TIMEOUT` for active batches, and exits gracefully.
   - With `ENABLE_GRACEFUL_SHUTDOWN=false`, the server should close immediately without waiting for active batches.

## Quick commands

Run server (example, adjust to your project scripts):
```powershell
# from workspace root
npm run dev
```

Run test script (requires Node dependencies listed in the script file):
```powershell
node ../test_scripts/batch_upload_test.js
```

## Known limitations

- Tests that simulate cloud failures or Document AI errors may require modifying runtime credentials or using a staging/test project.
- The success auto-dismiss is time-based (5s); adjust if necessary during testing.

---

For step-by-step SQL queries and automated scripts, see `sql/database_validation_queries.sql` and `../test_scripts/batch_upload_test.js`.
