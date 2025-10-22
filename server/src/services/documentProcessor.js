import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import fs from "fs";
import path from "path";
import { detectDuplicates } from "../utils/duplicateUtils.js";
import { saveCSV, createZip, clearOutput } from "../utils/fileHelpers.js";

const client = new DocumentProcessorServiceClient({
  keyFilename: config.credentials,
});

export const processPDFs = async (pdfFiles) => {
  clearOutput(); // fresh start
  const results = [];

  for (const file of pdfFiles) {
    const tempPath = path.join("temp", file.name);
    await file.mv(tempPath);

    const [result] = await client.processDocument({
      name: `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`,
      rawDocument: {
        content: fs.readFileSync(tempPath),
        mimeType: "application/pdf",
      },
    });

    const entities = result.document.entities.map((e) => ({
      type: e.type.toLowerCase(),
      value: e.mentionText,
    }));

    await saveCSV(entities, file.name);
    fs.unlinkSync(tempPath);
    results.push({ fileName: file.name, entities });
  }

  const flattened = results.flatMap((r) => r.entities);
  const duplicates = config.enableDuplicateDetection
    ? detectDuplicates(flattened, config.duplicateKeyField)
    : [];

  const zipPath = await createZip();
  return { results, duplicates, zip: `/api/documents/download?file=${path.basename(zipPath)}` };
};
