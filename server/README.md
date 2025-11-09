Server setup notes

Database migration and schema:

- This project expects the `file_metadata` table to have a `batch_id` column. If you are starting from an older database schema, run the migration SQL located at `migrations/add_batch_id_to_file_metadata.sql` before starting the server.

- The application also attempts to automatically reconcile the schema on startup via `initializeDatabase()` in `server/src/models/database.js`. This includes an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS batch_id VARCHAR(50)` and an index `idx_file_metadata_batch_id`.

WebSocket configuration:

- The server WebSocket path is configurable via the `WS_PATH` environment variable (default `/ws`). Ensure your reverse proxy (NGINX, Cloud Run ingress, etc.) forwards WebSocket upgrade requests for this path to the Node server.

- The client and test scripts use `VITE_WS_URL` (client) or `WS_URL` (test scripts) to locate the WebSocket endpoint. Example values:

  - Client (vite env): VITE_WS_URL=ws://example.com/ws
  - Test script: WS_URL=ws://localhost:5000/ws

- If you deploy behind a proxy, confirm `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` are configured.

Batch API for deterministic hydration:

- The server exposes `GET /api/documents/batches/:batchId` which returns counts by status and the list of files belonging to that batch. The client uses this endpoint to hydrate UI state when it opens mid-batch.

CI/CD:

- Ensure migrations are applied during deploy so the DB schema contains the new `batch_id` column and its index. The in-app reconciliation helps but it's best practice to run migrations in CI before starting the application.

If you prefer to only rely on explicit migrations, remove or comment out the automatic ALTER statements in `server/src/models/database.js` and apply `migrations/add_batch_id_to_file_metadata.sql` via your migration tooling.
