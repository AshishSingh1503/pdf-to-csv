const fs = require('fs');

try {
    const records = JSON.parse(fs.readFileSync('debug_records.json', 'utf8'));

    console.log('Searching for sparse records (< 3 fields)...');

    records.forEach((r, i) => {
        const keys = ['first_name', 'last_name', 'mobile', 'email', 'address', 'landline', 'dateofbirth', 'lastseen'];
        const filled = keys.filter(k => r[k]);

        if (filled.length < 3) {
            console.log(`\nRecord ${i + 1} has only ${filled.length} fields: ${filled.join(', ')}`);
            console.log(`Debug: ${r._debug_row_entities}`);
        }
    });

} catch (e) {
    console.error(e);
}
