// --- START: validators.worker.js ---
import { parentPort } from 'worker_threads';

// --- Helper Functions (Worker-Compatible) ---
// These must be defined *inside* the worker file to be accessible.

const _single_line_address = (address, patterns) => {
  if (!address) return '';
  let s = address.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/[,;\|/]+/g, ' ');
  s = s.replace(patterns.whitespaceMultiple, ' ').trim();
  s = s.endsWith('.') ? s.slice(0, -1) : s;
  return s;
};

// --- This is the function you wanted to keep ---
const fixAddressOrdering = (address, patterns) => {
  if (!address) return address;

  // Use the patterns object passed in the task
  let s = _single_line_address(address, patterns).trim();
  let match;

  match = s.match(patterns.addressStatePostcodeStart);
  if (match) {
    const [, state, postcode, rest] = match;
    const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
    return out.replace(patterns.whitespaceMultiple, ' ').trim();
  }

  match = s.match(patterns.addressPostcodeStateEnd);
  if (match) {
    const [, postcode, rest, state] = match;
    const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
    return out.replace(patterns.whitespaceMultiple, ' ').trim();
  }

  match = s.match(patterns.addressStatePostcodeMiddle);
  if (match) {
    const [, part1, state, postcode, part2] = match;
    const out = `${part1.trim()} ${part2.trim()} ${state.toUpperCase()} ${postcode}`;
    return out.replace(patterns.whitespaceMultiple, ' ').trim();
  }

  match = s.match(patterns.addressStatePostcodeAny);
  if (match) {
    const state = match[1].toUpperCase();
    const postcode = match[2];
    const rest = (s.substring(0, match.index) + s.substring(match.index + match[0].length)).trim();
    const out = `${rest.replace(patterns.whitespaceMultiple, ' ')} ${state} ${postcode}`;
    return out.trim();
  }

  return s;
};

const cleanName = (name, patterns) => {
  if (!name) return '';
  let s = name.trim();
  s = s.replace(patterns.nameSpecialChars, '');
  s = s.replace(/[\d?]+/g, '');
  s = s.replace(patterns.nameInvalidChars, '');
  s = s.replace(patterns.whitespaceMultiple, ' ').trim();
  const parts = s ? s.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)) : [];
  return parts.join(' ').trim();
};

// --- Updated to match main file's logic ---
const normalizeDateField = (dateStr, patterns) => {
  if (!dateStr) return '';
  let s = dateStr.trim();
  s = s.replace(patterns.dashNormalize, '-');
  s = s.replace(patterns.dashMultiple, '-');
  s = s.replace(patterns.dashTrim, '');
  s = s.replace(patterns.dateInvalidChars, '');
  s = s.replace(/\./g, '-');

  const match = s.match(patterns.dateFormat); // Using the regex from the main file
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

const isValidLandline = (landline, patterns) => {
  if (!landline) return false;
  const digits = landline.replace(patterns.digitOnly, '');
  return digits.length >= 10;
};

// --- Main Validation Function (Worker) ---

const cleanAndValidateForWorker = (records, patterns) => {
  const cleanRecords = [];
  const discardedRecords = []; // <-- NEW: Array to store discarded records

  for (const record of records) {
    // Use String() for safety, handles null/undefined
    const rawFirst = String(record.first_name || '').trim();
    const rawLast = String(record.last_name || '').trim();
    const rawDob = String(record.dateofbirth || '').trim();
    const rawLastseen = String(record.lastseen || '').trim();

    const firstName = cleanName(rawFirst, patterns);
    const lastName = cleanName(rawLast, patterns);

    const mobile = String(record.mobile || '').trim();
    let address = String(record.address || '').trim();
    const email = String(record.email || '').trim();
    const rawLandline = String(record.landline || '').trim();

    // --- Run address fixing, mirroring the main thread's logic ---
    address = fixAddressOrdering(address, patterns);

    const dateofbirth = normalizeDateField(rawDob, patterns);
    const lastseen = normalizeDateField(rawLastseen, patterns);

    // --- START VALIDATION LOGIC ---

    if (!firstName || firstName.length <= 1) {
      discardedRecords.push({ record, reason: 'Invalid or missing first name' });
      continue;
    }
    if (!mobile) {
      discardedRecords.push({ record, reason: 'Missing mobile number' });
      continue;
    }

    const mobileDigits = mobile.replace(patterns.digitOnly, '');
  	 if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) {
      discardedRecords.push({ record, reason: 'Invalid mobile (must be 10 digits starting with 04)' });
      continue;
    }
  
    // --- END VALIDATION LOGIC --- (Address filter is removed)

    const landline = isValidLandline(rawLandline, patterns) ? rawLandline.replace(patterns.digitOnly, '') : '';
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

  // Return both good and bad records
  return { good: cleanRecords, bad: discardedRecords };
};

// --- Worker Message Handler ---

parentPort.on('message', (task) => {
  try {
    if (task.type === 'validate') {
      // Get regex patterns from the main thread
      const patterns = task.patterns;
      
      // Run the validation function that returns { good, bad }
      const result = cleanAndValidateForWorker(task.records, patterns);
      
      // Send the entire result object back
      parentPort.postMessage(result);
    }
  } catch (error) {
    // Send error back to the main thread
    parentPort.postMessage({ error: error.message, stack: error.stack });
  }
});

// --- END: validators.worker.js ---