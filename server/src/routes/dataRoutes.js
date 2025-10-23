// server/src/routes/dataRoutes.js
import express from 'express';
import {
  getPreProcessData,
  getPostProcessData,
  searchData,
  getCollectionStats
} from '../controllers/dataController.js';

const router = express.Router();

// Data routes
router.get('/pre-process', getPreProcessData);
router.get('/post-process', getPostProcessData);
router.get('/search', searchData);
router.get('/collections/:collectionId/stats', getCollectionStats);

export default router;
