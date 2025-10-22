// server/src/controllers/documentController.js
import path from "path";
import fs from "fs";
import csv from "csv-parser";
import { processPDFs } from "../services/documentProcessor.js";

// Existing function
export const processDocuments = async (req, res) => {
  try {
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const files = req.files?.pdfs;
    if (!files) return res.status(400).json({ error: "No PDF files uploaded" });

    const fileArray = Array.isArray(files) ? files : [files];
    const results = await processPDFs(fileArray, tempDir, outputDir);

    // Parse generated CSV into structured JSON
    const csvFile = path.join(outputDir, "processed_results", "Page 26.csv");
    const clients = await parseCSV(csvFile);

    res.json({ results: clients });
  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

// New helper function
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve([]);

    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => {
        const clients = [];
        const clientMap = {};

        rows.forEach((row) => {
          const key = row.name || row.email || row.mobile; // unique identifier
          if (!clientMap[key]) {
            clientMap[key] = {};
            clients.push(clientMap[key]);
          }

          const client = clientMap[key];

          if (row.name) {
            const [first, ...last] = row.name.split(" ");
            client.first = first;
            client.last = last.join(" ");
          }
          if (row.mobile) client.mobile = row.mobile.replace(/\n/g, " ");
          if (row.email) client.email = row.email;
          if (row.address) client.address = row.address.replace(/\n/g, " ");
          if (row.dateofbirth) client.dob = row.dateofbirth;
          if (row.lastseen) client.seen = row.lastseen;
          if (row.source) client.source = row.source;
        });

        resolve(clients);
      })
      .on("error", reject);
  });
};
