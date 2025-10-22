// server/src/routes/documentRoutes.js
import express from "express";
import { processDocuments } from "../controllers/documentController.js";

const router = express.Router();

router.post("/process", processDocuments);

export default router;
