// --- START: validators.worker.js ---
import { validateRecords } from "../utils/validators.js";

// --- Main Validation Function ---

const cleanAndValidateRecords = (records, patterns) => {
  // patterns is kept for compatibility but unused
  return validateRecords(records);
};

// --- Worker Message Handler ---

import { parentPort } from 'worker_threads';

if (parentPort) {
  parentPort.on('message', (data) => {
    try {
      if (data.type === 'validate') {
        const result = cleanAndValidateRecords(data.records, data.patterns);
        parentPort.postMessage(result);
      }
    } catch (error) {
      parentPort.postMessage({ error: error.message, stack: error.stack });
    }
  });
}
