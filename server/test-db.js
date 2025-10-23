// server/test-db.js
import { initializeDatabase } from './src/models/database.js';

console.log('🧪 Testing database connection...');

try {
  await initializeDatabase();
  console.log('✅ Database connection successful!');
  console.log('✅ Tables created successfully!');
  process.exit(0);
} catch (error) {
  console.error('❌ Database connection failed:', error.message);
  process.exit(1);
}
