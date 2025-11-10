// server/src/routes/documentRoutes.js
import express from "express";
import { processDocuments, downloadFile, downloadCollectionCsvs, downloadCollectionExcels, downloadCollectionSummary, getUploadedFiles, reprocessFile, updateUploadProgress, getBatchStatus, getQueueStatus } from "../controllers/documentController.js";

const router = express.Router();

router.post("/process", processDocuments);
router.get("/download", downloadFile);
router.get("/download/collection/:collectionId", downloadCollectionCsvs);
router.get("/download/collection/:collectionId/excel", downloadCollectionExcels);
router.get('/download/collection/:collectionId/summary', downloadCollectionSummary);
router.get("/files/collection/:collectionId", getUploadedFiles);
router.get('/batches/:batchId', getBatchStatus);
router.get('/queue/status', getQueueStatus);
router.post("/reprocess/:fileId", reprocessFile);
router.post("/upload/progress/:fileId", updateUploadProgress);

export default router;
