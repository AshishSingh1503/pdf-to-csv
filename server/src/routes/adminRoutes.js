// SECURITY: These admin endpoints should be protected with authentication in production
import express from 'express'
import batchQueueManager from '../services/batchQueueManager.js'
import logger from '../utils/logger.js'
import { config } from '../config/index.js'

const router = express.Router()

// Simple API key auth middleware for admin endpoints
const adminApiKey = process.env.ADMIN_API_KEY || ''
const adminAuth = (req, res, next) => {
  try {
    if (!adminApiKey) {
      logger.warn('ADMIN_API_KEY not configured; rejecting admin request')
      return res.status(403).json({ success: false, error: 'Admin API key not configured on server' })
    }
    const provided = req.header('x-api-key') || req.query.api_key || req.headers['x-api-key']
    if (!provided || provided !== adminApiKey) {
      logger.warn('Unauthorized admin access attempt', { ip: req.ip })
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    return next()
  } catch (err) {
    logger.error('Error in adminAuth middleware', { err: err && err.message })
    return res.status(500).json({ success: false, error: 'Internal auth error' })
  }
}

// Apply adminAuth to all admin routes
router.use(adminAuth)

// GET /api/admin/queue-status
router.get('/queue-status', async (req, res) => {
  try {
    const queueStatus = await batchQueueManager.getQueueStatus()
    if (!queueStatus) {
      return res.status(500).json({ success: false, error: 'Unable to retrieve queue status' })
    }
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      queueStatus,
      configuration: {
        maxConcurrentBatches: config.maxConcurrentBatches,
        batchQueueTimeout: config.batchQueueTimeout,
        enableQueueLogging: config.enableQueueLogging,
        averageBatchSeconds: config.averageBatchSeconds,
        maxQueueLength: config.maxQueueLength,
        enableGracefulShutdown: config.enableGracefulShutdown,
        gracefulShutdownTimeout: config.gracefulShutdownTimeout,
      }
    })
  } catch (err) {
    logger.error('Failed to retrieve queue status', { err: err && err.message })
    return res.status(500).json({ success: false, error: 'Failed to retrieve queue status', details: err && err.message })
  }
})

// GET /api/admin/queue-metrics
router.get('/queue-metrics', async (req, res) => {
  try {
    const metrics = await batchQueueManager.getMetrics()
    return res.json({ success: true, timestamp: new Date().toISOString(), metrics })
  } catch (err) {
    logger.error('Failed to retrieve queue metrics', { err: err && err.message })
    return res.status(500).json({ success: false, error: 'Failed to retrieve queue metrics', details: err && err.message })
  }
})

// GET /api/admin/batch/:batchId
router.get('/batch/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params
    if (!batchId) return res.status(400).json({ success: false, error: 'batchId is required' })
    const batch = await batchQueueManager.getBatchInfo(batchId)
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found (may have completed or never existed)' })
    return res.json({ success: true, batch })
  } catch (err) {
    logger.error('Failed to retrieve batch info', { err: err && err.message })
    return res.status(500).json({ success: false, error: 'Failed to retrieve batch info', details: err && err.message })
  }
})

// POST /api/admin/clear-completed-metrics
router.post('/clear-completed-metrics', async (req, res) => {
  try {
    const ok = await batchQueueManager.resetMetrics()
    if (!ok) return res.status(500).json({ success: false, error: 'Failed to reset metrics' })
    return res.json({ success: true, message: 'Metrics reset successfully' })
  } catch (err) {
    logger.error('Failed to reset metrics', { err: err && err.message })
    return res.status(500).json({ success: false, error: 'Failed to reset metrics', details: err && err.message })
  }
})

export default router
