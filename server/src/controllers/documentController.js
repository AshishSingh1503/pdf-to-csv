import path from "path";
import { processPDFs } from "../services/documentProcessor.js";

export const processDocuments = async (req, res) => {
  try {
    const files = req.files?.pdfs;
    if (!files) return res.status(400).json({ error: "No PDF files uploaded" });

    const fileArray = Array.isArray(files) ? files : [files];
    const results = await processPDFs(fileArray);

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

export const downloadZip = async (req, res) => {
  const { file } = req.query;
  const zipPath = path.join(process.cwd(), "output", file);

  if (!file || !zipPath.endsWith(".zip") || !fs.existsSync(zipPath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(zipPath);
};
