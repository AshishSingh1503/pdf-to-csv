import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import fs from "fs";
import path from "path";
import { detectDuplicates } from "../utils/duplicateUtils.js";
import { saveCSV, createZip, clearOutput } from "../utils/fileHelpers.js";

// ✅ Ensure credentials file exists
if (!fs.existsSync(config.credentials)) {
  throw new Error(`❌ Google credentials file not found at: ${config.credentials}`);
}

// ✅ Initialize Document AI client
const client = new DocumentProcessorServiceClient({
  keyFilename: config.credentials,
});

export const processPDFs = async (pdfFiles) => {
  try {
    // ✅ Prepare required directories
    const tempDir = path.join(process.cwd(), "temp");
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // ✅ Clean old output files
    clearOutput();

    const results = [];
    console.log(`⚙️ Processing ${pdfFiles.length} file(s)...`);

    for (const file of pdfFiles) {
      const tempPath = path.join(tempDir, file.name);
      await file.mv(tempPath); // Move uploaded file to temp folder

      console.log(`📄 Processing file: ${file.name}`);

      // 🧠 Send file to Google Document AI
      const [result] = await client.processDocument({
        name: `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`,
        rawDocument: {
          content: fs.readFileSync(tempPath),
          mimeType: "application/pdf",
        },
      });

      // 🧾 Extract entities from Document AI response
      const entities = result.document.entities?.map((e) => ({
        type: e.type?.toLowerCase() || "unknown",
        value: e.mentionText || "",
      })) || [];

      // 💾 Save CSV for this file
      await saveCSV(entities, file.name);

      // 🧹 Remove temp PDF file
      fs.unlinkSync(tempPath);

      results.push({ fileName: file.name, entities });
    }

    // 🔁 Handle duplicate detection if enabled
    const flattened = results.flatMap((r) => r.entities);
    const duplicates = config.enableDuplicateDetection
      ? detectDuplicates(flattened, config.duplicateKeyField)
      : [];

    // 📦 Create ZIP of all CSVs
    const zipPath = await createZip();

    console.log("✅ All files processed successfully!");
    return {
      results,
      duplicates,
      zip: `/api/documents/download?file=${path.basename(zipPath)}`,
    };

  } catch (error) {
    console.error("🔥 Error in processPDFs:", error);
    throw error;
  }
};
