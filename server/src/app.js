import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import documentRoutes from "./routes/documentRoutes.js";
import collectionRoutes from "./routes/collectionRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import dataRoutes from "./routes/dataRoutes.js";
import { initializeDatabase } from "./models/database.js";

const app = express();

// ✅ Allow production frontend & localhost (for development)
const allowedOrigins = [
  "https://pdf2csv-frontend-805037964827.us-central1.run.app",
  "http://localhost:3000",   
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Allow requests with no origin (mobile apps, curl, etc.)
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`❌ Blocked by CORS: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies or auth headers
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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
