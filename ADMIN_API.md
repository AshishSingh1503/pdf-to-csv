# Admin API

The admin API exposes operational endpoints for monitoring and managing the BatchQueueManager.

Authentication
- Admin endpoints require an API key passed in `x-api-key` header or `?api_key=` query parameter.
- Set a strong `ADMIN_API_KEY` in the server environment for production.

Endpoints
- GET /api/admin/queue-status
  - Returns: { success: true, timestamp, queueStatus, configuration }
  - `queueStatus` is the object returned by `BatchQueueManager.getQueueStatus()`.
  - `configuration` includes queue-related config: maxConcurrentBatches, batchQueueTimeout, enableQueueLogging, averageBatchSeconds, maxQueueLength, enableGracefulShutdown, gracefulShutdownTimeout.

- GET /api/admin/queue-metrics
  - Returns: { success: true, timestamp, metrics }
  - `metrics` is from `BatchQueueManager.getMetrics()` and includes totals, averages, and position update counters.

- GET /api/admin/batch/:batchId
  - Returns: { success: true, batch }
  - `batch` contains getBatchInfo(batchId) with processing/queued details.

- POST /api/admin/clear-completed-metrics
  - Resets collected metrics. Administrative only.

Usage
- These endpoints are for internal/operator use only. Do not expose to unauthenticated users.
- Use `queue-status` to observe current queue length, active batches, and utilization. Use `queue-metrics` for historical rates and averages.
