import path from "path";
import fs from "fs";
import { processPDFs } from "../services/documentProcessor.js";

export const processDocuments = async (req, res) => {
  try {
    // Ensure temp folder exists
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log("🛠 Created temp directory");
    }

    // Ensure output folder exists
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log("🛠 Created output directory");
    }

    const files = req.files?.pdfs;
    if (!files) {
      return res.status(400).json({ error: "No PDF files uploaded" });
    }

    const fileArray = Array.isArray(files) ? files : [files];
    console.log(`⚙️ Processing ${fileArray.length} files...`);

    const results = await processPDFs(fileArray, tempDir, outputDir);
    console.log("✅ Process complete.");

    res.json(results);
  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};
