// server/test-db.js
import { initializeDatabase } from './src/models/database.js';
import logger from './src/utils/logger.js';

logger.info('🧪 Testing database connection...');

try {
  await initializeDatabase();
  logger.info('✅ Database connection successful!');
  logger.info('✅ Tables created successfully!');
  process.exit(0);
} catch (error) {
  logger.error('❌ Database connection failed: %s', error.message);
  process.exit(1);
}
