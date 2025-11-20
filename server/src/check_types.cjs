const fs = require('fs');

try {
    const entities = JSON.parse(fs.readFileSync('debug_entities.json', 'utf8'));

    const types = [...new Set(entities.map(e => e.type))];
    console.log('Entity types:', types);

    const mobiles = entities.filter(e => e.type === 'mobile');
    console.log('Total mobile entities:', mobiles.length);

    if (mobiles.length > 0) {
        console.log('First 5 mobiles:');
        mobiles.slice(0, 5).forEach(e => console.log(`Value: ${e.value}, Y: ${e.minY.toFixed(4)}-${e.maxY.toFixed(4)}`));
    }

} catch (e) {
    console.error(e);
}
