// server/src/controllers/documentController.js
import path from "path";
import { processPDFs } from "../services/documentProcessor.js";

export const processDocuments = async (req, res) => {
  try {
    const files = req.files?.pdfs;
    if (!files) {
      return res.status(400).json({ error: "No PDF files uploaded" });
    }

    const fileArray = Array.isArray(files) ? files : [files];
    const { postProcessingJson, zipPath } = await processPDFs(fileArray);

    const results = postProcessingJson.filtered_records.map(record => ({
      first: record.first_name,
      last: record.last_name,
      mobile: record.mobile,
      email: record.email,
      address: record.address,
      dob: record.dateofbirth,
      seen: record.lastseen,
      source: record.file_name || ''
    }));
    
    res.json({ results: results || [], zipPath: `/api/documents/download?file=${path.basename(zipPath)}` });
  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

export const downloadZip = (req, res) => {
    const { file } = req.query;
    if (!file) {
        return res.status(400).json({ error: "No file specified for download." });
    }
    const filePath = path.join(process.cwd(), "output", file);
    res.download(filePath, (err) => {
        if (err) {
            console.error("🔥 Error downloading file:", err);
            res.status(500).json({ error: "Could not download the file." });
        }
    });
};
