// server/src/services/documentProcessor.js
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from "../config/index.js";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";

// Initialize Document AI client
let client;
try {
  const clientConfig = process.env.NODE_ENV === 'production' ? {} : { keyFilename: config.credentials };
  client = new DocumentProcessorServiceClient(clientConfig);
  console.log('✅ Document AI client initialized successfully');
} catch (error) {
  console.error("🔥 Failed to initialize Document AI client:", error);
  throw new Error("Failed to initialize Document AI client. Please check your Google Cloud credentials.");
}

// --- Helper Functions ported from Python ---

const extractEntitiesSimple = (document) => {
  return document.entities?.map(entity => ({
    type: entity.type?.toLowerCase().trim(),
    value: entity.mentionText?.trim(),
  })) || [];
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

const _single_line_address = (address) => {
  if (!address) return '';
  let s = address.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/[,;\|/]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.endsWith('.') ? s.slice(0, -1) : s;
  return s;
}

const fixAddressOrdering = (address) => {
    if (!address) return address;

    let s = _single_line_address(address).trim();
    let match;

    // Pattern A: State + Postcode at the beginning
    match = s.match(/^\s*([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i);
    if (match) {
        const [, state, postcode, rest] = match;
        const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
        return out.replace(/\s+/g, ' ').trim();
    }

    // Pattern B: Postcode at beginning and state at end
    match = s.match(/^\s*(\d{4})\s+(.+?)\s+([A-Za-z]{2,3})\s*$/i);
    if (match) {
        const [, postcode, rest, state] = match;
        const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
        return out.replace(/\s+/g, ' ').trim();
    }

    // Pattern C: State + Postcode in the middle
    match = s.match(/^(.+?)\s+([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i);
    if (match) {
        const [, part1, state, postcode, part2] = match;
        const out = `${part1.trim()} ${part2.trim()} ${state.toUpperCase()} ${postcode}`;
        return out.replace(/\s+/g, ' ').trim();
    }
    
    // Pattern D: If any state+postcode pair exists anywhere, move it to the end
    match = s.match(/([A-Za-z]{2,3})\s+(\d{4})/i);
    if (match) {
        const state = match[1].toUpperCase();
        const postcode = match[2];
        const rest = (s.substring(0, match.index) + s.substring(match.index + match[0].length)).trim();
        const out = `${rest.replace(/\s+/g, ' ')} ${state} ${postcode}`;
        return out.trim();
    }

    return s;
};

const cleanName = (name) => {
  if (!name) return '';
  let s = name.trim();
  s = s.replace(/�|･･･|…|•|\u2026/g, '');
  s = s.replace(/[\d?]+/g, '');
  s = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  const parts = s ? s.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)) : [];
  return parts.join(' ').trim();
};

const normalizeDateField = (dateStr) => {
    if (!dateStr) return '';
    let s = dateStr.trim();
    s = s.replace(/[-\u2013\u2014]+/g, '-');
    s = s.replace(/-{2,}/g, '-');
    s = s.replace(/^[\-\s]+|[\-\s]+$/g, '');
    s = s.replace(/[^0-9A-Za-z\s\-\/]/g, '');
    s = s.replace(/\./g, '-');

    const match = s.match(/^(\d{1,2})([A-Za-z]{3,})(\d{4})$/);
    if (match) {
        s = `${match[1]}-${match[2]}-${match[3]}`;
    }

    try {
        const dt = new Date(s);
        if (isNaN(dt.getTime())) return '';
        const year = dt.getFullYear();
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return '';
    }
};

const cleanAndValidate = (records) => {
  const cleanRecords = [];

  for (const record of records) {
    const rawFirst = record.first_name?.trim() || '';
    const rawLast = record.last_name?.trim() || '';
    const rawDob = record.dateofbirth?.trim() || '';
    const rawLastseen = record.lastseen?.trim() || '';

    const firstName = cleanName(rawFirst);
    const lastName = cleanName(rawLast);

    const mobile = record.mobile?.trim() || '';
    let address = record.address?.trim() || '';
    const email = record.email?.trim() || '';
    const landline = record.landline?.trim() || '';

    address = fixAddressOrdering(address);

    const dateofbirth = normalizeDateField(rawDob);
    const lastseen = normalizeDateField(rawLastseen);

    if (!firstName || firstName.length <= 1) continue;
    if (!mobile) continue;

    const mobileDigits = mobile.replace(/\D/g, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) continue;
    
    if (!address || !/\d/.test(address.substring(0, 25))) continue;

    cleanRecords.push({
      first_name: firstName,
      last_name: lastName,
      dateofbirth: dateofbirth || '',
      address: address,
      mobile: mobileDigits,
      email: email || '',
      landline: landline || '',
      lastseen: lastseen || '',
    });
  }

  const uniqueRecords = [];
  const seenMobiles = new Set();
  for (const record of cleanRecords) {
    if (!seenMobiles.has(record.mobile)) {
      uniqueRecords.push(record);
      seenMobiles.add(record.mobile);
    }
  }

  return uniqueRecords;
};

// --- Main Processing Function ---

export const processPDFs = async (pdfFiles, batchSize = 10, maxWorkers = 4) => {
  const limit = pLimit(maxWorkers);

  try {
    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const processFile = async (file) => {
      const tempPath = path.join(tempDir, file.name);
      await file.mv(tempPath);

      try {
        const [result] = await client.processDocument({
          name: `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`,
          rawDocument: {
            content: fs.readFileSync(tempPath),
            mimeType: "application/pdf",
          },
        });

        const entities = extractEntitiesSimple(result.document);
        const rawRecords = simpleGrouping(entities);
        const filteredRecords = cleanAndValidate(rawRecords);
        
        rawRecords.forEach(r => r.file_name = file.name);
        filteredRecords.forEach(r => r.file_name = file.name);

        const preProcessingRecords = rawRecords.map(record => ({
            full_name: `${record.first_name || ''} ${record.last_name || ''}`.trim(),
            dateofbirth: record.dateofbirth,
            address: record.address,
            mobile: record.mobile,
            email: record.email,
            landline: record.landline,
            lastseen: record.lastseen,
            file_name: record.file_name
        }));

        const preProcessingJson = {
          file_name: file.name,
          processing_timestamp: new Date().toISOString(),
          raw_records: preProcessingRecords,
          document_ai_entities: entities,
          total_entities: entities.length,
          entity_types: [...new Set(entities.map(e => e.type))],
          raw_text: result.document.text,
          metadata: {
            processor_id: config.processorId,
            project_id: config.projectId,
            location: config.location
          }
        };

        const postProcessingJson = {
          file_name: file.name,
          processing_timestamp: new Date().toISOString(),
          raw_records: rawRecords,
          filtered_records: filteredRecords,
          summary: {
              total_raw_records: rawRecords.length,
              total_filtered_records: filteredRecords.length,
              success_rate: rawRecords.length > 0 ? `${((filteredRecords.length / rawRecords.length) * 100).toFixed(1)}%` : "0%"
          },
          field_counts: {
              names: rawRecords.filter(r => r.first_name).length,
              dateofbirths: rawRecords.filter(r => r.dateofbirth).length,
              addresses: rawRecords.filter(r => r.address).length,
              mobiles: rawRecords.filter(r => r.mobile).length,
              emails: rawRecords.filter(r => r.email).length,
              landlines: rawRecords.filter(r => r.landline).length,
              lastseens: rawRecords.filter(r => r.lastseen).length
          },
          metadata: {
            processor_id: config.processorId,
            project_id: config.projectId,
            location: config.location
          }
        };

        return {
          rawRecords,
          filteredRecords,
          preProcessingJson,
          postProcessingJson,
        };
      } finally {
        fs.unlinkSync(tempPath);
      }
    };
    
    const processingPromises = pdfFiles.map(file => limit(() => processFile(file)));
    const results = await Promise.all(processingPromises);

    const allRawRecords = results.flatMap(r => r.rawRecords);
    const allFilteredRecords = results.flatMap(r => r.filteredRecords);
    const allPreProcessingJson = results.map(r => r.preProcessingJson);
    const allPostProcessingJson = results.map(r => r.postProcessingJson);

    return {
      allRawRecords,
      allFilteredRecords,
      allPreProcessingJson,
      allPostProcessingJson,
    };

  } catch (error) {
    console.error("Error in processPDFs:", error);
    throw error;
  }
};
