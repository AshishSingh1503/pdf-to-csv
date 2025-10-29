import React, { useState, useEffect } from "react";
import { customerApi } from "../api/customerApi";
import { collectionsApi } from "../api/collectionsApi";
import CustomerModal from "./CustomerModal";
import CollectionModal from "./CollectionModal";

const CustomersSidebar = ({ selectedCustomer, onCustomerSelect, onCollectionSelect, onRefresh, isOpen, onClose }) => {
  const [customers, setCustomers] = useState([]);
  const [collections, setCollections] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingCollection, setEditingCollection] = useState(null);
  const [currentCustomer, setCurrentCustomer] = useState(null);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const response = await customerApi.getAll();
      setCustomers(response.data.data);
      setError('');
    } catch (err) {
      setError('Failed to load customers');
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCollectionsForCustomer = async (customerId) => {
    try {
      const response = await collectionsApi.getAll(customerId);
      setCollections(prev => ({ ...prev, [customerId]: response.data }));
    } catch (err) {
      console.error(`Error fetching collections for customer ${customerId}:`, err);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    customers.forEach(customer => {
      fetchCollectionsForCustomer(customer.id);
    });
  }, [customers]);

  const handleCreateCustomer = () => {
    setModalMode('create');
    setEditingCustomer(null);
    setShowCustomerModal(true);
  };

  const handleEditCustomer = (customer) => {
    setModalMode('edit');
    setEditingCustomer(customer);
    setShowCustomerModal(true);
  };

  const handleDeleteCustomer = async (customer) => {
    if (window.confirm(`Are you sure you want to delete "${customer.name}"? This will also delete all associated collections and data.`)) {
      try {
        await customerApi.delete(customer.id);
        await fetchCustomers();
        if (onRefresh) onRefresh();
        if (selectedCustomer && selectedCustomer.id === customer.id) {
          onCustomerSelect(null);
        }
      } catch (err) {
        alert('Failed to delete customer');
        console.error('Error deleting customer:', err);
      }
    }
  };

  const handleCreateCollection = (customer) => {
    setModalMode('create');
    setEditingCollection(null);
    setCurrentCustomer(customer);
    setShowCollectionModal(true);
  };

  const handleCustomerModalSave = () => {
    fetchCustomers();
    if (onRefresh) onRefresh();
  };
  
  const handleCollectionModalSave = () => {
    fetchCollectionsForCustomer(currentCustomer.id);
    if (onRefresh) onRefresh();
  };

  return (
    <div
      className={`fixed top-0 left-0 h-full bg-white border-r border-gray-200 flex flex-col transition-transform transform ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      } lg:relative lg:translate-x-0 w-80 z-20`}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Customers</h2>
          <div className="flex items-center">
            <button
              onClick={handleCreateCustomer}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
            >
              + New Customer
            </button>
            <button
              onClick={onClose}
              className="lg:hidden ml-2 text-gray-500 hover:text-gray-700"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Customers List */}
     <div className="flex-1 overflow-y-auto p-4">
       {loading ? (
         <div className="text-center text-gray-500">Loading customers...</div>
       ) : error ? (
         <div className="text-center text-red-500">{error}</div>
       ) : (
         <div className="space-y-2">
           {customers.map((customer) => (
             <div key={customer.id}>
               <div
                 className={`p-3 rounded-lg cursor-pointer border-2 flex items-center justify-between transition-colors ${
                   selectedCustomer && selectedCustomer.id === customer.id
                     ? 'border-blue-500 bg-blue-50'
                     : 'border-gray-200 hover:border-gray-300'
                 }`}
                 onClick={() => onCustomerSelect(customer)}
               >
                 <div>
                   <div className="font-medium text-gray-900">{customer.name}</div>
                   <div className="text-sm text-gray-500">
                     {collections[customer.id]?.length || 0} collections
                   </div>
                 </div>
                 <div className="flex items-center space-x-2">
                   <button
                     onClick={(e) => { e.stopPropagation(); handleCreateCollection(customer); }}
                     className="text-sm text-blue-600 hover:text-blue-900"
                     title="New Collection"
                   >
                     + New Collection
                   </button>
                   <button
                     onClick={(e) => { e.stopPropagation(); handleEditCustomer(customer); }}
                     className="text-sm text-gray-600 hover:text-gray-900"
                     title="Edit"
                   >
                     Edit
                   </button>
                   <button
                     onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(customer); }}
                     className="text-sm text-red-600 hover:text-red-700"
                     title="Delete"
                   >
                     Delete
                   </button>
                 </div>
               </div>
               {selectedCustomer && selectedCustomer.id === customer.id && (
                 <div className="ml-4 mt-2 space-y-1">
                   {collections[customer.id]?.map(collection => (
                     <div
                       key={collection.id}
                       className="p-2 rounded-lg cursor-pointer bg-gray-100 hover:bg-gray-200"
                       onClick={() => onCollectionSelect(collection)}
                     >
                       {collection.name}
                     </div>
                   ))}
                 </div>
               )}
             </div>
           ))}
     
           {(!customers || customers.length === 0) && (
             <div className="text-center text-gray-500 py-8">
               No customers yet. Create your first customer!
             </div>
           )}
         </div>
       )}
     </div>

      {/* Customer Modal */}
      <CustomerModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSave={handleCustomerModalSave}
        customer={editingCustomer}
        mode={modalMode}
      />
      
      {/* Collection Modal */}
      <CollectionModal
        isOpen={showCollectionModal}
        onClose={() => setShowCollectionModal(false)}
        onSave={handleCollectionModalSave}
        collection={editingCollection}
        customer={currentCustomer}
        mode={modalMode}
      />
    </div>
  );
};

export default CustomersSidebar;
