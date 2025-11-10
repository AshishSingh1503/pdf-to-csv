// Test routes for Document AI
import express from 'express';
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.get('/document-ai', async (req, res) => {
  try {
  logger.info('Testing Document AI configuration...');
    
    // Check environment variables
    const envVars = {
      PROJECT_ID: process.env.PROJECT_ID,
      LOCATION: process.env.LOCATION,
      PROCESSOR_ID: process.env.PROCESSOR_ID,
      NODE_ENV: process.env.NODE_ENV,
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS
    };
    
  logger.debug('Environment Variables:', envVars);
    
    // Initialize client
    const clientConfig = process.env.NODE_ENV === 'production' ? {} : { keyFilename: config.credentials };
    const client = new DocumentProcessorServiceClient(clientConfig);
  logger.info('Document AI client initialized');
    
    // Test processor access
    const processorName = `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`;
  logger.debug('Processor Name:', processorName);
    
    try {
      const [processor] = await client.getProcessor({ name: processorName });
  logger.info('Processor accessible:', processor.displayName);
      
      res.json({
        success: true,
        message: 'Document AI is properly configured',
        config: {
          projectId: config.projectId,
          location: config.location,
          processorId: config.processorId,
          processorName: processor.displayName,
          processorType: processor.type,
          processorState: processor.state
        }
      });
    } catch (error) {
  logger.error('Cannot access processor:', error.message);
      res.status(500).json({
        success: false,
        error: 'Cannot access Document AI processor',
        details: error.message,
        config: envVars
      });
    }
    
    } catch (error) {
    logger.error('Document AI test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Document AI initialization failed',
      details: error.message
    });
  }
});

export default router;