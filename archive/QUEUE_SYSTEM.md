# Queue System

This document explains the server-side FIFO queue (BatchQueueManager) used to manage batch processing.

## Purpose

- Provide a global server-side FIFO queue for batch processing of uploaded PDFs.
- Control concurrency via `MAX_CONCURRENT_BATCHES` and provide predictable ETA/position metadata to clients.
- Protect the server from unbounded memory growth and stuck jobs via `MAX_QUEUE_LENGTH` and per-batch timeouts.

## Configuration (env vars)

- MAX_CONCURRENT_BATCHES - maximum batches processed concurrently. Default: 2 (clamped 1..10).
- MAX_QUEUE_LENGTH - maximum number of queued batches to retain before rejecting new uploads. Default: 100.
- BATCH_QUEUE_TIMEOUT - per-batch processing timeout in milliseconds. Default: 300000 (5m).
- ENABLE_QUEUE_LOGGING - enable verbose queue logging for debugging. Default: false.
- ENABLE_GRACEFUL_SHUTDOWN - whether the server should wait for active batches on shutdown. Default: true unless explicitly set to 'false'.
- GRACEFUL_SHUTDOWN_TIMEOUT - how long to wait for active batches during shutdown (ms). Default: 300000.

## Event contract (server → clients via WebSocket)

- BATCH_QUEUED
  - payload: { type: 'BATCH_QUEUED', batchId, collectionId, fileCount, position, estimatedWaitTime, totalQueued, queueStatus, timestamp }

- BATCH_QUEUE_POSITION_UPDATED
  - payload: { type: 'BATCH_QUEUE_POSITION_UPDATED', batchId, collectionId, position, estimatedWaitTime, totalQueued, reason, timestamp }
  - Debounced by default to limit WS traffic.

- QUEUE_FULL
  - payload: { type: 'QUEUE_FULL', batchId, collectionId, queueLength, maxLength, message, timestamp }
  - Emitted when enqueue is rejected due to queue reaching MAX_QUEUE_LENGTH.

- BATCH_DEQUEUED
  - payload: { type: 'BATCH_DEQUEUED', batchId, collectionId, fileCount, files?, startedAt, totalQueued, activeCount, availableSlots, timestamp }

- BATCH_PROCESSING_STARTED
  - payload: (backwards-compatible started event) same fields as BATCH_DEQUEUED

- BATCH_PROCESSING_COMPLETED / BATCH_PROCESSING_FAILED
  - payload: { type: 'BATCH_PROCESSING_COMPLETED'|'BATCH_PROCESSING_FAILED', batchId, collectionId, fileCount, files, message, error, progress, timestamp }

## API behaviour (server-side)

- Enqueue path returns a `position` integer:
  - 0 = processing started immediately
  - >0 = queued position
  - -1 = validation error or rejected
- If enqueue is rejected due to capacity, server returns HTTP 503 with `{ queueFull: true }`.
- Clients should subscribe to `QUEUE_FULL` and show a friendly retry message.

## Operational notes

- The queue is in-memory and not persisted. On process restart queued batches will be lost. Consider Redis or DB-backed queue for persistence.
- Avoid setting `MAX_QUEUE_LENGTH` too high for memory-constrained environments.
- Use `ENABLE_GRACEFUL_SHUTDOWN=false` for quick restarts when running in ephemeral container environments where waiting for long-running batches is undesirable.

## Recommendations

- Add an admin-only endpoint to view and manage queued batches (cancel/reprioritize) when moving to production.
- Consider moving to a distributed work queue (e.g., BullMQ/Redis) if multiple server instances need to share work.
