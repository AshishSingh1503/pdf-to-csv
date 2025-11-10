import EventEmitter from 'events'
import logger from '../utils/logger.js'
import { config } from '../config/index.js'

/**
 * BatchQueueManager
 *
 * Singleton service that manages a FIFO queue of batch jobs and a fixed number
 * of active slots for concurrent batch execution.
 */
class BatchQueueManager extends EventEmitter {
  constructor() {
    super()
    this.queue = []
    this.activeSlots = new Map()
    this.totalEnqueued = 0
    this.totalProcessed = 0
    // Use centralized config for queue sizing & behavior
    this.maxConcurrentBatches = (config && config.maxConcurrentBatches) || 2
    this.enableQueueLogging = !!(config && config.enableQueueLogging)
    this.batchQueueTimeout = (config && config.batchQueueTimeout) || 300000
    this.averageBatchSeconds = (config && config.averageBatchSeconds) || 150
  this.MAX_QUEUE_LENGTH = (config && config.maxQueueLength) || 100

  // timeout timers for active batches
  this.batchTimeouts = new Map()

  // position update debounce
  this.positionUpdateTimer = null
  this.positionUpdateDebounceMs = 1000
  this.positionUpdatesEmitted = 0
  this.positionUpdatesSuppressed = 0

  // shutdown state
  this.shuttingDown = false

    // Metrics
    this.totalFailed = 0
    this.batchStartTimes = new Map()
    this.batchCompletionTimes = [] // durations in seconds
    this.maxCompletionHistorySize = 100
    this.startTime = Date.now()

    // Track batches that have been marked failed so we don't double-count failures
    this.failedBatches = new Set()

    logger.info(`BatchQueueManager initialized (maxConcurrentBatches=${this.maxConcurrentBatches})`)
  }

  // Conditional queue logger - verbose logging can be toggled via config
  _logQueue(level, message, meta = {}) {
    try {
      if (this.enableQueueLogging) {
        if (typeof logger[level] === 'function') logger[level](message, meta)
        else logger.info(message, meta)
        return
      }
      // Always log warnings/errors regardless of verbose flag
      if (level === 'error' || level === 'warn') {
        if (typeof logger[level] === 'function') logger[level](message, meta)
        else logger.warn(message, meta)
      }
    } catch (e) {
      // best-effort logging
      try { logger.warn('Queue logging helper failed', { err: e && e.message }) } catch (ee) {}
    }
  }

  validateJob(job) {
    if (!job) return false
    // fileMetadatas is optional; if present it should be an array
    const fileMetasOk = job.fileMetadatas === undefined || Array.isArray(job.fileMetadatas)
    const ok = job.batchId && job.collectionId && Array.isArray(job.fileArray) && typeof job.processorFunction === 'function' && fileMetasOk
    return ok
  }

  enqueue(batchJob) {
    try {
      if (this.shuttingDown) {
        this._logQueue('warn', 'Attempt to enqueue while shutting down; rejecting', { batchId: batchJob?.batchId })
        try { this.emit('queue:shutdown', { batchId: batchJob?.batchId }) } catch (e) {}
        return -1
      }
      // Prevent duplicate enqueue for same batchId (either active or already queued)
      if (!batchJob || !batchJob.batchId) {
        logger.warn('Attempted to enqueue batch with missing batchId')
        return -1
      }
      if (this.activeSlots.has(batchJob.batchId)) {
        this._logQueue('warn', 'Batch already processing; duplicate enqueue ignored', { batchId: batchJob.batchId })
        return 0
      }
      const existingIdx = this.queue.findIndex(j => j.batchId === batchJob.batchId)
      if (existingIdx >= 0) {
        const pos = existingIdx + 1
        this._logQueue('warn', 'Batch already queued; duplicate enqueue ignored', { batchId: batchJob.batchId, position: pos })
        return pos
      }

      // Enforce capacity based solely on queue length to prevent unbounded growth.
      // Rationale: rejecting based on queue length provides predictable behavior under load.
      if (this.queue.length >= this.MAX_QUEUE_LENGTH) {
        logger.warn('Queue at capacity (maxQueueLength reached); rejecting batch', { batchId: batchJob.batchId, collectionId: batchJob.collectionId, queueLength: this.queue.length, maxLength: this.MAX_QUEUE_LENGTH })
        try { this.emit('queue:full', { batchId: batchJob.batchId, collectionId: batchJob.collectionId, queueLength: this.queue.length, maxLength: this.MAX_QUEUE_LENGTH }) } catch (e) {}
        return -1
      }

      if (!this.validateJob(batchJob)) {
        logger.warn('Attempted to enqueue invalid batch job', { batchId: batchJob?.batchId })
        return -1
      }

      const job = Object.assign({}, batchJob)
      job.enqueuedAt = new Date().toISOString()
  this.queue.push(job)
  this.totalEnqueued += 1
      const position = this.queue.length

      // compute supplemental queue metadata
      let estimatedWaitTime = 0
      try {
        estimatedWaitTime = this.estimateWaitTime(position)
      } catch (e) {
        logger.warn('estimateWaitTime failed during enqueue', { err: e && e.message })
        estimatedWaitTime = 0
      }
      const totalQueued = this.queue.length
      const queueStatus = this.getQueueStatus()

      this._logQueue('info', 'Batch enqueued', { batchId: job.batchId, collectionId: job.collectionId, fileCount: job.fileArray.length, position, estimatedWaitTime, totalQueued })
      try {
        this.emit('batch:enqueued', { batchId: job.batchId, collectionId: job.collectionId, fileCount: job.fileArray.length, position, estimatedWaitTime, totalQueued, queueStatus })
      } catch (e) {
        logger.warn('Failed to emit batch:enqueued', { err: e && e.message, batchId: job.batchId })
      }

      // Notify existing queued batches (excluding the newly enqueued one) that positions may have changed (debounced)
      try {
        this.emitPositionUpdates('enqueue', job.batchId, false)
      } catch (e) {
        logger.warn('Failed to emit position updates after enqueue', { err: e && e.message })
      }

      // try to process immediately if slots available
      this.processNext()
      return position
    } catch (err) {
      logger.error('Failed to enqueue batch', { err: err && err.message, batchId: batchJob?.batchId })
      return -1
    }
  }

  dequeue() {
    try {
      if (this.queue.length === 0) return null
      if (this.activeSlots.size >= this.maxConcurrentBatches) return null
      const job = this.queue.shift()
      job.startedAt = new Date().toISOString()
      this.activeSlots.set(job.batchId, job)
      // track start time for metrics
      try { this.batchStartTimes.set(job.batchId, Date.now()) } catch (e) {}
      this._logQueue('info', 'Batch dequeued and started', { batchId: job.batchId, collectionId: job.collectionId, remainingQueue: this.queue.length })
      this._logQueue('debug', 'Slot allocated', { batchId: job.batchId, activeSlots: this.activeSlots.size, maxSlots: this.maxConcurrentBatches })
      // include startedAt from the job so listeners can align timestamps with queue manager
      try {
        const totalQueued = this.queue.length
        const activeCount = this.activeSlots.size
        const availableSlots = Math.max(0, this.maxConcurrentBatches - activeCount)
        this.emit('batch:dequeued', { batchId: job.batchId, collectionId: job.collectionId, fileCount: job.fileArray.length, startedAt: job.startedAt, totalQueued, activeCount, availableSlots })
      } catch (e) {
        logger.warn('Failed to emit batch:dequeued', { err: e && e.message, batchId: job.batchId })
      }

      // Immediate position update: a queued batch just moved to processing, notify remaining queued batches right away
      try { this.emitPositionUpdates('dequeue', null, true) } catch (e) { logger.warn('Failed to emit immediate position updates after dequeue', { err: e && e.message }) }

      // Start per-batch timeout timer so stuck processors do not hold slots indefinitely
      try {
        const timeoutMs = this.batchQueueTimeout || 300000
        const timerId = setTimeout(() => {
          try { this.handleBatchTimeout(job.batchId) } catch (tErr) { logger.error('handleBatchTimeout failed', { err: tErr && tErr.message }) }
        }, timeoutMs)
        this.batchTimeouts.set(job.batchId, timerId)
        this._logQueue('debug', 'Batch timeout started', { batchId: job.batchId, timeoutMs })
      } catch (e) {
        logger.warn('Failed to start batch timeout timer', { batchId: job.batchId, err: e && e.message })
      }
      return job
    } catch (err) {
      logger.error('Failed to dequeue batch', { err: err && err.message })
      return null
    }
  }

  async processNext() {
    // continue dequeuing until slots are full or queue empty
    while (this.activeSlots.size < this.maxConcurrentBatches && this.queue.length > 0) {
      const job = this.dequeue()
      if (!job) break
      // fire-and-monitor
      try {
        this._logQueue('debug', 'Starting batch processor', { batchId: job.batchId })
        const p = Promise.resolve().then(() => job.processorFunction({
          fileArray: job.fileArray,
          collectionId: job.collectionId,
          fileMetadatas: job.fileMetadatas,
          batchId: job.batchId,
          startedAt: job.startedAt,
        }))

        p.then((res) => {
          logger.info('Batch processor resolved', { batchId: job.batchId })
          this.releaseBatch(job.batchId)
        }).catch((err) => {
          logger.error('Batch processor failed', { batchId: job.batchId, err: err && err.message })
          try {
            if (!this.failedBatches.has(job.batchId)) {
              this.totalFailed += 1
              this.failedBatches.add(job.batchId)
            }
          } catch (e) {}
          // ensure release even on failure
          try { this.releaseBatch(job.batchId) } catch (e) { logger.error('Failed to release batch after error', { batchId: job.batchId, err: e && e.message }) }
        })
      } catch (err) {
        logger.error('Error invoking batch processor', { batchId: job.batchId, err: err && err.message })
        try { this.releaseBatch(job.batchId) } catch (e) { logger.error('Failed to release batch after invocation error', { batchId: job.batchId, err: e && e.message }) }
      }
    }
  }

  releaseBatch(batchId) {
    try {
      if (!this.activeSlots.has(batchId)) {
        this._logQueue('warn', 'Attempted to release unknown batch', { batchId })
        return false
      }
      // retrieve job from activeSlots so we can include collectionId in emitted events
      const job = this.activeSlots.get(batchId)
      const collectionId = job ? job.collectionId : undefined
      // clear any timeout timer associated with this batch
      try {
        const t = this.batchTimeouts.get(batchId)
        if (t) {
          clearTimeout(t)
          this.batchTimeouts.delete(batchId)
        }
      } catch (e) {}

      this.activeSlots.delete(batchId)
      this.totalProcessed += 1
      const activeCount = this.activeSlots.size
      const totalQueued = this.queue.length
      const availableSlots = Math.max(0, this.maxConcurrentBatches - activeCount)

      // metrics: compute duration and store
      let duration = null
      try {
        const startTs = this.batchStartTimes.get(batchId)
        if (startTs) {
          duration = (Date.now() - startTs) / 1000
          this.batchCompletionTimes.push(duration)
          // trim history
          if (this.batchCompletionTimes.length > this.maxCompletionHistorySize) {
            this.batchCompletionTimes = this.batchCompletionTimes.slice(-this.maxCompletionHistorySize)
          }
          this.batchStartTimes.delete(batchId)
        }
      } catch (e) {
        logger.warn('Failed to compute batch duration', { batchId, err: e && e.message })
      }

      this._logQueue('info', 'Batch released', { batchId, activeCount, totalQueued, durationSeconds: duration })
      this._logQueue('debug', 'Slot released', { batchId, availableSlots })
      try {
        this.emit('batch:completed', { batchId, collectionId, totalQueued, activeCount, availableSlots })
      } catch (e) {
        logger.warn('Failed to emit batch:completed', { err: e && e.message, batchId })
      }

      // Emit position updates for remaining queued batches (their positions improved)
      try {
        this.emitPositionUpdates('release', null, false)
      } catch (e) {
        logger.warn('Failed to emit position updates after release', { err: e && e.message })
      }

  // trigger processing of queued batches
  setImmediate(() => this.processNext())
  // Cleanup failedBatches set entry to avoid unbounded memory growth
  try { this.failedBatches.delete(batchId) } catch (e) {}
  return true
    } catch (err) {
      logger.error('Failed to release batch', { batchId, err: err && err.message })
      return false
    }
  }

  // Emit position-updated events for each batch currently in the queue
  emitPositionUpdates(reason = 'queue-changed', excludeBatchId = null, immediate = false) {
    try {
      const emitNow = () => {
        try {
          const totalQueued = this.queue.length
          for (let i = 0; i < this.queue.length; i++) {
            const j = this.queue[i]
            if (excludeBatchId && j.batchId === excludeBatchId) continue
            try {
              const position = i + 1
              let estimatedWaitTime = 0
              try { estimatedWaitTime = this.estimateWaitTime(position) } catch (e) { estimatedWaitTime = 0 }
              this.emit('batch:position-updated', { batchId: j.batchId, collectionId: j.collectionId, position, estimatedWaitTime, totalQueued, reason })
            } catch (e) {
              logger.debug('Failed to emit position update for batch', { batchId: j.batchId, err: e && e.message })
            }
          }
          this.positionUpdatesEmitted += 1
        } catch (e) {
          logger.warn('emitPositionUpdates inner failed', { err: e && e.message })
        }
      }

      if (immediate) {
        // flush any pending debounce and emit immediately
        if (this.positionUpdateTimer) {
          clearTimeout(this.positionUpdateTimer)
          this.positionUpdateTimer = null
        }
        emitNow()
        return
      }

      // debounce position updates to avoid websocket spam
      if (this.positionUpdateTimer) {
        // a scheduled update already exists; suppress one
        this.positionUpdatesSuppressed += 1
        try { clearTimeout(this.positionUpdateTimer) } catch (e) {}
      }
      this.positionUpdateTimer = setTimeout(() => {
        this.positionUpdateTimer = null
        try { emitNow() } catch (e) { logger.warn('Debounced emitPositionUpdates failed', { err: e && e.message }) }
      }, this.positionUpdateDebounceMs)
    } catch (err) {
      logger.warn('emitPositionUpdates failed', { err: err && err.message })
    }
  }

  getQueuePosition(batchId) {
    if (this.activeSlots.has(batchId)) return 0
    const idx = this.queue.findIndex(j => j.batchId === batchId)
    return idx >= 0 ? idx + 1 : -1
  }

  getQueueStatus() {
    try {
      const pendingBatches = this.queue.map(j => ({ batchId: j.batchId, collectionId: j.collectionId, fileCount: j.fileArray.length, enqueuedAt: j.enqueuedAt }))
      const activeBatches = Array.from(this.activeSlots.values()).map(j => ({ batchId: j.batchId, collectionId: j.collectionId, fileCount: j.fileArray.length, startedAt: j.startedAt }))
      // Compute derived metrics
      let averageCompletionTimeSeconds = 0
      try {
        if (this.batchCompletionTimes && this.batchCompletionTimes.length > 0) {
          const sum = this.batchCompletionTimes.reduce((a, b) => a + b, 0)
          averageCompletionTimeSeconds = sum / this.batchCompletionTimes.length
        }
      } catch (e) {
        logger.warn('Failed to compute averageCompletionTimeSeconds', { err: e && e.message })
        averageCompletionTimeSeconds = 0
      }

      const uptimeSeconds = (Date.now() - this.startTime) / 1000
      let throughputBatchesPerHour = 0
      try {
        if (uptimeSeconds > 0) throughputBatchesPerHour = (this.totalProcessed / uptimeSeconds) * 3600
      } catch (e) { throughputBatchesPerHour = 0 }

      // average wait time (seconds) across all queued positions (1..queue.length)
      let averageWaitTimeSeconds = 0
      try {
        const qlen = this.queue.length
        if (qlen > 0) {
          let s = 0
          for (let i = 1; i <= qlen; i++) {
            try { s += this.estimateWaitTime(i) } catch (ee) { /* ignore individual failures */ }
          }
          averageWaitTimeSeconds = Math.ceil(s / qlen)
        } else {
          averageWaitTimeSeconds = 0
        }
      } catch (e) {
        logger.warn('Failed to compute averageWaitTimeSeconds', { err: e && e.message })
        averageWaitTimeSeconds = 0
      }

      return {
        queueLength: this.queue.length,
        maxQueueLength: this.MAX_QUEUE_LENGTH,
        queueUtilization: Math.round((this.queue.length / (this.MAX_QUEUE_LENGTH || 1)) * 100),
        activeCount: this.activeSlots.size,
        availableSlots: Math.max(0, this.maxConcurrentBatches - this.activeSlots.size),
        totalEnqueued: this.totalEnqueued,
        totalProcessed: this.totalProcessed,
        totalFailed: this.totalFailed,
        averageCompletionTimeSeconds,
        throughputBatchesPerHour,
        currentQueueWaitTime: this.estimateWaitTime(this.queue.length),
        averageWaitTimeSeconds,
        maxConcurrentBatches: this.maxConcurrentBatches,
        enableQueueLogging: this.enableQueueLogging,
        pendingBatches,
        activeBatches,
        uptimeSeconds,
      }
    } catch (err) {
      logger.error('Failed to get queue status', { err: err && err.message })
      return null
    }
  }

  // Lightweight metrics only (suitable for dashboards)
  getMetrics() {
    try {
      const uptimeSeconds = (Date.now() - this.startTime) / 1000
      let averageCompletionTimeSeconds = 0
      try {
        if (this.batchCompletionTimes && this.batchCompletionTimes.length > 0) {
          const sum = this.batchCompletionTimes.reduce((a, b) => a + b, 0)
          averageCompletionTimeSeconds = sum / this.batchCompletionTimes.length
        }
      } catch (e) {
        logger.warn('Failed to compute averageCompletionTimeSeconds for metrics', { err: e && e.message })
        averageCompletionTimeSeconds = 0
      }

      let throughputBatchesPerHour = 0
      try {
        if (uptimeSeconds > 0) throughputBatchesPerHour = (this.totalProcessed / uptimeSeconds) * 3600
      } catch (e) { throughputBatchesPerHour = 0 }

      const successRate = (this.totalProcessed + this.totalFailed) > 0 ? ((this.totalProcessed / (this.totalProcessed + this.totalFailed)) * 100) : 0
      // average wait time for queued positions
      let averageWaitTimeSeconds = 0
      try {
        const qlen = this.queue.length
        if (qlen > 0) {
          let s = 0
          for (let i = 1; i <= qlen; i++) {
            try { s += this.estimateWaitTime(i) } catch (ee) { /* ignore */ }
          }
          averageWaitTimeSeconds = Math.ceil(s / qlen)
        }
      } catch (e) {
        logger.warn('Failed to compute averageWaitTimeSeconds for metrics', { err: e && e.message })
        averageWaitTimeSeconds = 0
      }

      return {
        totalEnqueued: this.totalEnqueued,
        totalProcessed: this.totalProcessed,
        totalFailed: this.totalFailed,
        successRate: Number(successRate.toFixed(2)),
        averageCompletionTimeSeconds,
        averageWaitTimeSeconds,
        maxQueueLength: this.MAX_QUEUE_LENGTH,
        positionUpdatesEmitted: this.positionUpdatesEmitted,
        positionUpdatesSuppressed: this.positionUpdatesSuppressed,
        throughputBatchesPerHour: Number(throughputBatchesPerHour.toFixed(2)),
        currentQueueLength: this.queue.length,
        currentActiveCount: this.activeSlots.size,
        uptimeSeconds
      }
    } catch (err) {
      logger.warn('Failed to compute metrics', { err: err && err.message })
      return {
        totalEnqueued: this.totalEnqueued || 0,
        totalProcessed: this.totalProcessed || 0,
        totalFailed: this.totalFailed || 0,
        successRate: 0,
        averageCompletionTimeSeconds: 0,
        throughputBatchesPerHour: 0,
        currentQueueLength: this.queue.length || 0,
        currentActiveCount: this.activeSlots.size || 0,
        uptimeSeconds: 0,
      }
    }
  }

  // Reset metrics (useful for testing/maintenance). Should be protected in production.
  resetMetrics() {
    try {
      this.totalEnqueued = 0
      this.totalProcessed = 0
      this.totalFailed = 0
      this.batchCompletionTimes = []
      this.batchStartTimes = new Map()
      this.startTime = Date.now()
      return true
    } catch (e) {
      logger.warn('Failed to reset metrics', { err: e && e.message })
      return false
    }
  }

  getBatchInfo(batchId) {
    if (this.activeSlots.has(batchId)) {
      const j = this.activeSlots.get(batchId)
      // include elapsed and timeout info for active batches
      const startTs = this.batchStartTimes.get(batchId)
      const startedAt = j.startedAt || null
      const elapsedMs = startTs ? (Date.now() - startTs) : null
      const timeoutMs = this.batchQueueTimeout || null
      const timeRemaining = (elapsedMs !== null && timeoutMs !== null) ? Math.max(0, timeoutMs - elapsedMs) : null
      return {
        batchId: j.batchId,
        collectionId: j.collectionId,
        fileCount: Array.isArray(j.fileArray) ? j.fileArray.length : 0,
        startedAt,
        status: 'processing',
        elapsedMs,
        timeoutMs,
        timeRemaining,
      }
    }
    const idx = this.queue.findIndex(j => j.batchId === batchId)
    if (idx >= 0) {
      const j = this.queue[idx]
      return {
        batchId: j.batchId,
        collectionId: j.collectionId,
        fileCount: Array.isArray(j.fileArray) ? j.fileArray.length : 0,
        enqueuedAt: j.enqueuedAt,
        status: 'queued',
        position: idx + 1,
      }
    }
    return null
  }

  // Determine if a new batch can be accepted without being rejected due to queue capacity.
  canAcceptNewBatch() {
    try {
      // Accept if there's an available processing slot (will start immediately)
      if (this.activeSlots.size < this.maxConcurrentBatches) return true
      // Otherwise accept only if queue has room
      return this.queue.length < this.MAX_QUEUE_LENGTH
    } catch (e) {
      logger.warn('canAcceptNewBatch failed', { err: e && e.message })
      return false
    }
  }

  // Handle a batch timing out while processing
  handleBatchTimeout(batchId) {
    try {
      // Only act if the batch is still active
      if (!this.activeSlots.has(batchId)) return
      const timeoutMs = this.batchQueueTimeout || null
      logger.error('Batch timeout exceeded', { batchId, timeoutMs })
      try {
        if (!this.failedBatches.has(batchId)) {
          this.totalFailed += 1
          this.failedBatches.add(batchId)
        }
      } catch (e) {}
      try { this.emit('batch:timeout', { batchId, timeoutMs }) } catch (e) {}
      // Release slot so next batch can start
      try { this.releaseBatch(batchId) } catch (e) { logger.error('Failed to release batch after timeout', { batchId, err: e && e.message }) }
    } catch (e) {
      logger.error('handleBatchTimeout error', { err: e && e.message })
    }
  }

  // Prepare for graceful shutdown: stop accepting new batches and clear timers
  prepareShutdown() {
    try {
      this.shuttingDown = true
      if (this.positionUpdateTimer) {
        try { clearTimeout(this.positionUpdateTimer) } catch (e) {}
        this.positionUpdateTimer = null
      }
      this._logQueue('info', 'Queue manager preparing for shutdown', { queueLength: this.queue.length, activeCount: this.activeSlots.size })
      // By default we leave queued batches in memory; they will be lost on restart
      if (this.queue.length > 0) {
        this._logQueue('warn', 'Queued batches will be lost on shutdown', { queueLength: this.queue.length, batchIds: this.queue.map(j => j.batchId) })
      }
      return { queueLength: this.queue.length, activeCount: this.activeSlots.size }
    } catch (e) {
      logger.warn('prepareShutdown failed', { err: e && e.message })
      return { queueLength: this.queue.length, activeCount: this.activeSlots.size }
    }
  }

  // Wait for currently active batches to complete or until timeoutMs expires
  waitForActiveBatches(timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      try {
        const check = () => {
          if (this.activeSlots.size === 0) return resolve({ remaining: 0 })
        }
        check()
        if (this.activeSlots.size === 0) return
        let timedOut = false
        const onComplete = () => {
          if (this.activeSlots.size === 0 && !timedOut) {
            cleanup()
            return resolve({ remaining: 0 })
          }
        }
        const cleanup = () => {
          try { this.removeListener('batch:completed', onComplete) } catch (e) {}
          try { clearTimeout(tid) } catch (e) {}
        }
        this.on('batch:completed', onComplete)
        const tid = setTimeout(() => {
          timedOut = true
          try { cleanup() } catch (e) {}
          return reject({ remaining: this.activeSlots.size })
        }, timeoutMs)
        // Periodic logging to indicate shutdown progress
        const logInterval = setInterval(() => {
          this._logQueue('info', 'Waiting for batches to complete during shutdown', { remaining: this.activeSlots.size })
        }, 10000)
        // Ensure we clear the logInterval when done
        const finalizer = () => { try { clearInterval(logInterval) } catch (e) {} }
        // hook resolve/reject to clear interval
        const origResolve = resolve;
        const origReject = reject;
        resolve = (v) => { finalizer(); origResolve(v) }
        reject = (v) => { finalizer(); origReject(v) }
      } catch (e) {
        return reject(e)
      }
    })
  }

  getActiveBatchIds() {
    try {
      return Array.from(this.activeSlots.keys())
    } catch (e) {
      logger.warn('getActiveBatchIds failed', { err: e && e.message })
      return []
    }
  }

  estimateWaitTime(position) {
    // Heuristic: use rolling average of actual completion times when available, otherwise configured average
    try {
      let avgSeconds = this.averageBatchSeconds || 150
      if (this.batchCompletionTimes && this.batchCompletionTimes.length > 0) {
        const sum = this.batchCompletionTimes.reduce((a, b) => a + b, 0)
        avgSeconds = Math.ceil(sum / this.batchCompletionTimes.length)
      }
      const availableSlots = Math.max(0, this.maxConcurrentBatches - this.activeSlots.size)
      if (position <= availableSlots) return 0
      const pendingAhead = Math.max(0, position - availableSlots)
      const slots = Math.max(1, this.maxConcurrentBatches)
      const estimatedSeconds = Math.ceil((pendingAhead * avgSeconds) / slots)
      return estimatedSeconds
    } catch (e) {
      logger.warn('estimateWaitTime failed', { err: e && e.message })
      return 0
    }
  }
}

const batchQueueManager = new BatchQueueManager()

export { BatchQueueManager }
export default batchQueueManager
