import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import documentRoutes from "./routes/documentRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import dataRoutes from "./routes/dataRoutes.js";
import testRoutes from "./routes/testRoutes.js";
import { initializeDatabase } from "./models/database.js";
import logger from './utils/logger.js';

const app = express();

const allowedOrigins = [
  "https://pdf2csv-frontend-805037964827.us-central1.run.app",
  "http://localhost:5173",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(fileUpload());

// Initialize database on startup
initializeDatabase().catch(err => logger.error('Database initialization failed:', err));

// Routes
app.use("/api/documents", documentRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/test", testRoutes);

export default app;
