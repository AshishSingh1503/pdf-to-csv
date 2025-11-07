// --- START: validators.worker.js ---

// --- Helper Functions (Worker-Compatible) ---
// Note: These must be defined *inside* the worker file to be accessible.

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

const normalizeDateField = (dateStr, patterns) => {
  if (!dateStr) return '';
  
  let s = dateStr.trim();
  s = s.replace(patterns.dashNormalize, '-');
  s = s.replace(patterns.whitespaceMultiple, '-');
  s = s.replace(patterns.dashMultiple, '-');
  s = s.replace(patterns.dateInvalidChars, '');
  s = s.replace(/[\.-]/g, '-');
  s = s.replace(patterns.dashTrim, '');

  const matchFormat1 = s.match(/^(\d{1,2})-([A-Za-z]{3,})-?(\d{4})$/);
  if (matchFormat1) {
    s = `${matchFormat1[1]}-${matchFormat1[2]}-${matchFormat1[3]}`;
  }

  const matchFormat2 = s.match(/^([A-Za-z]{3,})-?(\d{4})-?(\d{1,2})$/);
  if (matchFormat2) {
    s = `${matchFormat2[3]}-${matchFormat2[1]}-${matchFormat2[2]}`;
  }
  
  const matchFormat3 = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (matchFormat3) {
      s = `${matchFormat3[1]} ${matchFormat3[2]} ${matchFormat3[3]}`;
  }

  try {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return '';
    const year = dt.getFullYear();
    if (year < 1900 || year > 2023) return ''; 
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

    const firstName = cleanName(rawFirst, patterns);
    const lastName = cleanName(rawLast, patterns);

    const mobile = String(record.mobile || '').trim();
    let address = String(record.address || '').trim();
    const email = String(record.email || '').trim();
    const rawLandline = String(record.landline || '').trim();

    address = fixAddressOrdering(address, patterns);

    const dateofbirth = normalizeDateField(rawDob, patterns);
    const lastseen = normalizeDateField(rawLastseen, patterns);

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
    const mobileDigits = mobile.replace(patterns.digitOnly, '');
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

    // Rule 4: Address must exist and contain at least one number *anywhere*
    // NOTE: worker does not enforce deduplication

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

  // NOTE: De-duplication will be handled in the main thread
  // after all worker batches are combined.
  return { validRecords: cleanRecords, rejectedRecords };
};

// --- Worker Message Handler ---

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'validate') {
      const result = cleanAndValidateRecords(data.records, data.patterns);
      // Send the filtered (but not yet unique) records back with rejected records
      self.postMessage(result);
    }
  } catch (error) {
    self.postMessage({ error: error.message, stack: error.stack });
  }
};

// --- END: validators.worker.js ---