
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
console.log('Resolved Path:', path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS || ''));
