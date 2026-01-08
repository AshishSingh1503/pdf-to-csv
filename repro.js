import { fixAddressOrdering } from './server/src/utils/validators.js';

const cases = [
    "Unit 1004 24 Litchfield Street DARWIN CITY NT 0800",
    "Unit 2303 43-45 Knuckey Street DARWIN CITY NT 0800"
];

console.log("--- Address Validation Reproduction ---");
cases.forEach(addr => {
    console.log(`Original: ${addr}`);
    console.log(`Fixed:    ${fixAddressOrdering(addr)}`);
    console.log("---------------------------------------");
});
