import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import documentRoutes from "./routes/documentRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import dataRoutes from "./routes/dataRoutes.js";
import testRoutes from "./routes/testRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { initializeDatabase } from "./models/database.js";
import logger from './utils/logger.js';

import { config } from "./config/index.js";

const app = express();

const corsOptions = {
  origin: (origin, callback) => {
    logger.debug(`CORS Check: Origin=${origin}`);
    if (config.allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      logger.warn(`CORS Blocked: Origin=${origin} is not in allowed list: ${config.allowedOrigins.join(', ')}`);
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
// Admin routes (internal use only)
app.use("/api/admin", adminRoutes);

export default app;
