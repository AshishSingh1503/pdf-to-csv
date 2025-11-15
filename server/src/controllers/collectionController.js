// server/src/controllers/collectionController.js
// import { Collection } from '../models/Collection.js';
import { Collection } from '../models/Collection.js';
import logger from '../utils/logger.js';
import cache from '../services/cache.js';
const { KEYS } = cache;
// Get all collections
export const getAllCollections = async (req, res) => {
  try {
    const { customerId, status } = req.query;
    const cacheKey = KEYS.COLLECTIONS_ALL(customerId, status);
    const collections = await cache.getOrSet(cacheKey, async () => {
      return await Collection.findAll(customerId, status);
    });
    res.json({ success: true, data: collections });
  } catch (error) {
    logger.error('Error fetching collections', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to fetch collections' });
  }
};

// Get collection by ID
export const getCollectionById = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = KEYS.COLLECTION_BY_ID(id);
    const collection = await cache.getOrSet(cacheKey, async () => {
      return await Collection.findById(id);
    });

    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    const stats = await cache.getOrSet(KEYS.COLLECTION_STATS(id), async () => collection.getStats(), 60);
    res.json({ success: true, data: { ...collection, stats } });
  } catch (error) {
    logger.error('Error fetching collection', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to fetch collection' });
  }
};

// Create new collection
export const createCollection = async (req, res) => {
  try {
    const { name, description, customer_id } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Collection name is required' });
    }
    
    if (!customer_id) {
      return res.status(400).json({ success: false, error: 'Customer ID is required' });
    }
    
    // Check if collection name already exists
    const nameExists = await Collection.nameExists(name.trim());
    if (nameExists) {
      return res.status(400).json({ success: false, error: 'Collection name already exists' });
    }
    
    try {
      const collection = await Collection.create({
        name: name.trim(),
        description: description?.trim() || '',
        customer_id,
      });
    // invalidate relevant caches
    cache.del(KEYS.COLLECTIONS_ALL(customer_id, 'active'));
    cache.del(KEYS.COLLECTIONS_ALL(customer_id, 'archived'));
    cache.del(KEYS.COLLECTIONS_ALL(customer_id, 'all'));
    // also clear global aggregated list to avoid stale global views
    cache.del(KEYS.COLLECTIONS_ALL_GLOBAL);
      res.status(201).json({ success: true, data: collection });
    } catch (dbError) {
      if (dbError.code === '23505') { // Unique violation
        return res.status(409).json({ success: false, error: 'A collection with this name already exists.' });
      }
      throw dbError; // Re-throw other errors
    }
  } catch (error) {
    logger.error('Error creating collection', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to create collection' });
  }
};

// Update collection
export const updateCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    const collection = await Collection.findById(id);
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Collection name is required' });
    }
    
    // Check if collection name already exists (excluding current collection)
    const nameExists = await Collection.nameExists(name.trim(), id);
    if (nameExists) {
      return res.status(400).json({ success: false, error: 'Collection name already exists' });
    }
    
    const updatedCollection = await collection.update({
      name: name.trim(),
      description: description?.trim() || ''
    });
    
    if (!updatedCollection) {
      return res.status(500).json({ success: false, error: 'Failed to update collection' });
    }
    
    // invalidate caches for this collection and for the list
  cache.del(KEYS.COLLECTION_BY_ID(id));
  cache.del(KEYS.COLLECTION_STATS(id));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'active'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'archived'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'all'));
  cache.del(KEYS.COLLECTIONS_ALL_GLOBAL);
    res.json({ success: true, data: updatedCollection });
  } catch (error) {
    logger.error('Error updating collection', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to update collection' });
  }
};

// Archive collection (soft delete)
export const archiveCollection = async (req, res) => {
  try {
    const { id } = req.params;
    
    const collection = await Collection.findById(id);
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    
    const archivedCollection = await collection.archive();
    if (!archivedCollection) {
      return res.status(500).json({ success: false, error: 'Failed to archive collection' });
    }
  cache.del(KEYS.COLLECTION_BY_ID(id));
  cache.del(KEYS.COLLECTION_STATS(id));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'active'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'archived'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'all'));
  cache.del(KEYS.COLLECTIONS_ALL_GLOBAL);
    res.json({ success: true, data: archivedCollection });
  } catch (error) {
    logger.error('Error archiving collection', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to archive collection' });
  }
};

// Unarchive collection
export const unarchiveCollection = async (req, res) => {
  try {
    const { id } = req.params;
    
    const collection = await Collection.findById(id, 'archived'); // Find in archived
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Archived collection not found' });
    }
    
    const unarchivedCollection = await collection.unarchive();
    if (!unarchivedCollection) {
      return res.status(500).json({ success: false, error: 'Failed to unarchive collection' });
    }
  cache.del(KEYS.COLLECTION_BY_ID(id));
  cache.del(KEYS.COLLECTION_STATS(id));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'active'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'archived'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'all'));
  cache.del(KEYS.COLLECTIONS_ALL_GLOBAL);
    res.json({ success: true, data: unarchivedCollection });
  } catch (error) {
    logger.error('Error unarchiving collection', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to unarchive collection' });
  }
};

// Delete collection (hard delete)
export const deleteCollection = async (req, res) => {
  try {
    const { id } = req.params;
    
    const collection = await Collection.findById(id);
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    
    const deleted = await collection.delete();
    if (!deleted) {
      return res.status(500).json({ success: false, error: 'Failed to delete collection' });
    }
  cache.del(KEYS.COLLECTION_BY_ID(id));
  cache.del(KEYS.COLLECTION_STATS(id));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'active'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'archived'));
  cache.del(KEYS.COLLECTIONS_ALL(collection.customer_id, 'all'));
  cache.del(KEYS.COLLECTIONS_ALL_GLOBAL);
    res.json({ success: true, message: 'Collection deleted successfully' });
  } catch (error) {
    logger.error('Error deleting collection', { error: error?.message, stack: error?.stack });
    res.status(500).json({ success: false, error: 'Failed to delete collection' });
  }
};
