import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import documentRoutes from "./routes/documentRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import dataRoutes from "./routes/dataRoutes.js";
import { initializeDatabase } from "./models/database.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// Initialize database on startup
initializeDatabase().catch(console.error);

// Routes
app.use("/api/documents", documentRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/data", dataRoutes);

export default app;
