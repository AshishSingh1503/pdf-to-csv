// server/src/controllers/documentController.js
import path from "path";
import fs from "fs";
import csv from "csv-parser";
import { processPDFs } from "../services/documentProcessor.js";

export const processDocuments = async (req, res) => {
  try {
    const files = req.files?.pdfs;
    if (!files) return res.status(400).json({ error: "No PDF files uploaded" });

    const fileArray = Array.isArray(files) ? files : [files];
    const results = await processPDFs(fileArray);

    // Dynamically find the generated CSV file
    const outputDir = path.join(process.cwd(), "output");
    const processedDir = path.join(outputDir, "processed_results");
    const csvFiles = fs.readdirSync(processedDir).filter(file => file.endsWith('.csv'));

    let clients = [];
    if (csvFiles.length > 0) {
      const csvFile = path.join(processedDir, csvFiles[0]);
      clients = await parseCSV(csvFile);
    }

    res.json({ results: clients });
  } catch (err) {
    console.error("🔥 Error in processDocuments:", err);
    res.status(500).json({ error: err.message });
  }
};

// Updated parseCSV to handle Field/Value vertical CSVs with arrays
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve([]);

    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => {
        const clients = [];
        let client = { first: "", last: "", mobile: [], email: [], address: "", dob: "", seen: "", source: "" };

        const pushClient = () => {
          if (client.first || client.last || client.mobile.length || client.email.length || client.address || client.dob || client.seen || client.source) {
            // Flatten arrays to comma-separated strings
            clients.push({
              ...client,
              mobile: client.mobile.join(", "),
              email: client.email.join(", "),
            });
            client = { first: "", last: "", mobile: [], email: [], address: "", dob: "", seen: "", source: "" };
          }
        };

        rows.forEach((row) => {
          const field = row.Field?.toLowerCase().trim();
          const value = row.Value?.replace(/\n/g, " ").trim() || "";
          if (!value) return;

          switch (field) {
            case "name":
              if (client.first || client.last) pushClient();
              const [first, ...last] = value.split(" ");
              client.first = first || "";
              client.last = last.join(" ") || "";
              break;
            case "mobile":
              client.mobile.push(value);
              break;
            case "email":
              client.email.push(value);
              break;
            case "address":
              client.address = client.address ? client.address + ", " + value : value;
              break;
            case "dateofbirth":
              client.dob = value;
              break;
            case "lastseen":
              client.seen = value;
              break;
            case "source":
              client.source = value;
              break;
            default:
              break;
          }
        });

        pushClient(); // Push the last client
        resolve(clients);
      })
      .on("error", reject);
  });
};
