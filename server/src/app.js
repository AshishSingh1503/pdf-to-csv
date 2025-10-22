import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import documentRoutes from "./routes/documentRoutes.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());
app.use("/api/documents", documentRoutes);

export default app;
