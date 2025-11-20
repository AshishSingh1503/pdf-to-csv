import fs from 'fs';
import path from 'path';

const debugFilePath = 'C:\\projects\\pdf2csv\\pdf-to-csv\\server\\debug_output\\docai-raw-Page_1.pdf-1763660867856.json';

// --- COPIED LOGIC FROM documentProcessor.js ---

const extractEntitiesSimple = (document) => {
    const raw = document.entities || [];
    return raw.map((entity, idx) => {
        // normalize type and text value
        const type = (entity.type || '').toLowerCase().trim();
        const value = String(entity.mentionText || entity.text || '').trim();

        // Attempt to pull startIndex / endIndex from textAnchor.textSegments
        let startIndex = undefined;
        let endIndex = undefined;
        try {
            const ta = entity.textAnchor || {};
            const segs = ta.textSegments || (ta.textSegments === 0 ? [] : ta.textSegments);
            if (Array.isArray(segs) && segs.length > 0) {
                // textSegments usually contains objects with startIndex/endIndex (strings or numbers)
                const seg = segs[0];
                // Some SDKs return strings for int64 — coerce to Number if possible
                startIndex = seg.startIndex !== undefined ? Number(seg.startIndex) : undefined;
                endIndex = seg.endIndex !== undefined ? Number(seg.endIndex) : undefined;
            }
        } catch (e) {
            // non-fatal — we'll fallback to order index below
        }

        // --- NEW: Extract Bounding Box Coordinates ---
        let midY = null;
        let midX = null;
        let minY = null;
        let maxY = null;
        try {
            const vertices = entity.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices;
            if (vertices && vertices.length >= 4) {
                const ys = vertices.map(v => v.y || 0);
                const xs = vertices.map(v => v.x || 0);
                minY = Math.min(...ys);
                maxY = Math.max(...ys);
                const minX = Math.min(...xs);
                midY = (minY + maxY) / 2;
                midX = minX;
            }
        } catch (e) {
            // non-fatal
        }


        return {
            type,
            value,
            // if startIndex is NaN or undefined, set to null so we can detect missing anchors
            startIndex: Number.isFinite(startIndex) ? startIndex : null,
            endIndex: Number.isFinite(endIndex) ? endIndex : null,
            midY,
            midX,
            minY,
            maxY,
            // keep original raw entity for debugging if needed
            // __raw: entity, // Commented out to save space in debug output
            __order: idx
        };
    }).filter(e => e.value); // drop empties
};

// Mock parseFullName for simpleGrouping
const parseFullName = (fullName) => {
    const parts = fullName.trim().split(/\s+/);
    return {
        first: parts[0] || '',
        last: parts.slice(1).join(' ') || ''
    };
};

// --- NEW: Entity Deduplication ---
const deduplicateEntities = (entities) => {
    // Sort by type then minY
    const sorted = [...entities].sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.minY - b.minY;
    });

    const result = [];

    for (const entity of sorted) {
        if (result.length === 0) {
            result.push(entity);
            continue;
        }

        const prev = result[result.length - 1];

        // Check if same type
        if (prev.type === entity.type) {
            // Check vertical overlap or proximity
            const prevHeight = prev.maxY - prev.minY;
            const currHeight = entity.maxY - entity.minY;

            // If they overlap or are very close (gap < 20% of height)
            const gap = Math.max(0, entity.minY - prev.maxY);
            const isClose = gap < 0.2 * Math.min(prevHeight, currHeight);
            const isOverlapping = entity.minY < prev.maxY;

            if (isClose || isOverlapping) {
                // Check value similarity (exact match or substring)
                const val1 = prev.value.toLowerCase().replace(/\s+/g, '');
                const val2 = entity.value.toLowerCase().replace(/\s+/g, '');

                if (val1.includes(val2) || val2.includes(val1)) {
                    // MERGE
                    // Keep the one with longer value (or prev if equal)
                    if (entity.value.length > prev.value.length) {
                        prev.value = entity.value;
                    }
                    // Expand bounds
                    prev.minY = Math.min(prev.minY, entity.minY);
                    prev.maxY = Math.max(prev.maxY, entity.maxY);
                    prev.midY = (prev.minY + prev.maxY) / 2;
                    prev.midX = Math.min(prev.midX, entity.midX); // simplified
                    // Skip adding 'entity' to result
                    continue;
                }
            }
        }

        result.push(entity);
    }
    return result;
};

const simpleGrouping = (entities) => {
    if (!Array.isArray(entities) || entities.length === 0) return [];

    // Apply deduplication first
    const dedupedEntities = deduplicateEntities(entities);
    console.log(`Deduplicated entities: ${entities.length} -> ${dedupedEntities.length}`);

    const pureStartIndexGrouping = (entitySubset) => {
        // This is the original fallback logic, to be used when coordinate data is insufficient
        const sorted = [...entitySubset].sort((a, b) => (a.startIndex ?? a.__order) - (b.startIndex ?? b.__order));
        const nameEntities = sorted.filter(e => e.type === 'name');
        const records = [];


        for (let i = 0; i < nameEntities.length; i++) {
            const nameEnt = nameEntities[i];
            const nextName = nameEntities[i + 1];
            const nameStart = nameEnt.startIndex ?? nameEnt.__order;
            const boundary = nextName?.startIndex ?? Number.MAX_SAFE_INTEGER;
            const slice = sorted.filter(e => (e.startIndex ?? e.__order) >= nameStart && (e.startIndex ?? e.__order) < boundary);


            const record = {};
            const { first, last } = parseFullName(nameEnt.value);
            record.first_name = first;
            record.last_name = last;


            const getFirst = (type) => slice.find(s => s.type === type)?.value;
            record.mobile = getFirst('mobile');
            record.address = getFirst('address');
            record.email = getFirst('email');
            record.dateofbirth = getFirst('dateofbirth');
            record.landline = getFirst('landline');
            record.lastseen = getFirst('lastseen');
            records.push(record);
        }
        return records;
    };


    const withCoords = dedupedEntities.filter(e => e.minY != null && e.maxY != null);
    const withoutCoords = dedupedEntities.filter(e => e.minY == null || e.maxY == null);


    if (withCoords.length / dedupedEntities.length < 0.5) {
        console.log('Insufficient coordinate data. Using pure startIndex grouping.');
        return pureStartIndexGrouping(dedupedEntities);
    }
    console.log('Using overlap-based coordinate grouping.');


    // --- NEW: Overlap-Based Grouping Logic ---
    // 1. Sort by Y coordinate (top to bottom)
    const sortedWithCoords = withCoords.sort((a, b) => a.minY - b.minY);
    const rows = [];

    for (const entity of sortedWithCoords) {
        let placed = false;

        // Try to fit into an existing row
        for (const row of rows) {
            // Calculate row bounds
            const rowMinY = Math.min(...row.map(e => e.minY));
            const rowMaxY = Math.max(...row.map(e => e.maxY));
            const rowHeight = rowMaxY - rowMinY;

            // Entity bounds
            const entHeight = entity.maxY - entity.minY;

            // Calculate overlap
            const intersectionStart = Math.max(rowMinY, entity.minY);
            const intersectionEnd = Math.min(rowMaxY, entity.maxY);
            const intersectionHeight = Math.max(0, intersectionEnd - intersectionStart);

            // Overlap threshold: 30% of the smaller height
            const minHeight = Math.min(rowHeight, entHeight);

            // If we have significant overlap, add to row
            if (intersectionHeight > 0.3 * minHeight) {
                row.push(entity);
                placed = true;
                break;
            }
        }

        // If not placed, start a new row
        if (!placed) {
            rows.push([entity]);
        }
    }

    // 2. Create a map of row boundaries based on startIndex (for unslotted fallback)
    const rowBoundaries = rows.map(row => {
        const indices = row.map(e => e.startIndex).filter(idx => idx !== null);
        return {
            row,
            minIdx: Math.min(...indices, Number.MAX_SAFE_INTEGER),
            maxIdx: Math.max(...indices, -1),
        };
    });


    // 3. Slot entities without coordinates into the coordinate-based rows
    const unslotted = [];
    for (const entity of withoutCoords) {
        if (entity.startIndex === null) {
            unslotted.push(entity);
            continue;
        }
        const targetRow = rowBoundaries.find(b => entity.startIndex >= b.minIdx && entity.startIndex <= b.maxIdx);
        if (targetRow) {
            targetRow.row.push(entity);
        } else {
            unslotted.push(entity);
        }
    }


    // 4. Build records from the completed coordinate-based rows
    const coordRecords = rows.map(row => {
        row.sort((a, b) => (a.midX ?? a.startIndex ?? a.__order) - (b.midX ?? b.startIndex ?? b.__order));
        const record = {};
        const nameEntity = row.find(e => e.type === 'name');
        if (nameEntity) {
            const { first, last } = parseFullName(nameEntity.value);
            record.first_name = first;
            record.last_name = last;
        }
        const getFirst = (type) => row.find(e => e.type === type)?.value;
        record.mobile = getFirst('mobile');
        record.address = getFirst('address');
        record.email = getFirst('email');
        record.dateofbirth = getFirst('dateofbirth');
        record.landline = getFirst('landline');
        record.lastseen = getFirst('lastseen');

        // Add debug info
        record._debug_row_entities = row.map(e => `${e.type}:${e.value} (y:${e.minY.toFixed(3)}-${e.maxY.toFixed(3)})`).join(' | ');

        return record;
    });


    // 5. Process any remaining unslotted entities using the original fallback logic
    const fallbackRecords = pureStartIndexGrouping(unslotted);


    // 6. Filter out records without a name (likely artifacts/orphans)
    const validRecords = [...coordRecords, ...fallbackRecords].filter(r => r.first_name || r.last_name);

    console.log(`Filtered ${[...coordRecords, ...fallbackRecords].length - validRecords.length} records without names.`);

    return validRecords;
};

// --- MAIN EXECUTION ---

try {
    console.log(`Reading file: ${debugFilePath}`);
    const rawData = fs.readFileSync(debugFilePath, 'utf8');
    const document = JSON.parse(rawData);

    console.log('Extracting entities...');
    const entities = extractEntitiesSimple(document);
    console.log(`Extracted ${entities.length} entities.`);

    // Save simplified entities for inspection
    fs.writeFileSync('debug_entities.json', JSON.stringify(entities, null, 2));
    console.log('Saved simplified entities to debug_entities.json');

    console.log('Running simpleGrouping...');
    const records = simpleGrouping(entities);

    console.log(`Generated ${records.length} records.`);
    fs.writeFileSync('debug_records.json', JSON.stringify(records, null, 2));
    console.log('Saved records to debug_records.json');

    // --- ANALYSIS ---
    console.log('\n--- ANALYSIS REPORT ---');
    console.log('Total records:', records.length);
    records.forEach((r, i) => {
        const keys = ['first_name', 'last_name', 'mobile', 'email', 'address', 'landline', 'dateofbirth', 'lastseen'];
        const missing = keys.filter(k => !r[k]);
        if (missing.length > 0) {
            console.log(`Record ${i + 1} missing: ${missing.join(', ')}`);
            console.log(`  Debug: ${r._debug_row_entities}`);
        }
    });

} catch (error) {
    console.error('Error:', error);
}
