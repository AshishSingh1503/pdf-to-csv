import React, { useState, useEffect } from "react";
import { collectionsApi } from "../api/collectionsApi";

const CollectionSelector = ({ selectedCollection, onCollectionChange, disabled = false }) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCollections();
  }, []);

  const fetchCollections = async () => {
    try {
      setLoading(true);
      const response = await collectionsApi.getAll();
      setCollections(response.data);
      setError('');
    } catch (err) {
      setError('Failed to load collections');
      console.error('Error fetching collections:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCollectionChange = (e) => {
    const collectionId = e.target.value;
    if (collectionId === '') {
      onCollectionChange(null);
    } else {
      const collection = collections.find(c => c.id === parseInt(collectionId));
      onCollectionChange(collection);
    }
  };

  if (loading) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Collection
        </label>
        <div className="px-3 py-2 border border-gray-300 rounded-md bg-gray-100">
          Loading collections...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Collection
        </label>
        <div className="px-3 py-2 border border-red-300 rounded-md bg-red-50 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Select Collection *
      </label>
      <select
        value={selectedCollection ? selectedCollection.id : ''}
        onChange={handleCollectionChange}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        required
      >
        <option value="">Choose a collection...</option>
        {Array.isArray(collections) && collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            {collection.name}
          </option>
        ))}
      </select>
      {selectedCollection && (
        <div className="mt-1 text-sm text-gray-600">
          Selected: {selectedCollection.name}
          {selectedCollection.description && (
            <span className="block text-gray-500">{selectedCollection.description}</span>
          )}
        </div>
      )}
    </div>
  );
};

export default CollectionSelector;
