/**
 * test_scripts/batch_upload_test.js
 *
 * Automated test script to exercise batch upload flow and capture WebSocket events.
 *
 * Notes:
 * - This script is a convenience tool for local testing. It assumes the API server is running
 *   and reachable at API_BASE (default http://localhost:8080 or configured via env).
 * - The script uses `axios`, `ws`, and `form-data`. Install them before running:
 *     npm install axios ws form-data
 *
 * Usage:
 *   API_BASE=http://localhost:8080 COLLECTION_ID=1 node test_scripts/batch_upload_test.js
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
const FormData = require('form-data');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const WS_URL = (process.env.WS_URL) || API_BASE.replace(/^http/, 'ws') + '/ws';
const COLLECTION_ID = process.env.COLLECTION_ID || process.env.COLLECTION || 1;
const TEST_FILES_DIR = process.env.TEST_FILES_DIR || path.resolve(__dirname, '..', 'test_files', '25_pdfs');
const FILE_COUNT = Number(process.env.FILE_COUNT) || 25;

async function collectTestFiles() {
  if (!fs.existsSync(TEST_FILES_DIR)) {
    throw new Error(`Test files dir not found: ${TEST_FILES_DIR}`);
  }
  const files = fs.readdirSync(TEST_FILES_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).slice(0, FILE_COUNT);
  return files.map(f => path.join(TEST_FILES_DIR, f));
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function uploadFiles(filePaths) {
  // This function posts a multipart/form-data to the server endpoint used by the client.
  // Adjust /api/documents/process as necessary to match your server API.
  const url = `${API_BASE}/api/documents/process`;

  const form = new FormData();
  // add collection id
  form.append('collectionId', COLLECTION_ID);
  filePaths.forEach(p => form.append('files', fs.createReadStream(p)));

  const headers = form.getHeaders();
  try {
    const resp = await axios.post(url, form, { headers, maxContentLength: Infinity, maxBodyLength: Infinity });
    return resp.data;
  } catch (err) {
    console.error('Upload failed:', err && err.response ? err.response.data : err.message);
    throw err;
  }
}

async function run() {
  console.log('Batch upload test starting');
  const filePaths = await collectTestFiles();
  console.log(`Found ${filePaths.length} files to upload`);

  const ws = await connectWs();
  console.log('WebSocket connected:', WS_URL);

  const events = [];
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      events.push({ ts: Date.now(), msg });
      console.log('WS:', msg.type || msg);
    } catch (e) {
      console.log('WS (raw):', data.toString());
    }
  });

  console.log('Uploading files...');
  try {
    const resp = await uploadFiles(filePaths);
    console.log('Upload response:', resp && resp.success !== undefined ? 'OK' : resp);
  } catch (err) {
    console.error('Upload error, aborting test');
    ws.close();
    return;
  }

  console.log('Waiting for batch completion events... (timeout 10 minutes)');
  const finished = await waitForBatchTerminalEvent(events, 10 * 60 * 1000);
  ws.close();

  console.log('Events captured:', events.length);
  const summary = summarizeEvents(events);
  console.log('Summary:', JSON.stringify(summary, null, 2));
}

function waitForBatchTerminalEvent(events, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const found = events.find(e => e.msg && (e.msg.type === 'BATCH_PROCESSING_COMPLETED' || e.msg.type === 'BATCH_PROCESSING_FAILED'));
      if (found) {
        clearInterval(interval);
        resolve(found);
      }
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        resolve(null);
      }
    }, 1000);
  });
}

function summarizeEvents(events) {
  const types = events.reduce((acc, e) => {
    const t = e.msg && e.msg.type ? e.msg.type : 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  return { totalEvents: events.length, types };
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
