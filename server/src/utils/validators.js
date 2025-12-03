export const REGEX_PATTERNS = {
    addressStatePostcodeStart: /^\s*([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i,
    addressPostcodeStateEnd: /^\s*(\d{4})\s+(.+?)\s+([A-Za-z]{2,3})\s*$/i,
    addressStatePostcodeMiddle: /^(.+?)\s+([A-Za-z]{2,3})\s+(\d{4})\s+(.+)$/i,
    addressStatePostcodeAny: /([A-Za-z]{2,3})\s+(\d{4})/i,
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
    s = s.replace(REGEX_PATTERNS.dashNormalize, '-');
    s = s.replace(REGEX_PATTERNS.dashMultiple, '-');
    s = s.replace(REGEX_PATTERNS.dashTrim, '');
    s = s.replace(REGEX_PATTERNS.dateInvalidChars, '');
    s = s.replace(/\./g, '-');

    // Handle various date formats
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

    const match = s.match(REGEX_PATTERNS.dateFormat);
    if (match) {
        s = `${match[1]}-${match[2]}-${match[3]}`;
    }

    try {
        const dt = new Date(s);
        if (isNaN(dt.getTime())) return '';
        const year = dt.getFullYear();
        if (year < 1900 || year > 2025) return '';
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return '';
    }
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
