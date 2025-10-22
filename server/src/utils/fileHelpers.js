import fs from "fs";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";
import archiver from "archiver";

const OUTPUT_DIR = path.join(process.cwd(), "output");

export const saveCSV = async (data, fileName) => {
  const csvPath = path.join(OUTPUT_DIR, "processed_results", fileName.replace(".pdf", ".csv"));
  const writer = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: "type", title: "Field" },
      { id: "value", title: "Value" },
    ],
  });

  await writer.writeRecords(data);
  return csvPath;
};

export const createZip = async () => {
  const zipPath = path.join(OUTPUT_DIR, "processed_results.zip");
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    archive.pipe(output);
    archive.directory(OUTPUT_DIR, false);
    archive.finalize();

    output.on("close", () => resolve(zipPath));
    archive.on("error", (err) => reject(err));
  });
};

export const clearOutput = () => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
};
