
const filteredRecordsRaw = [
    { mobile: '0412345678', first_name: 'John', last_name: 'Doe', address: '', email: 'john@example.com' },
    { mobile: '0412345678', first_name: 'John', last_name: 'Doe', address: '123 Main St', email: '' },
    { mobile: '0487654321', first_name: 'Jane', last_name: 'Smith', address: '', email: '' },
    { mobile: '0487654321', first_name: 'Jane', last_name: 'Smith', address: '', email: 'jane@example.com' },
    { mobile: '0411111111', first_name: 'Bob', last_name: 'Brown', address: '456 High St', email: 'bob@example.com' },
];

// Deduplication Logic:
// 1. Group by mobile number
const mobileGroups = new Map();
const records = filteredRecordsRaw || [];

for (const record of records) {
    if (!record.mobile) continue; // Should be filtered already, but safety check
    if (!mobileGroups.has(record.mobile)) {
        mobileGroups.set(record.mobile, []);
    }
    mobileGroups.get(record.mobile).push(record);
}

const uniqueRecords = [];
const duplicateRejected = [];

// Helper to count populated fields
const countPopulatedFields = (r) => {
    let count = 0;
    if (r.first_name) count++;
    if (r.last_name) count++;
    if (r.dateofbirth) count++;
    if (r.address) count++;
    if (r.email) count++;
    if (r.landline) count++;
    if (r.lastseen) count++;
    return count;
};

for (const [mobile, group] of mobileGroups) {
    if (group.length === 1) {
        uniqueRecords.push(group[0]);
    } else {
        // Find best record
        // Priority 1: Has Address
        const withAddress = group.filter(r => r.address && r.address.length > 5);

        let candidates = withAddress.length > 0 ? withAddress : group;

        // Priority 2: Most populated fields
        candidates.sort((a, b) => countPopulatedFields(b) - countPopulatedFields(a));

        const winner = candidates[0];
        uniqueRecords.push(winner);

        // Mark others as duplicates
        for (const record of group) {
            if (record !== winner) {
                duplicateRejected.push({
                    ...record,
                    rejection_reason: 'Duplicate mobile number'
                });
            }
        }
    }
}

console.log('Unique Records:', JSON.stringify(uniqueRecords, null, 2));
console.log('Rejected Records:', JSON.stringify(duplicateRejected, null, 2));

// Assertions
if (uniqueRecords.length !== 3) {
    console.error('FAILED: Expected 3 unique records, got ' + uniqueRecords.length);
    process.exit(1);
}

const john = uniqueRecords.find(r => r.mobile === '0412345678');
if (!john || john.address !== '123 Main St') {
    console.error('FAILED: John should have address');
    process.exit(1);
}

const jane = uniqueRecords.find(r => r.mobile === '0487654321');
if (!jane || jane.email !== 'jane@example.com') {
    console.error('FAILED: Jane should have email (most populated)');
    process.exit(1);
}

console.log('SUCCESS: All tests passed');
