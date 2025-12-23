// src/config/index.js
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import logger from '../utils/logger.js';
import os from 'os';

const envConfig = dotenv.config();
if (envConfig.error) {
  logger.error('Error loading .env file:', envConfig.error);
} else {
  logger.info('Parsed .env file successfully.');
}
logger.info(`Env Check: GOOGLE_APPLICATION_CREDENTIALS=${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);

// Queue configuration parsing & validation - centralize defaults and clamps
let _maxConcurrentBatches = parseInt(process.env.MAX_CONCURRENT_BATCHES, 10);
if (isNaN(_maxConcurrentBatches) || _maxConcurrentBatches <= 0) {
  logger.warn('MAX_CONCURRENT_BATCHES is missing or invalid. Using minimum value 1. Set MAX_CONCURRENT_BATCHES in environment to change.');
  _maxConcurrentBatches = 1;
}
// Clamp to reasonable bounds [1,20]
if (_maxConcurrentBatches < 1) {
  logger.warn('MAX_CONCURRENT_BATCHES too low; clamping to 1');
  _maxConcurrentBatches = 1;
}
if (_maxConcurrentBatches > 20) {
  logger.warn('MAX_CONCURRENT_BATCHES too high; clamping to 20');
  _maxConcurrentBatches = 20;
}

let _batchQueueTimeout = parseInt(process.env.BATCH_QUEUE_TIMEOUT, 10);
if (isNaN(_batchQueueTimeout) || _batchQueueTimeout < 60000) {
  // Increase default batch processing timeout to 30 minutes to accommodate larger/slow Document AI workloads.
  // Previously defaulted to 15 minutes; larger workloads may require more time.
  _batchQueueTimeout = 1800000; // default 30 minutes
  if (process.env.BATCH_QUEUE_TIMEOUT) logger.warn('BATCH_QUEUE_TIMEOUT too low; using default 1800000');
}

// Optional multiplier to scale the batch queue timeout without code changes
let _batchQueueTimeoutMultiplier = parseFloat(process.env.BATCH_QUEUE_TIMEOUT_MULTIPLIER);
if (!isNaN(_batchQueueTimeoutMultiplier)) {
  // Clamp multiplier to reasonable bounds
  if (_batchQueueTimeoutMultiplier < 0.5) {
    logger.warn('BATCH_QUEUE_TIMEOUT_MULTIPLIER too small; clamping to 0.5');
    _batchQueueTimeoutMultiplier = 0.5;
  }
  if (_batchQueueTimeoutMultiplier > 5.0) {
    logger.warn('BATCH_QUEUE_TIMEOUT_MULTIPLIER too large; clamping to 5.0');
    _batchQueueTimeoutMultiplier = 5.0;
  }
  _batchQueueTimeout = Math.round(_batchQueueTimeout * _batchQueueTimeoutMultiplier);
  logger.info(`Applied BATCH_QUEUE_TIMEOUT_MULTIPLIER=${_batchQueueTimeoutMultiplier}; effective BATCH_QUEUE_TIMEOUT=${_batchQueueTimeout}`);
}

const _enableQueueLogging = (process.env.ENABLE_QUEUE_LOGGING === 'true');

let _averageBatchSeconds = parseInt(process.env.AVERAGE_BATCH_SECONDS, 10);
if (isNaN(_averageBatchSeconds) || _averageBatchSeconds < 30) {
  _averageBatchSeconds = 150; // default 2.5 minutes
  if (process.env.AVERAGE_BATCH_SECONDS) logger.warn('AVERAGE_BATCH_SECONDS too low; using default 150');
}

// New: Queue capacity & graceful shutdown configuration
let _maxQueueLength = parseInt(process.env.MAX_QUEUE_LENGTH, 10);
if (isNaN(_maxQueueLength) || _maxQueueLength <= 0) {
  _maxQueueLength = 500;
}
if (_maxQueueLength < 10) {
  logger.warn('MAX_QUEUE_LENGTH too low; clamping to 10');
  _maxQueueLength = 10;
}
if (_maxQueueLength > 1000) {
  logger.warn('MAX_QUEUE_LENGTH too high; clamping to 1000');
  _maxQueueLength = 1000;
}

// Default: enabled unless explicitly set to 'false'. If the env var is provided, honor it.
const _enableGracefulShutdown = (typeof process.env.ENABLE_GRACEFUL_SHUTDOWN !== 'undefined') ? (process.env.ENABLE_GRACEFUL_SHUTDOWN === 'true') : true;

let _gracefulShutdownTimeout = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT, 10);
if (isNaN(_gracefulShutdownTimeout) || _gracefulShutdownTimeout < 60000) _gracefulShutdownTimeout = 300000;
if (_gracefulShutdownTimeout > 600000) _gracefulShutdownTimeout = 600000;

// 🧩 Resolve absolute path for credentials and output directory
const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || "");
const outputPath = path.resolve(process.env.OUTPUT_DIR || "output");

// ✅ Check if credentials file exists (only in development)
// ✅ Check if credentials file exists (only in development)
if (process.env.NODE_ENV !== 'production') {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.error("GOOGLE_APPLICATION_CREDENTIALS environment variable is missing or empty.");
    process.exit(1);
  }

  if (!fs.existsSync(credentialsPath)) {
    logger.error(`Google credentials file not found at: ${credentialsPath}`);
    logger.error("Please set GOOGLE_APPLICATION_CREDENTIALS in your .env file correctly.");
    process.exit(1);
  }

  const stats = fs.statSync(credentialsPath);
  if (stats.isDirectory()) {
    logger.error(`GOOGLE_APPLICATION_CREDENTIALS points to a directory, not a file: ${credentialsPath}`);
    logger.error("Please point it to your JSON key file.");
    process.exit(1);
  }
}

export const config = {
  projectId: process.env.PROJECT_ID,
  location: process.env.LOCATION || "us",
  processorId: process.env.PROCESSOR_ID,
  credentials: credentialsPath,
  enableDuplicateDetection: process.env.ENABLE_DUPLICATE_DETECTION === "true",
  duplicateKeyField: process.env.DUPLICATE_KEY_FIELD || "mobile",
  outputDir: outputPath,

  // Database configuration
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: parseInt(process.env.DB_PORT) || 5432,
  dbName: process.env.DB_NAME || "pdf2csv_db",
  dbUser: process.env.DB_USER || "postgres",
  dbPassword: process.env.DB_PASSWORD || "",
  dbSsl: process.env.DB_SSL === "true",
  dbPoolMax: parseInt(process.env.DB_POOL_MAX, 10) || 500,
  dbPoolMin: parseInt(process.env.DB_POOL_MIN, 10) || 2,

  // Runtime & tuning
  logLevel: process.env.LOG_LEVEL || 'info',
  // Default to 16 worker threads for high-resource environment (8 vGPU/64GB). Override with WORKER_THREAD_POOL_SIZE env var if needed.
  workerThreadPoolSize: parseInt(process.env.WORKER_THREAD_POOL_SIZE, 10) || 4,
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL, 10) || 300,
  wsPath: process.env.WS_PATH || '/ws',
  // Batch Queue configuration
  maxConcurrentBatches: _maxConcurrentBatches,
  batchQueueTimeout: _batchQueueTimeout,
  enableQueueLogging: _enableQueueLogging,
  averageBatchSeconds: _averageBatchSeconds,
  // Queue capacity and shutdown
  maxQueueLength: _maxQueueLength,
  enableGracefulShutdown: _enableGracefulShutdown,
  gracefulShutdownTimeout: _gracefulShutdownTimeout,

  // Cloud Storage configuration
  outputBucket: process.env.OUTPUT_BUCKET || "pdf-data-extraction-output-bucket",
  storageLocation: process.env.STORAGE_LOCATION || "us",
  deleteRawAfterProcess: process.env.DELETE_RAW_AFTER_PROCESS === 'true',

  // Performance Tuning
  maxWorkers: parseInt(process.env.MAX_WORKERS, 10) || 24,
  batchSizeRecords: parseInt(process.env.DB_INSERT_CHUNK_SIZE, 10) || 5000,
  maxConcurrentDocAIRequests: parseInt(process.env.MAX_CONCURRENT_DOCAI_REQUESTS, 10) || 150,

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
      "https://pdf2csv-frontend-2xcfwc7m6a-uc.a.run.app",
      "http://localhost:5173",
    ],
};
