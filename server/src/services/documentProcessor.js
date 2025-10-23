// server/src/services/documentProcessor.js
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import fs from "fs";
import path from "path";
import { clearOutput, saveCSV, createZip } from "../utils/fileHelpers.js";

// Ensure credentials file exists
if (!fs.existsSync(config.credentials)) {
  throw new Error(`Google credentials file not found at: ${config.credentials}`);
}

// Initialize Document AI client
const client = new DocumentProcessorServiceClient({
  keyFilename: config.credentials,
});

// --- Helper Functions ported from Python ---

const extractEntitiesSimple = (document) => {
  return document.entities.map(entity => ({
    type: entity.type.toLowerCase().trim(),
    value: entity.mentionText.trim(),
  }));
};

const simpleGrouping = (entities) => {
  const records = [];
  const names = entities.filter(e => e.type === 'name').map(e => e.value);
  const mobiles = entities.filter(e => e.type === 'mobile').map(e => e.value);
  const addresses = entities.filter(e => e.type === 'address').map(e => e.value);
  const emails = entities.filter(e => e.type === 'email').map(e => e.value);
  const dobs = entities.filter(e => e.type === 'dateofbirth').map(e => e.value);
  const landlines = entities.filter(e => e.type === 'landline').map(e => e.value);
  const lastseens = entities.filter(e => e.type === 'lastseen').map(e => e.value);

  const maxCount = Math.max(names.length, mobiles.length, addresses.length, emails.length, dobs.length, landlines.length, lastseens.length);

  for (let i = 0; i < maxCount; i++) {
    const record = {};
    if (i < names.length) {
      const nameParts = names[i].split(' ');
      record.first_name = nameParts[0] || '';
      record.last_name = nameParts.slice(1).join(' ') || '';
    }
    if (i < mobiles.length) record.mobile = mobiles[i];
    if (i < addresses.length) record.address = addresses[i];
    if (i < emails.length) record.email = emails[i];
    if (i < dobs.length) record.dateofbirth = dobs[i];
    if (i < landlines.length) record.landline = landlines[i];
    if (i < lastseens.length) record.lastseen = lastseens[i];
    
    if (record.first_name) {
      records.push(record);
    }
  }
  return records;
};

const fixAddressOrdering = (address) => {
    if (!address) return address;
    address = address.trim();

    // Pattern 1: Postcode and state at the beginning (e.g., "NSW 2289 114 Northcott Drive...")
    const postcodeStatePattern = /^([A-Z]{2,3}\s+\d{4})\s+(.+)$/;
    let match = address.match(postcodeStatePattern);
    if (match) {
        return `${match[2]} ${match[1]}`;
    }

    // Pattern 2: Postcode at the beginning without state (e.g., "2289 114 Northcott Drive... NSW")
    const postcodeOnlyPattern = /^(\d{4})\s+(.+?)\s+([A-Z]{2,3})$/;
    match = address.match(postcodeOnlyPattern);
    if (match) {
        return `${match[2]} ${match[3]} ${match[1]}`;
    }

    // Pattern 3: State and postcode in the middle (e.g., "114 Northcott Drive NSW 2289 ADAMSTOWN...")
    const statePostcodeMiddlePattern = /^(.+?)\s+([A-Z]{2,3}\s+\d{4})\s+(.+)$/;
    match = address.match(statePostcodeMiddlePattern);
    if (match) {
        return `${match[1]} ${match[3]} ${match[2]}`;
    }

    return address;
};

const cleanAndValidate = (records) => {
  const cleanRecords = [];
  const seenMobiles = new Set();

  for (const record of records) {
    const firstName = record.first_name?.trim() || '';
    const mobile = record.mobile?.trim() || '';
    const address = record.address?.trim() || '';

    if (!firstName || firstName.length <= 1) continue;
    if (!mobile) continue;

    const mobileDigits = mobile.replace(/\D/g, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) continue;
    
    // Address must have a number in the first 15 chars
    if (!address || !/\d/.test(address.substring(0, 15))) continue;

    if (!seenMobiles.has(mobileDigits)) {
      cleanRecords.push({
        first_name: firstName,
        last_name: record.last_name?.trim() || '',
        mobile: mobileDigits,
        address: fixAddressOrdering(address),
        email: record.email?.trim() || '',
        dateofbirth: record.dateofbirth?.trim() || '',
        landline: record.landline?.trim() || '',
        lastseen: record.lastseen?.trim() || '',
      });
      seenMobiles.add(mobileDigits);
    }
  }
  return cleanRecords;
};

// --- Main Processing Function ---

export const processPDFs = async (pdfFiles) => {
  try {
    clearOutput(); // Clean old output files

    const tempDir = path.join(process.cwd(), "temp");
    const outputDir = path.join(process.cwd(), "output", "processed_results");

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    let allEntities = [];
    let allRawRecords = [];
    let allFilteredRecords = [];

    console.log(`Processing ${pdfFiles.length} file(s)...`);

    for (const file of pdfFiles) {
      const tempPath = path.join(tempDir, file.name);
      await file.mv(tempPath);

      const [result] = await client.processDocument({
        name: `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`,
        rawDocument: {
          content: fs.readFileSync(tempPath),
          mimeType: "application/pdf",
        },
      });

      const entities = extractEntitiesSimple(result.document);
      entities.forEach(e => e.file_name = file.name); // Add file context
      allEntities.push(...entities);

      const rawRecords = simpleGrouping(entities);
      rawRecords.forEach(r => r.file_name = file.name);
      allRawRecords.push(...rawRecords);

      const filteredRecords = cleanAndValidate(rawRecords);
      filteredRecords.forEach(r => r.file_name = file.name);
      allFilteredRecords.push(...filteredRecords);
      
      // Save a CSV for the raw entities of each file
      await saveCSV(entities, file.name);

      fs.unlinkSync(tempPath); // Clean up temp file
    }
    
    // --- Create final JSON objects ---

    // Create pre-processing records with full_name instead of first_name/last_name
    const preProcessingRecords = allRawRecords.map(record => ({
      full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
      mobile: record.mobile,
      address: record.address,
      email: record.email,
      dateofbirth: record.dateofbirth,
      landline: record.landline,
      lastseen: record.lastseen,
      file_name: record.file_name
    }));

    const preProcessingJson = {
      processing_timestamp: new Date().toISOString(),
      total_files: pdfFiles.length,
      raw_records: preProcessingRecords,
      document_ai_entities: allEntities,
    };

    const postProcessingJson = {
      processing_timestamp: new Date().toISOString(),
      total_files: pdfFiles.length,
      raw_records: allRawRecords,
      filtered_records: allFilteredRecords,
      summary: {
          total_raw_records: allRawRecords.length,
          total_filtered_records: allFilteredRecords.length,
          success_rate: allRawRecords.length > 0 ? `${((allFilteredRecords.length / allRawRecords.length) * 100).toFixed(1)}%` : "0%"
      }
    };
    
    // --- Save JSON files ---
    fs.writeFileSync(
      path.join(outputDir, "pre_process.json"),
      JSON.stringify(preProcessingJson, null, 2)
    );
    fs.writeFileSync(
      path.join(outputDir, "post_process.json"),
      JSON.stringify(postProcessingJson, null, 2)
    );
    
    console.log("All files processed successfully!");
    
    const zipPath = await createZip();
    
    return { preProcessingJson, postProcessingJson, zipPath };

  } catch (error) {
    console.error("Error in processPDFs:", error);
    throw error;
  }
};
