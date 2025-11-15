// server/src/routes/collectionRoutes.js
import express from 'express';
import {
  getAllCollections,
  getCollectionById,
  createCollection,
  updateCollection,
  archiveCollection,
  unarchiveCollection,
  deleteCollection
} from '../controllers/collectionController.js';

const router = express.Router();

// Collection routes
router.get('/', getAllCollections);
router.get('/:id', getCollectionById);
router.post('/', createCollection);
router.put('/:id', updateCollection);
router.patch('/:id/archive', archiveCollection);
router.patch('/:id/unarchive', unarchiveCollection);
router.delete('/:id', deleteCollection);

export default router;
