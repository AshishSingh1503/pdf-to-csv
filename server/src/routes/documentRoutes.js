// server/src/routes/documentRoutes.js
import express from "express";
import { processDocuments, downloadFile, downloadCollectionCsvs, downloadCollectionExcels, getUploadedFiles, reprocessFile } from "../controllers/documentController.js";

const router = express.Router();

router.post("/process", processDocuments);
router.get("/download", downloadFile);
router.get("/download/collection/:collectionId", downloadCollectionCsvs);
router.get("/download/collection/:collectionId/excel", downloadCollectionExcels);
router.get("/files/collection/:collectionId", getUploadedFiles);
router.post("/reprocess/:fileId", reprocessFile);

export default router;
