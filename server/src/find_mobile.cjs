const fs = require('fs');

try {
    const entities = JSON.parse(fs.readFileSync('debug_entities.json', 'utf8'));

    const targetY = 0.549;
    const tolerance = 0.02; // Look within +/- 0.02

    console.log(`Searching for entities near Y=${targetY} (+/- ${tolerance})...`);

    const nearby = entities.filter(e =>
        e.minY >= targetY - tolerance &&
        e.minY <= targetY + tolerance
    );

    console.log(`Found ${nearby.length} entities:`);
    nearby.forEach(e => {
        console.log(`Type: ${e.type}, Value: ${e.value}, Y: ${e.minY.toFixed(4)}-${e.maxY.toFixed(4)}`);
    });

} catch (e) {
    console.error(e);
}
