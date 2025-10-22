import express from "express";
import { processDocuments, downloadZip } from "../controllers/documentController.js";

const router = express.Router();

router.post("/process", processDocuments);
router.get("/download", downloadZip);

export default router;
