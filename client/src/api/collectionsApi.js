import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : "http://localhost:5000/api";

// Collections API
export const collectionsApi = {
  // Get all collections
  getAll: async (customerId = null, status = 'active') => {
    const params = new URLSearchParams();
    if (customerId) params.append('customerId', customerId);
    if (status) params.append('status', status);
    const { data } = await axios.get(`${BASE_URL}/collections`, { params });
    return data;
  },

  // Get collection by ID
  getById: async (id) => {
    const { data } = await axios.get(`${BASE_URL}/collections/${id}`);
    return data;
  },

  // Create new collection
  create: async (collectionData) => {
    const { data } = await axios.post(`${BASE_URL}/collections`, collectionData);
    return data;
  },

  // Update collection
  update: async (id, collectionData) => {
    const { data } = await axios.put(`${BASE_URL}/collections/${id}`, collectionData);
    return data;
  },

  // Archive collection
  archive: async (id) => {
    const { data } = await axios.patch(`${BASE_URL}/collections/${id}/archive`);
    return data;
  },

  // Unarchive collection
  unarchive: async (id) => {
    const { data } = await axios.patch(`${BASE_URL}/collections/${id}/unarchive`);
    return data;
  },

  // Delete collection
  delete: async (id) => {
    const { data } = await axios.delete(`${BASE_URL}/collections/${id}`);
    return data;
  }
};

// Data API
export const dataApi = {
  // Get pre-process data
  getPreProcess: async (collectionId = null, search = null, page = 1, limit = 50) => {
    const params = new URLSearchParams();
    if (collectionId) params.append('collectionId', collectionId);
    if (search) params.append('search', search);
    params.append('page', page);
    params.append('limit', limit);
    
    const { data } = await axios.get(`${BASE_URL}/data/pre-process?${params}`);
    return data;
  },

  // Get post-process data
  getPostProcess: async (collectionId = null, search = null, page = 1, limit = 50) => {
    const params = new URLSearchParams();
    if (collectionId) params.append('collectionId', collectionId);
    if (search) params.append('search', search);
    params.append('page', page);
    params.append('limit', limit);
    
    const { data } = await axios.get(`${BASE_URL}/data/post-process?${params}`);
    return data;
  },

  // Search data
  search: async (query, collectionId = null, type = 'both', page = 1, limit = 50) => {
    const params = new URLSearchParams();
    params.append('query', query);
    if (collectionId) params.append('collectionId', collectionId);
    params.append('type', type);
    params.append('page', page);
    params.append('limit', limit);
    
    const { data } = await axios.get(`${BASE_URL}/data/search?${params}`);
    return data;
  },

  // Get collection statistics
  getCollectionStats: async (collectionId) => {
    const { data } = await axios.get(`${BASE_URL}/data/collections/${collectionId}/stats`);
    return data;
  }
};
