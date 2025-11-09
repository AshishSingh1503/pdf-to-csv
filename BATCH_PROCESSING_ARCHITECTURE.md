# Batch Processing Architecture

This document describes the architecture, components, and event flow for the batch processing feature.

## Overview

- Purpose: Process groups of PDF files as batches while providing real-time progress via WebSocket.
- Batch size: 25 files (default), split from larger uploads.
- Key components: Backend controller, WebSocket service, frontend sidebar, database.

## Event Flow (summary)

1. User uploads files in `Home.jsx` which POSTs to `/api/documents/process`.
2. Backend writes `file_metadata` rows including a `batch_id` (UUID) and returns.
3. Server broadcasts `BATCH_PROCESSING_STARTED`.
4. Server runs `processPDFFilesParallel` which broadcasts `BATCH_PROCESSING_PROGRESS` messages:
   - `'started'` at beginning
   - periodic heartbeat messages (every ~15s)
   - `'database_insert_complete'` after DB insert
   - `'cloud_upload_complete'` after cloud uploads
5. On success: `BATCH_PROCESSING_COMPLETED` is broadcast; on failure: `BATCH_PROCESSING_FAILED`.
6. Server continues to emit `FILES_PROCESSED` messages (one per file) for backward compatibility.

## Component Responsibilities

- Backend (`documentController.js`)
  - Generate `batch_id` and create file metadata
  - Orchestrate PDF processing and cloud upload
  - Broadcast batch lifecycle events

- WebSocket service (`websocket.js`)
  - Send events to all connected clients with safe error handling

- Database (`FileMetadata.js`)
  - Persist `batch_id` and processing status

- Frontend (`UploadedFilesSidebar.jsx`)
  - Listen for batch events, track `activeBatches` and `batchMessages`
  - Refresh file list when a batch completes

## Schema (file_metadata partial)

- id
- collection_id
- original_filename
- file_size
- processing_status
- upload_progress
- batch_id (NEW)
- created_at
- updated_at

Index on `batch_id` for efficient queries by batch.

## Failure & Recovery

- Heartbeat must be cleared on both success and failure to avoid leaks.
- When failure occurs, server sets all files to `failed` and emits `BATCH_PROCESSING_FAILED`.
- Use DB queries to find stuck files and manually recover if needed.

## Recommendations / Future Work

- Add explicit per-batch metadata table to store start/end timestamps and outcome.
- Implement WebSocket channel scoping (only broadcast to clients subscribed to the collection) to reduce noise.
- Add a retry/cancel API for batches.
- Add server-side metrics for batch durations and success rates.
