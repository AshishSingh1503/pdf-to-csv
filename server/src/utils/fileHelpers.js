import fs from "fs";
import path from "path";
import { createObjectCsvWriter } from "csv-writer";
import archiver from "archiver";
import xlsx from "xlsx";
import { Writable } from "stream";

export const saveFiles = async (
  rawRecords,
  filteredRecords,
  preProcessingJson,
  postProcessingJson,
  sessionDir
) => {
  // Save raw CSV
  const rawCsvPath = path.join(sessionDir, "raw_data.csv");
  const rawCsvWriter = createObjectCsvWriter({
    path: rawCsvPath,
    header: Object.keys(rawRecords[0] || {}).map(key => ({id: key, title: key}))
  });
  await rawCsvWriter.writeRecords(rawRecords);

  // Save filtered CSV
  const filteredCsvPath = path.join(sessionDir, "filtered_data.csv");
  const filteredCsvWriter = createObjectCsvWriter({
    path: filteredCsvPath,
    header: Object.keys(filteredRecords[0] || {}).map(key => ({id: key, title: key}))
  });
  await filteredCsvWriter.writeRecords(filteredRecords);

  // Save raw Excel
  const rawExcelPath = path.join(sessionDir, "raw_data.xlsx");
  const rawWorkbook = xlsx.utils.book_new();
  const rawWorksheet = xlsx.utils.json_to_sheet(rawRecords);
  xlsx.utils.book_append_sheet(rawWorkbook, rawWorksheet, "Raw Data");
  xlsx.writeFile(rawWorkbook, rawExcelPath);

  // Save filtered Excel
  const filteredExcelPath = path.join(sessionDir, "filtered_data.xlsx");
  const filteredWorkbook = xlsx.utils.book_new();
  const filteredWorksheet = xlsx.utils.json_to_sheet(filteredRecords);
  xlsx.utils.book_append_sheet(filteredWorkbook, filteredWorksheet, "Filtered Data");
  xlsx.writeFile(filteredWorkbook, filteredExcelPath);

  // Save combined pre-processing JSON
  const combinedPreJsonPath = path.join(sessionDir, "combined_pre_processing.json");
  fs.writeFileSync(combinedPreJsonPath, JSON.stringify(preProcessingJson, null, 2));

  // Save combined post-processing JSON
  const combinedPostJsonPath = path.join(sessionDir, "combined_post_processing.json");
  fs.writeFileSync(combinedPostJsonPath, JSON.stringify(postProcessingJson, null, 2));
};

export const createZip = (sessionDir) => {
  const zipPath = path.join(sessionDir, "archive.zip");
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on("close", () => resolve(zipPath));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(sessionDir, false);
    archive.finalize();
  });
};
