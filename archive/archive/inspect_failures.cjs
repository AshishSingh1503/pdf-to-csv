const fs = require('fs');

try {
    const records = JSON.parse(fs.readFileSync('debug_records.json', 'utf8'));
    console.log('Total records:', records.length);

    let failureCount = 0;
    records.forEach((r, i) => {
        const keys = ['first_name', 'last_name', 'mobile', 'email', 'address', 'landline', 'dateofbirth', 'lastseen'];
        const missing = keys.filter(k => !r[k]);

        // Only print if there are missing fields
        if (missing.length > 0) {
            failureCount++;
            console.log(`\nRecord ${i + 1} missing: ${missing.join(', ')}`);
            console.log(`Debug: ${r._debug_row_entities}`);
        }
    });

    console.log(`\nTotal failures: ${failureCount}`);

} catch (e) {
    console.error(e);
}
