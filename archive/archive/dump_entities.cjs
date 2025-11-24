const fs = require('fs');

try {
    const entities = JSON.parse(fs.readFileSync('debug_entities.json', 'utf8'));

    // Sort by Y
    entities.sort((a, b) => a.minY - b.minY);

    const lines = entities.map(e => `Y: ${e.minY.toFixed(4)}-${e.maxY.toFixed(4)} | Type: ${e.type.padEnd(12)} | Value: ${e.value}`);

    fs.writeFileSync('all_entities.txt', lines.join('\n'));
    console.log(`Dumped ${entities.length} entities to all_entities.txt`);

} catch (e) {
    console.error(e);
}
