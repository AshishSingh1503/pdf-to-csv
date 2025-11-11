# pdf-to-csv — Comprehensive Technical Architecture Guide

This file is a detailed, comprehensive architecture guide describing the project architecture, files, runtime behavior, event contracts, deployment guidance for GCP, capabilities and limitations, and recommended performance and reliability improvements.

Note: This is the comprehensive technical architecture guide. For quickstart and user-facing documentation, see the main `README.md` in the repository root. For operational documentation about batch processing, queue system, and admin APIs, see the root-level markdown files.

Last updated: 2025-11-11

## Table of contents

1. Project summary
2. High-level architecture
3. File & directory walkthrough (complete)
4. Event contracts and WebSocket messages
5. API endpoints — quick reference
6. Configuration and environment variables
7. Local development (Windows PowerShell)
8. Production deployment on Google Cloud Platform (two approaches)
9. Capabilities and limitations
10. Concrete performance & reliability improvements (prioritized)
11. Observability, testing and CI/CD guidance
12. Legacy / cleanup notes (Python/Streamlit)
13. Next steps and suggested roadmap
14. Appendix: commands and SQL snippets

---

## 1) Project summary

`pdf-to-csv` is an intelligent document processing application. It accepts PDF uploads grouped into batches, processes them (via Document AI or a custom parser), stores raw and validated records in a database (pre/post-process tables), uploads processed assets to cloud storage, and provides a dynamic UI for monitoring and downloading results.

Key attributes:
- Iterative, event-driven pipeline with per-file and per-batch state.
- Server-centered FIFO queueing (in-memory) with configurable concurrency and capacity.
- Rich WebSocket events so the front-end can show queue position, ETA, per-file progress, and completion/failure states.

Important constraint: the queue is in-memory (singleton) and therefore not distributed. Read "Limitations" and the Migration Plan later for options to make the system horizontally scalable.

---

## 2) High-level architecture

- Client (React) sends uploads to REST API endpoints and maintains a WebSocket connection to receive real-time updates.
- Server (Express) persists file metadata, enqueues batches, and coordinates processing.
- `BatchQueueManager` (singleton) enforces concurrency limits and emits enriched events for clients and admin consumers.
- Processing is done in-process by worker code (`processPDFFilesParallel`) which:
  - Calls the Document AI client (or local parser),
  - Prepares and inserts DB records (chunked inserts),
  - Uploads processed files to Cloud Storage,
  - Updates `FileMetadata` statuses and broadcasts `FILES_PROCESSED` events.

Dataflow summary:

```
Client (upload) -> Server REST -> persist FileMetadata -> enqueue(batch) -> queue manager -> worker -> DB inserts + storage upload -> file status updates -> WebSocket broadcasts -> client UI
```

Design tradeoffs made:
- In-memory queue: easy to implement and low-latency; not resilient across instance restarts and not horizontally scalable.
- DB-first approach: file metadata is persisted before queueing to avoid losing references if the server crashes before processing.
- Per-file status updates: clients get deterministic state even when reconnecting.

---

## 3) File & directory walkthrough (detailed)

-- Top-level and important files (brief descriptions):

- `README.md` — main user-facing documentation (overview + quickstart)
- `docs/ARCHITECTURE.md` — this comprehensive technical guide (you are reading it now)
- `deploy.sh`, `setup-gcp.sh`, `cloud-run-config.yaml` — deployment helpers (read and adapt before running in production).
- SQL scripts: `setup_new_db.sql` (canonical setup), `docs/sql/` (reference queries and test data) — DDL and seed scripts. See `docs/DATABASE.md` for complete database documentation.
- `old_for_streamlit/` — legacy Python/Streamlit experiments (not used in current Node deployment).

Server-side (primary runtime files are under `server/src/`):

- `server/index.js`
  - App entrypoint. Bootstraps Express, mounts routes, starts HTTP + WebSocket servers, and handles graceful shutdown. Registers SIGINT/SIGTERM handlers that call `BatchQueueManager.prepareShutdown()` and optionally wait for active batches to finish per config.

- `server/src/config/index.js`
  - Centralized configuration loader. Parses env variables, clamps values, exposes defaults such as `maxConcurrentBatches`, `batchQueueTimeout`, `averageBatchSeconds`, `maxQueueLength`, `enableGracefulShutdown`, and `gracefulShutdownTimeout`.

- `server/src/services/batchQueueManager.js`
  - Singleton EventEmitter-based queue manager. Key responsibilities:
    - `enqueue(batch)` — adds a batch to the FIFO queue, returns a position or `-1` on validation error.
    - `dequeue()` / `processNext()` — pulls the next batch if slots available and triggers `processorFunction` for the batch.
    - `releaseBatch(batchId)` — called when processing completes/throws; clears per-batch timeout timers and emits `batch:completed` events.
    - Per-batch timeouts: if a batch exceeds `BATCH_QUEUE_TIMEOUT_MS`, `batch:timeout` is emitted and the controller marks files as failed (prevents stuck 'processing' states).
    - Debounced position updates: frequent `position` recalculations are debounced and emitted as `batch:position-updated` with a reason (slot freed, dequeue, enqueue), suppressing spammy updates.
    - `canAcceptNewBatch()` and `MAX_QUEUE_LENGTH` enforcement: reject new enqueues when capacity is hit and broadcast `queue:full` events.
    - Metrics: counters for total enqueued, processed, failed, timings, and emitted/suppressed position updates.

- `server/src/services/websocket.js`
  - Minimal WebSocket server wrapper that tracks clients and offers `broadcast(payload)` helper. The controller and queue manager use this to communicate with the UI.

- `server/src/controllers/documentController.js`
  - Main controller for uploads and batch processing. Responsibilities:
    - `processDocuments(req, res)` — handles file upload, validates collectionId, creates `FileMetadata` rows (status=`processing`), generates `batchId`, and enqueues via `batchQueueManager.enqueue()`.
    - Pre-enqueue capacity check: calls `batchQueueManager.canAcceptNewBatch()` to avoid creating DB rows when capacity is already exhausted (returns HTTP 503 and broadcasts `QUEUE_FULL` when needed).
    - After enqueue: recalculates position via `getQueuePosition(batchId)`, attaches `queueStatus` metadata (queueLength, availableSlots, averageWaitTimeSeconds, estimatedWaitTime) to response.
    - Event listeners: subscribes to batch/queue events (`batch:enqueued`, `batch:dequeued`, `batch:completed`, `batch:timeout`, `batch:position-updated`) and broadcasts friendly messages with attached metadata.
    - Processing adapter `processBatchWrapper` that calls `processPDFFilesParallel(... )` and re-throws errors for the queue manager to handle.

- `server/src/services/documentProcessor.js`
  - Implements `processPDFs` used by `processPDFFilesParallel`. It's the interface to Document AI or local parsing logic. It returns arrays of raw/filter/removed records used for DB insertion.

- `server/src/models/` (ORM-like simple wrappers):
  - `FileMetadata.js` — helpers for creating, finding by batchId, updating status (`updateStatus('completed'|'failed')`), `countByStatusForBatch` to compute progress.
  - `PreProcessRecord.js`, `PostProcessRecord.js`, `RemovedRecord.js` — DB model helpers with `bulkCreate()` and `findAll()` operations.
  - `Collection.js`, `Customer.js` — small helpers used by UI and controllers.
  - `database.js` — DB client and pool initialization.

- `server/src/routes/`:
  - `documentRoutes.js` — routes mapping to controller functions.
  - `adminRoutes.js` — admin endpoints (queue-status, queue-metrics, metrics reset). Middleware checks API key from env.

Client-side (`client/`):

- `client/src/pages/Home.jsx` — central UI page. Upload flow splits files into batches (configurable chunk size), sequentially uploads batches using `uploadAndProcess()` from `client/src/api/documentApi.js`, and shows an `UploadedFilesSidebar` for status. The upload loop was updated to detect HTTP 503 and show capacity messages and stop further batches if server is at capacity.

- `client/src/components/UploadedFilesSidebar.jsx` — listens to WebSocket events and displays queued batches, processing batches, per-file status, and messages like `QUEUE_FULL`. It handles `BATCH_DEQUEUED`, `BATCH_PROCESSING_STARTED`, `FILES_PROCESSED`, `BATCH_QUEUE_POSITION_UPDATED`, and `BATCH_PROCESSING_COMPLETED`.

- `client/src/api/documentApi.js` — `uploadAndProcess(files, collectionId, onUploadProgress)` wrapper around axios that posts to `/api/documents/process` with multipart/form-data.

- Other components: `ClientTable.jsx`, `ResultTable.jsx`, `Header.jsx`, `Footer.jsx`, `ProgressBar.jsx`, etc.

Misc:
- `client/Dockerfile` and `server/Dockerfile` exist for containerization.

---

## 4) Event contracts (summary)

Clients rely on typed events. The minimal set (most important) are:

- `BATCH_QUEUED` — { batchId, collectionId, fileCount, position, estimatedWaitTime, totalQueued }
- `BATCH_DEQUEUED` — { batchId, collectionId, fileCount, files?, startedAt, totalQueued, activeCount, availableSlots }
- `BATCH_PROCESSING_STARTED` — mirrors dequeued (compat)
- `BATCH_PROCESSING_PROGRESS` — periodic updates (progress % or heartbeat)
- `BATCH_PROCESSING_COMPLETED` — final success message with refreshed file metadata
- `BATCH_PROCESSING_FAILED` — batch-level failure with partial flag and per-file updates
- `FILES_PROCESSED` — per-file status updates (includes both `fileMetadata` (camelCase) and `file_metadata` (snake_case) for compatibility)
- `QUEUE_FULL` — server-side capacity signal (includes `collectionId` when available)
- `BATCH_QUEUE_POSITION_UPDATED` — debounced position updates with estimated wait time

Design note: consumers should treat `FILES_PROCESSED` as the canonical per-file update and use `BATCH_*` messages for high-level grouping and UI placement. All messages include timestamps and relevant ids to allow deterministic UI updates.

---

## 5) API endpoints — quick reference

- POST `/api/documents/process` — uploads + enqueue. Responses:
  - 200: { success:true, batchId, files, position, message, queue metadata }
  - 503: { success:false, error: 'Server is at capacity', queueFull:true }
- GET `/api/documents/files/collection/:collectionId` — list files
- GET `/api/documents/batches/:batchId` — batch file counts and statuses
- POST `/api/documents/reprocess/:fileId` — reprocess a single file
- POST `/api/documents/upload/progress/:fileId` — update upload progress
- GET `/api/admin/queue-status` — admin queue info (API key protected)
- GET `/api/admin/queue-metrics` — metrics
- POST `/api/admin/metrics/reset` — reset counters

---

## 6) Configuration and env variables (server highlights)

- MAX_QUEUE_LENGTH — max queued batches (hard backpressure)
- MAX_CONCURRENT_BATCHES — number of parallel processing slots
- BATCH_QUEUE_TIMEOUT_MS — per-batch processing timeout
- AVERAGE_BATCH_SECONDS — baseline used to estimate wait time
- ENABLE_GRACEFUL_SHUTDOWN — whether the server waits for active batches on termination
- GRACEFUL_SHUTDOWN_TIMEOUT — how long to wait during shutdown

Security & GCP:
- GOOGLE_APPLICATION_CREDENTIALS — local path to service account (use Secret Manager in production)
- DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD for Cloud SQL
- CLOUD_STORAGE_BUCKET name(s)

---

## 7) Local development (Windows PowerShell) — quick commands

1) Start local Postgres (Docker):

```powershell
docker run --name pdf2csv-db -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=pdf2csv -p 5432:5432 -d postgres:15
```

2) Install dependencies and start servers:

```powershell
# Backend
cd .\server
npm install
$env:DATABASE_URL='postgres://postgres:pass@localhost:5432/pdf2csv'
npm run dev

# Frontend (separate terminal)
cd ..\client
npm install
npm run dev
```

3) Test an upload (curl example):

```powershell
curl -v -X POST http://localhost:5000/api/documents/process -F "pdfs=@test1.pdf" -F "collectionId=1"
```

---

## 8) Production deployment on GCP — two practical approaches

Option A — Single-instance Cloud Run (quick, minimal changes)
- Build & deploy server container to Cloud Run.
- Set `max-instances=1` to guarantee a single authoritative in-memory queue.
- Use Cloud SQL (Postgres) with the Cloud SQL Auth connector and store credentials in Secret Manager.
- Use a GCS bucket for uploads/outputs. Grant the service account Storage Object Admin rights.

Pros: easy and quick. Cons: limited availability and single point of failure.

Option B — Distributed and highly available (recommended for scale)
- Move queue to Pub/Sub or Cloud Tasks (durable) or Redis (fast, shared).
- Implement worker service(s) that subscribe to tasks/messages and run processing.
- Use Cloud Run for both API and workers or GKE for large-scale workers.
- Use PgBouncer and tune DB pool sizes.

Pros: horizontally scalable and resilient. Cons: larger refactor, new infra costs.

GCP tips & checklist:
- Use Secret Manager for DB credentials and API keys.
- Use service accounts with least privilege for Cloud SQL and Cloud Storage.
- Monitor queue length and processing times in Cloud Monitoring; create alerts.
- Use Cloud Build or GitHub Actions + Cloud Build for CI/CD.

---

## 9) Capabilities and limitations (recap)

Capabilities:
- Real-time UI with precise file-level updates
- Admin endpoints for introspection
- Configurable concurrency and queue capacity
- Chunked DB writes and parallel uploads

Limitations:
- In-memory queue = single-node semantics
- Potential single point of failure during long-running processing
- ETA approximations are heuristic
- DB and storage rate limits can be bottlenecks without tuning

---

## 10) Concrete performance & reliability improvements (prioritized)

(Short descriptions, impact, effort estimate)

A. Migrate queue to Pub/Sub/Cloud Tasks + worker services (Impact: High, Effort: Medium–High)
B. Use Redis (Memorystore) for shared queue/position and short-term metrics (Impact: High, Effort: Medium)
C. Add DB indexes and PgBouncer (Impact: High for scaling DB, Effort: Small–Medium)
D. Add Cloud Monitoring metrics + alerts (Impact: Medium, Effort: Small)
E. Add end-to-end tests including mocked Document AI (Impact: High, Effort: Medium)
F. Implement graceful retry & idempotency patterns in worker processing (Impact: High, Effort: Medium)

Implementation notes: provide idempotency tokens on batches (store `processing_started_at` and `processor_token`) so retries from Pub/Sub or workers don't duplicate outputs.

---

## 11) Observability, testing, and CI/CD

Observability:
- Export `BatchQueueManager.getMetrics()` to a custom Cloud Monitoring metric.
- Log structured JSON for key events (batch enqueue/dequeue/timeout, file status changes, DB errors).
- Create dashboards for: queueLength, activeCount, averageBatchTime, failure rate.

Testing:
- Unit tests: mock DB and timers for queue manager.
- Integration tests: local Cloud SQL or test Postgres container. Use a CI job with ephemeral DB.
- E2E: Playwright test for upload -> processing -> completion flows.

CI/CD:
- Use GitHub Actions or Cloud Build to run lint, tests, and build containers.
- Promote images to production via manual approvals or deploy to a staging Cloud Run service first.

---

## 12) Legacy / cleanup notes (Python/Streamlit)

Files and directories under `old_for_streamlit/` and root-level `.py` files (e.g. `app.py`, `run_app.py`) are legacy prototypes. They are not referenced by the Node.js code paths. Recommended housekeeping:
- Move to `archive/legacy-python/` or delete if you do not need them.
- Keep `requirements.txt` only if you plan to maintain the Python prototype.

---

## 13) Next steps and suggested roadmap

1. Decide: Single-instance Cloud Run (fast) or migrate to distributed queue (long-term scalable). If you pick single-instance, set `max-instances=1` and create robust backups/alerts.
2. Add DB indexes and PgBouncer for scaling.
3. Add metrics and Cloud Monitoring dashboards.
4. Add integration and E2E testing in CI.
5. Start a migration branch to Pub/Sub/Cloud Tasks + worker services.

---

## 14) Appendix: useful commands & SQL snippets

Reset DB locally (recommended):
```powershell
# For local development, manually drop tables then run setup
# DROP TABLE IF EXISTS file_metadata, post_process_records, pre_process_records, collections, customers CASCADE;
psql -h localhost -U postgres -d pdf2csv -f setup_new_db.sql
```

# Note: `recreate_db.sql` has been archived to `archive/recreate_db.sql`. Use the manual DROP + `setup_new_db.sql` approach for local resets.

Cloud SQL connect:
```powershell
gcloud sql connect <INSTANCE_NAME> --user=postgres --project=$PROJECT_ID
```

Export metrics (example approach): instrument `BatchQueueManager` to POST metrics to Stackdriver custom metrics endpoint or use an exporter.

---

For additional documentation:
- See `docs/DEBUGGING.md` for troubleshooting batch processing issues
- See `docs/TESTING.md` for testing procedures and validation
- See root-level `BATCH_PROCESSING_ARCHITECTURE.md`, `QUEUE_SYSTEM.md`, and `ADMIN_API.md` for operational references
- See `docs/README.md` for a complete documentation index
