// server/src/services/validators.worker.js
import { parentPort } from "worker_threads";

/**
 * Worker thread for parallel record validation
 * Handles CPU-intensive cleaning and validation operations
 */

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


const _single_line_address = (address, patterns) => {
  if (!address) return '';
  let s = address.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/[,;\|/]+/g, ' ');
  s = s.replace(patterns.whitespaceMultiple, ' ').trim();
  s = s.endsWith('.') ? s.slice(0, -1) : s;
  return s;
}


const fixAddressOrdering = (address, patterns) => {
  if (!address) return address;

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


const normalizeDateField = (dateStr, patterns) => {
  if (!dateStr) return '';
  let s = dateStr.trim();
  s = s.replace(patterns.dashNormalize, '-');
  s = s.replace(patterns.dashMultiple, '-');
  s = s.replace(patterns.dashTrim, '');
  s = s.replace(patterns.dateInvalidChars, '');
  s = s.replace(/\./g, '-');

  const match = s.match(patterns.dateFormat);
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


const cleanAndValidateRecords = (records, patterns) => {
  const cleanRecords = [];

  for (const record of records) {
    const rawFirst = record.first_name?.trim() || '';
    const rawLast = record.last_name?.trim() || '';
    const rawDob = record.dateofbirth?.trim() || '';
    const rawLastseen = record.lastseen?.trim() || '';

    const firstName = cleanName(rawFirst, patterns);
    const lastName = cleanName(rawLast, patterns);

    const mobile = record.mobile?.trim() || '';
    let address = record.address?.trim() || '';
    const email = record.email?.trim() || '';
    const rawLandline = record.landline?.trim() || '';

    address = fixAddressOrdering(address, patterns);

    const dateofbirth = normalizeDateField(rawDob, patterns);
    const lastseen = normalizeDateField(rawLastseen, patterns);

    if (!firstName || firstName.length <= 1) continue;
    if (!mobile) continue;

    const mobileDigits = mobile.replace(patterns.digitOnly, '');
    if (!(mobileDigits.length === 10 && mobileDigits.startsWith('04'))) continue;

    if (!address || !/\d/.test(address.substring(0, 25))) continue;

    const landline = isValidLandline(rawLandline, patterns) ? rawLandline.replace(patterns.digitOnly, '') : '';

    cleanRecords.push({
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

  // Deduplicate by mobile
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


// Listen for validation tasks
parentPort.on('message', (task) => {
  try {
    if (task.type === 'validate') {
      const validatedRecords = cleanAndValidateRecords(task.records, task.patterns);
      parentPort.postMessage(validatedRecords);
    } else {
      parentPort.postMessage({ error: `Unknown task type: ${task.type}` });
    }
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});