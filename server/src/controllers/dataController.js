// server/src/controllers/dataController.js
import { PreProcessRecord } from '../models/PreProcessRecord.js';
import { PostProcessRecord } from '../models/PostProcessRecord.js';
import { Collection } from '../models/Collection.js';

// Get pre-process data
export const getPreProcessData = async (req, res) => {
  try {
    const { collectionId, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    let records;
    let totalCount;
    
    if (search) {
      records = await PreProcessRecord.search(search, collectionId, parseInt(limit), offset);
      totalCount = records.length; // For search, we'll get all results and count them
    } else {
      records = await PreProcessRecord.findAll(collectionId, parseInt(limit), offset);
      totalCount = await PreProcessRecord.count(collectionId);
    }
    
    // Format data for frontend
    const formattedRecords = records.map(record => ({
      id: record.id,
      full_name: record.full_name,
      dob: record.dateofbirth,
      address: record.address,
      mobile: record.mobile,
      email: record.email,
      seen: record.lastseen,
      source: record.file_name,
      created_at: record.created_at
    }));
    
    res.json({
      success: true,
      data: formattedRecords,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching pre-process data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pre-process data' });
  }
};

// Get post-process data
export const getPostProcessData = async (req, res) => {
  try {
    const { collectionId, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    let records;
    let totalCount;
    
    if (search) {
      records = await PostProcessRecord.search(search, collectionId, parseInt(limit), offset);
      totalCount = records.length; // For search, we'll get all results and count them
    } else {
      records = await PostProcessRecord.findAll(collectionId, parseInt(limit), offset);
      totalCount = await PostProcessRecord.count(collectionId);
    }
    
    // Format data for frontend
    const formattedRecords = records.map(record => ({
      id: record.id,
      first: record.first_name,
      last: record.last_name,
      dob: record.dateofbirth,
      address: record.address,
      mobile: record.mobile,
      email: record.email,
      seen: record.lastseen,
      source: record.file_name,
      created_at: record.created_at
    }));
    
    res.json({
      success: true,
      data: formattedRecords,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching post-process data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch post-process data' });
  }
};

// Search data across both pre and post process
export const searchData = async (req, res) => {
  try {
    const { query: searchTerm, collectionId, type = 'both', page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    if (!searchTerm || searchTerm.trim() === '') {
      return res.status(400).json({ success: false, error: 'Search term is required' });
    }
    
    const results = {};
    let totalCount = 0;
    
    if (type === 'both' || type === 'pre') {
      const preRecords = await PreProcessRecord.search(searchTerm, collectionId, parseInt(limit), offset);
      results.preProcess = preRecords.map(record => ({
        id: record.id,
        full_name: record.full_name,
        dob: record.dateofbirth,
        address: record.address,
        mobile: record.mobile,
        email: record.email,
        seen: record.lastseen,
        source: record.file_name,
        created_at: record.created_at
      }));
      totalCount += await PreProcessRecord.count(collectionId, searchTerm);
    }
    
    if (type === 'both' || type === 'post') {
      const postRecords = await PostProcessRecord.search(searchTerm, collectionId, parseInt(limit), offset);
      results.postProcess = postRecords.map(record => ({
        id: record.id,
        first: record.first_name,
        last: record.last_name,
        dob: record.dateofbirth,
        address: record.address,
        mobile: record.mobile,
        email: record.email,
        seen: record.lastseen,
        source: record.file_name,
        created_at: record.created_at
      }));
      totalCount += await PostProcessRecord.count(collectionId, searchTerm);
    }
    
    res.json({
      success: true,
      data: results,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error searching data:', error);
    res.status(500).json({ success: false, error: 'Failed to search data' });
  }
};

// Get collection statistics
export const getCollectionStats = async (req, res) => {
  try {
    const { collectionId } = req.params;
    
    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }
    
    const stats = await collection.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching collection stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch collection statistics' });
  }
};
