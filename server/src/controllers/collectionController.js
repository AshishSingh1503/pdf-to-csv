// server/src/controllers/collectionController.js
// import { Collection } from '../models/Collection.js';
import { Collection } from '../models/Collection.js';
// Get all collections
export const getAllCollections = async (req, res) => {
  try {
    const { customerId } = req.query;
    const collections = await Collection.findAll(customerId);
    res.json({ success: true, data: collections });
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch collections' });
  }
};

// Get collection by ID
export const getCollectionById = async (req, res) => {
  try {
    const { id } = req.params;
    const collection = await Collection.findById(id);
    
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    
    const stats = await collection.getStats();
    res.json({ success: true, data: { ...collection, stats } });
  } catch (error) {
    console.error('Error fetching collection:', error);
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
      
      res.status(201).json({ success: true, data: collection });
    } catch (dbError) {
      if (dbError.code === '23505') { // Unique violation
        return res.status(409).json({ success: false, error: 'A collection with this name already exists.' });
      }
      throw dbError; // Re-throw other errors
    }
  } catch (error) {
    console.error('Error creating collection:', error);
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
    
    res.json({ success: true, data: updatedCollection });
  } catch (error) {
    console.error('Error updating collection:', error);
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
    
    res.json({ success: true, data: archivedCollection });
  } catch (error) {
    console.error('Error archiving collection:', error);
    res.status(500).json({ success: false, error: 'Failed to archive collection' });
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
    
    res.json({ success: true, message: 'Collection deleted successfully' });
  } catch (error) {
    console.error('Error deleting collection:', error);
    res.status(500).json({ success: false, error: 'Failed to delete collection' });
  }
};
