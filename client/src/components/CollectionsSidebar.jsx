import React, { useState, useEffect } from "react";
import { collectionsApi } from "../api/collectionsApi";
import CollectionModal from "./CollectionModal";

const CollectionsSidebar = ({ selectedCollection, onCollectionSelect, onRefresh }) => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingCollection, setEditingCollection] = useState(null);

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

  useEffect(() => {
    fetchCollections();
  }, []);

  const handleCreateCollection = () => {
    setModalMode('create');
    setEditingCollection(null);
    setShowModal(true);
  };

  const handleEditCollection = (collection) => {
    setModalMode('edit');
    setEditingCollection(collection);
    setShowModal(true);
  };

  const handleDeleteCollection = async (collection) => {
    if (window.confirm(`Are you sure you want to delete "${collection.name}"? This will also delete all associated data.`)) {
      try {
        await collectionsApi.delete(collection.id);
        await fetchCollections();
        if (onRefresh) onRefresh();
        // If the deleted collection was selected, clear selection
        if (selectedCollection && selectedCollection.id === collection.id) {
          onCollectionSelect(null);
        }
      } catch (err) {
        alert('Failed to delete collection');
        console.error('Error deleting collection:', err);
      }
    }
  };

  const handleArchiveCollection = async (collection) => {
    if (window.confirm(`Are you sure you want to archive "${collection.name}"?`)) {
      try {
        await collectionsApi.archive(collection.id);
        await fetchCollections();
        if (onRefresh) onRefresh();
        // If the archived collection was selected, clear selection
        if (selectedCollection && selectedCollection.id === collection.id) {
          onCollectionSelect(null);
        }
      } catch (err) {
        alert('Failed to archive collection');
        console.error('Error archiving collection:', err);
      }
    }
  };

  const handleModalSave = () => {
    fetchCollections();
    if (onRefresh) onRefresh();
  };

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Collections</h2>
          <button
            onClick={handleCreateCollection}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            + New
          </button>
        </div>
      </div>

      {/* Collections List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-gray-500">Loading collections...</div>
        ) : error ? (
          <div className="text-center text-red-500">{error}</div>
        ) : (
          <div className="space-y-2">
            {/* All Collections Option */}
            <div
              className={`p-3 rounded-lg cursor-pointer border-2 transition-colors ${
                !selectedCollection
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => onCollectionSelect(null)}
            >
              <div className="font-medium text-gray-900">All Collections</div>
              <div className="text-sm text-gray-500">View all data</div>
            </div>

            {/* Individual Collections */}
            {(collections || []).map((collection) => (
              <div
                key={collection.id}
                className={`p-3 rounded-lg cursor-pointer border-2 transition-colors ${
                  selectedCollection && selectedCollection.id === collection.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => onCollectionSelect(collection)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{collection.name}</div>
                    {collection.description && (
                      <div className="text-sm text-gray-500 mt-1">{collection.description}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      Created: {new Date(collection.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  
                  {/* Actions Menu */}
                  <div className="flex space-x-1 ml-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditCollection(collection);
                      }}
                      className="p-1 text-gray-400 hover:text-blue-600"
                      title="Edit collection"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleArchiveCollection(collection);
                      }}
                      className="p-1 text-gray-400 hover:text-yellow-600"
                      title="Archive collection"
                    >
                      📁
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCollection(collection);
                      }}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="Delete collection"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {collections.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No collections yet. Create your first collection!
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collection Modal */}
      <CollectionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleModalSave}
        collection={editingCollection}
        mode={modalMode}
      />
    </div>
  );
};

export default CollectionsSidebar;
