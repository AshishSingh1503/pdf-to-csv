// Test Document AI configuration
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

const testDocumentAI = async () => {
  try {
    console.log('🔍 Testing Document AI configuration...');
    
    // Environment variables
    console.log('Environment Variables:');
    console.log('- PROJECT_ID:', process.env.PROJECT_ID);
    console.log('- LOCATION:', process.env.LOCATION);
    console.log('- PROCESSOR_ID:', process.env.PROCESSOR_ID);
    console.log('- NODE_ENV:', process.env.NODE_ENV);
    
    // Initialize client
    const clientConfig = process.env.NODE_ENV === 'production' ? {} : { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS };
    const client = new DocumentProcessorServiceClient(clientConfig);
    console.log('✅ Document AI client initialized');
    
    // Test processor access
    const processorName = `projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/processors/${process.env.PROCESSOR_ID}`;
    console.log('📋 Processor Name:', processorName);
    
    // Try to get processor info
    try {
      const [processor] = await client.getProcessor({ name: processorName });
      console.log('✅ Processor accessible:', processor.displayName);
      console.log('📊 Processor Type:', processor.type);
      console.log('🔄 Processor State:', processor.state);
    } catch (error) {
      console.error('❌ Cannot access processor:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Document AI test failed:', error);
  }
};

testDocumentAI();