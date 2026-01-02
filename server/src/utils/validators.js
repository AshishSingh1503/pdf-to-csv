export const REGEX_PATTERNS = {
    addressStatePostcodeStart: /^\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})\s+(.+)$/i,
    addressPostcodeStateEnd: /^\s*(\d{4})\s+(.+?)\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s*$/i,
    addressStatePostcodeMiddle: /^(.+?)\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})\s+(.+)$/i,
    addressStatePostcodeAny: /(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})/i,
    nameInvalidChars: /[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]/g,
    nameSpecialChars: /|･･･|…|•|\u2026/g,
    dateInvalidChars: /[^0-9A-Za-z\s\-\/]/g,
    dateFormat: /^(\d{1,2})([A-Za-z]{3,})(\d{4})$/,
    dashNormalize: /[-\u2013\u2014]+/g,
    dashMultiple: /-{2,}/g,
    dashTrim: /^[\-\s]+|[\-\s]+$/g,
    whitespaceMultiple: /\s+/g,
    digitOnly: /\D/g,
};

export const _single_line_address = (address) => {
    if (!address) return '';
    let s = address.replace(/\r/g, ' ').replace(/\n/g, ' ');
    s = s.replace(/[,;\|/]+/g, ' ');
    s = s.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
    s = s.endsWith('.') ? s.slice(0, -1) : s;
    return s;
};

export const fixAddressOrdering = (address) => {
    if (!address) return address;
    let s = _single_line_address(address).trim();
    let match;

    match = s.match(REGEX_PATTERNS.addressStatePostcodeStart);
    if (match) {
        const [, state, postcode, rest] = match;
        const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
        return out.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
    }

    match = s.match(REGEX_PATTERNS.addressPostcodeStateEnd);
    if (match) {
        const [, postcode, rest, state] = match;
        const out = `${rest.trim()} ${state.toUpperCase()} ${postcode}`;
        return out.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
    }

    match = s.match(REGEX_PATTERNS.addressStatePostcodeMiddle);
    if (match) {
        const [, part1, state, postcode, part2] = match;
        const out = `${part1.trim()} ${part2.trim()} ${state.toUpperCase()} ${postcode}`;
        return out.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
    }

    match = s.match(REGEX_PATTERNS.addressStatePostcodeAny);
    if (match) {
        const state = match[1].toUpperCase();
        const postcode = match[2];
        const rest = (s.substring(0, match.index) + s.substring(match.index + match[0].length)).trim();
        const out = `${rest.replace(REGEX_PATTERNS.whitespaceMultiple, ' ')} ${state} ${postcode}`;
        return out.trim();
    }

    return s;
};

export const cleanName = (name) => {
    if (!name) return '';
    let s = name.trim();
    s = s.replace(REGEX_PATTERNS.nameSpecialChars, '');
    s = s.replace(/[\d?]+/g, '');
    s = s.replace(REGEX_PATTERNS.nameInvalidChars, '');
    s = s.replace(REGEX_PATTERNS.whitespaceMultiple, ' ').trim();
    const parts = s ? s.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)) : [];
    return parts.join(' ').trim();
};

export const normalizeDateField = (dateStr) => {
    if (!dateStr) return '';
    let s = dateStr.trim();
    // 1. Replace common separators (dot, slash, space) with dash
    s = s.replace(/[\.\/\s]+/g, '-');

    // 2. Insert dash between Digit-Letter and Letter-Digit
    s = s.replace(/(\d)([A-Za-z])/g, '$1-$2');
    s = s.replace(/([A-Za-z])(\d)/g, '$1-$2');

    // 3. Normalize dashes (clean up duplicates and non-standard dashes)
    s = s.replace(REGEX_PATTERNS.dashNormalize, '-');
    s = s.replace(REGEX_PATTERNS.dashMultiple, '-');
    s = s.replace(REGEX_PATTERNS.dashTrim, '');
    // NOTE: We do NOT strip all "invalid" chars because we want strict structure.
    // Assuming dateInvalidChars might be too aggressive or not aggressive enough, 
    // but for strict validation we rely on specific regex matches below.

    let year = null;
    let month = null;
    let day = null;

    // Helper: validate ranges
    const isValidDate = (y, m, d) => {
        const yi = parseInt(y, 10);
        const mi = parseInt(m, 10);
        const di = parseInt(d, 10);
        if (yi < 1900 || yi > 2025) return false;
        if (mi < 1 || mi > 12) return false;
        if (di < 1 || di > 31) return false;

        // Strict day check (e.g. Feb 30)
        const dateObj = new Date(yi, mi - 1, di);
        if (dateObj.getFullYear() !== yi || dateObj.getMonth() !== mi - 1 || dateObj.getDate() !== di) {
            return false;
        }
        return true;
    };

    // Format 1: DD-Mon-YYYY (e.g., 20-Aug-2001) or DD-MM-YYYY
    // Regex explanation:
    // ^(\d{1,2})       -> Day (1 or 2 digits)
    // -                -> Separator
    // ([A-Za-z]{3,}|\d{1,2}) -> Month (Name e.g. Aug or Digits e.g. 08)
    // -                -> Separator
    // (\d{4})$         -> Year (4 digits)
    const matchDDMMYYYY = s.match(/^(\d{1,2})-([A-Za-z]{3,}|\d{1,2})-(\d{4})$/);
    if (matchDDMMYYYY) {
        day = matchDDMMYYYY[1];
        month = matchDDMMYYYY[2];
        year = matchDDMMYYYY[3];
    } else {
        // Format 2: YYYY-MM-DD (e.g. 2001-08-20)
        const matchYYYYMMDD = s.match(/^(\d{4})-([A-Za-z]{3,}|\d{1,2})-(\d{1,2})$/);
        if (matchYYYYMMDD) {
            year = matchYYYYMMDD[1];
            month = matchYYYYMMDD[2];
            day = matchYYYYMMDD[3];
        } else {
            // Format 3: Mon DD, YYYY or similar with spaces (handled by some current logic?)
            // The current code handled: D-Mon-YYYY with spaces normalized to dashes?
            // Let's stick to the specific formats observed.

            // Check existing fallback: ^(\d{1,2})([A-Za-z]{3,})(\d{4})$ (e.g. 20Aug2001)
            const matchPacked = s.match(/^(\d{1,2})([A-Za-z]{3,})(\d{4})$/);
            if (matchPacked) {
                day = matchPacked[1];
                month = matchPacked[2];
                year = matchPacked[3];
            }
        }
    }

    if (year && month && day) {
        // Normalize month if it is text
        if (isNaN(parseInt(month))) {
            const months = {
                'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
                'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
            };
            const mLower = month.substring(0, 3).toLowerCase();
            if (months[mLower]) {
                month = months[mLower];
            } else {
                return ''; // Invalid month name
            }
        }

        // Pad numbers
        month = String(month).padStart(2, '0');
        day = String(day).padStart(2, '0');

        if (isValidDate(year, month, day)) {
            return `${year}-${month}-${day}`;
        }
    }

    // REJECT anything else. Do not use new Date(s) fallback.
    return '';
};

export const isValidLandline = (landline) => {
    if (!landline) return false;
    const digits = landline.replace(REGEX_PATTERNS.digitOnly, '');
    return digits.length >= 10;
};

export const fixJumbledMobile = (rawMobile) => {
    if (!rawMobile) return '';
    const clean = rawMobile.replace(/\s+/g, '');
    if (/^04\d{8}$/.test(clean)) return clean;

    const match = rawMobile.match(/(04\d{2})/);
    if (match) {
        const prefix = match[1];
        const parts = rawMobile.split(prefix);
        if (parts.length >= 2) {
            const before = parts[0].replace(/\D/g, '');
            const after = parts.slice(1).join('').replace(/\D/g, '');
            const rotated = prefix + after + before;
            if (/^04\d{8}$/.test(rotated)) return rotated;
        }
    }
    return clean.replace(/\D/g, '');
};

export const fixJumbledLandline = (rawLandline) => {
    if (!rawLandline) return '';
    const s = rawLandline.trim();
    const parts = s.split(/\s+/);
    if (parts.length === 3) {
        const last = parts[2];
        if (/^(0[2378])$/.test(last)) {
            return parts.reverse().join(' ');
        }
    }
    return s.replace(/\D/g, '');
};
export const validateRecords = (records) => {
    const cleanRecords = [];
    const rejectedRecords = [];

    for (const record of records) {
        const rawFirst = String(record.first_name || '').trim();
        const rawLast = String(record.last_name || '').trim();
        const rawDob = String(record.dateofbirth || '').trim();
        const rawLastseen = String(record.lastseen || '').trim();

        const firstName = cleanName(rawFirst);
        const lastName = cleanName(rawLast);

        const mobile = String(record.mobile || '').trim();
        let address = String(record.address || '').trim();
        const email = String(record.email || '').trim();
        const rawLandline = String(record.landline || '').trim();

        address = fixAddressOrdering(address);

        const dateofbirth = normalizeDateField(rawDob);
        const lastseen = normalizeDateField(rawLastseen);

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
                rejection_reason: 'Invalid name'
            });
            continue;
        }

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

    return { validRecords: cleanRecords, rejectedRecords };
};
