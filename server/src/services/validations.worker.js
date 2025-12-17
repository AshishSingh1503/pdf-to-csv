// --- START: validators.worker.js ---
import {
  REGEX_PATTERNS,
  fixAddressOrdering,
  cleanName,
  normalizeDateField,
  isValidLandline,
  fixJumbledMobile,
  fixJumbledLandline
} from "../utils/validators.js";

// --- Main Validation Function ---

const cleanAndValidateRecords = (records, patterns) => {
  const cleanRecords = [];
  const rejectedRecords = [];

  for (const record of records) {
    // Use String() for safety, handles null/undefined
    const rawFirst = String(record.first_name || '').trim();
    const rawLast = String(record.last_name || '').trim();
    const rawDob = String(record.dateofbirth || '').trim();
    const rawLastseen = String(record.lastseen || '').trim();

    // Note: patterns argument is now redundant for imported functions but kept for compatibility if needed
    // However, the imported functions use the imported REGEX_PATTERNS, so we don't need to pass patterns to them.
    // So we can just call them without patterns.

    const firstName = cleanName(rawFirst);
    const lastName = cleanName(rawLast);

    const mobile = fixJumbledMobile(String(record.mobile || '').trim());
    let address = String(record.address || '').trim();
    const email = String(record.email || '').trim();
    const rawLandline = fixJumbledLandline(String(record.landline || '').trim());

    address = fixAddressOrdering(address);

    const dateofbirth = normalizeDateField(rawDob);
    const lastseen = normalizeDateField(rawLastseen);

    // --- VALIDATION RULES ---

    // Rule 1: Must have a valid name
    if (!firstName || firstName.length <= 1) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Invalid first name (single character)'
      });
      continue;
    }

    // Rule 2: Must have a mobile
    if (!mobile) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Missing mobile number'
      });
      continue;
    }

    // Rule 3: Mobile must be a valid 10-digit AU number
    // We can use the imported REGEX_PATTERNS here
    const mobileDigits = mobile.replace(REGEX_PATTERNS.digitOnly, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Invalid mobile number'
      });
      continue;
    }

    // Rule 4: Address must exist
    if (!address) {
      rejectedRecords.push({
        first_name: firstName,
        last_name: lastName,
        mobile,
        address,
        email,
        dateofbirth,
        landline: rawLandline,
        lastseen,
        rejection_reason: 'Unable to validate address'
      });
      continue;
    }
    // NOTE: worker does not enforce deduplication

    const landline = isValidLandline(rawLandline) ? rawLandline.replace(REGEX_PATTERNS.digitOnly, '') : '';
    const full_name = `${firstName} ${lastName}`.trim();

    cleanRecords.push({
      full_name: full_name,
      first_name: firstName,
      last_name: lastName,
      dateofbirth: dateofbirth || '',
      address: address,
      mobile: mobileDigits,
      email: email || '',
      landline: landline,
      lastseen: lastseen || '',
    });
  }

  // NOTE: De-duplication will be handled in the main thread
  // after all worker batches are combined.
  return { validRecords: cleanRecords, rejectedRecords };
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
