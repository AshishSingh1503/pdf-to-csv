import dotenv from "dotenv";
dotenv.config();

export const config = {
  projectId: process.env.PROJECT_ID,
  location: process.env.LOCATION || "us",
  processorId: process.env.PROCESSOR_ID,
  credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  enableDuplicateDetection: process.env.ENABLE_DUPLICATE_DETECTION === "true",
  duplicateKeyField: process.env.DUPLICATE_KEY_FIELD || "mobile",
  outputDir: process.env.OUTPUT_DIR || "output"
};
