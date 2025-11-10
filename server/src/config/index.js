// src/config/index.js
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import logger from '../utils/logger.js';
import os from 'os';

dotenv.config();

// 🧩 Resolve absolute path for credentials and output directory
const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || "");
const outputPath = path.resolve(process.env.OUTPUT_DIR || "output");

// ✅ Check if credentials file exists (only in development)
if (process.env.NODE_ENV !== 'production' && !fs.existsSync(credentialsPath)) {
  logger.error(`Google credentials file not found at: ${credentialsPath}`);
  logger.error("Please set GOOGLE_APPLICATION_CREDENTIALS in your .env file correctly.");
  process.exit(1);
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
  dbPoolMax: parseInt(process.env.DB_POOL_MAX, 10) || 200,
  dbPoolMin: parseInt(process.env.DB_POOL_MIN, 10) || 2,

  // Runtime & tuning
  logLevel: process.env.LOG_LEVEL || 'info',
  workerThreadPoolSize: parseInt(process.env.WORKER_THREAD_POOL_SIZE, 10) || Math.max(2, Math.min(os.cpus().length, 4)),
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL, 10) || 300,
  wsPath: process.env.WS_PATH || '/ws',
  
  // Cloud Storage configuration
  inputBucket: process.env.INPUT_BUCKET || "pdf-data-extraction-input-bucket",
  outputBucket: process.env.OUTPUT_BUCKET || "pdf-data-extraction-output-bucket",
  storageLocation: process.env.STORAGE_LOCATION || "us",
};
