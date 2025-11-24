
import { processPDFs } from './services/documentProcessor.js';
import logger from './utils/logger.js';

console.log('Successfully imported processPDFs');
if (typeof processPDFs === 'function') {
    console.log('processPDFs is a function');
} else {
    console.error('processPDFs is NOT a function');
}
