// src/config/index.js
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

// 🧩 Resolve absolute path for credentials and output directory
const credentialsPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || "");
const outputPath = path.resolve(process.env.OUTPUT_DIR || "output");

// ✅ Check if credentials file exists
if (!fs.existsSync(credentialsPath)) {
  console.error(`❌ Google credentials file not found at: ${credentialsPath}`);
  console.error("👉 Please set GOOGLE_APPLICATION_CREDENTIALS in your .env file correctly.\n");
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
};
