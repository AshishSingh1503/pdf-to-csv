import React, { useState, useEffect } from "react";
import { customerApi } from "../api/customerApi";
import { collectionsApi } from "../api/collectionsApi";
import CustomerModal from "./CustomerModal";
import CollectionModal from "./CollectionModal";
// Toast system removed: using console logging and window.confirm instead
import { SidebarSkeleton } from './SkeletonLoader'
import EmptyState from './EmptyState'

const CustomersSidebar = ({ isOpen = true, onClose = () => {}, selectedCustomer, onCustomerSelect, onCollectionSelect, onRefresh }) => {
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

  // Replaced toast and confirmation UI with console/window.confirm

  const handleDeleteCustomer = async (customer) => {
    const confirmed = window.confirm(`Are you sure you want to delete "${customer.name}"? This will also delete all associated collections and data.`)
    if (!confirmed) return
    try {
      await customerApi.delete(customer.id);
      await fetchCustomers();
      if (onRefresh) onRefresh();
      if (selectedCustomer && selectedCustomer.id === customer.id) {
        onCustomerSelect(null);
      }
      console.log('Customer deleted')
    } catch (err) {
      console.error('Failed to delete customer')
      console.error('Error deleting customer:', err);
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
    <div className={`w-full lg:w-80 fixed lg:relative left-0 top-0 h-full z-40 transform transition-transform duration-300 bg-white dark:bg-slate-800 border-r ${!isOpen ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}`}
      aria-hidden={!isOpen}
    >
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Customers</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCreateCustomer}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 active:scale-95"
          >
            + New Customer
          </button>
          <button onClick={onClose} aria-label="Close customers sidebar" className="lg:hidden px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">✕</button>
        </div>
      </div>

      {/* Customers List */}
      <div className="flex-1 overflow-y-auto p-4">
       {loading ? (
         <SidebarSkeleton count={3} />
       ) : error ? (
         <div className="text-center text-red-500">{error}</div>
       ) : (
         <div className="space-y-2">
           {customers.map((customer) => (
             <div key={customer.id}>
               <div
                 className={`p-3 rounded-lg cursor-pointer border-2 flex items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95 ${
                   selectedCustomer && selectedCustomer.id === customer.id
                     ? 'border-blue-500 bg-blue-50 dark:bg-slate-700'
                     : 'border-gray-200 hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600'
                 }`}
                 onClick={() => onCustomerSelect(customer)}
                 tabIndex={0}
                 role="button"
                 aria-label={`Select customer ${customer.name}`}
                 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCustomerSelect(customer) } }}
               >
                 <div>
                   <div className="font-medium text-gray-900 dark:text-slate-100">{customer.name}</div>
                   <div className="text-sm text-slate-500 dark:text-slate-300">
                     {collections[customer.id]?.length || 0} collections
                   </div>
                 </div>
                 <div className="flex items-center space-x-2">
                   <button
                     onClick={(e) => { e.stopPropagation(); handleCreateCollection(customer); }}
                     className="text-sm text-blue-600 hover:text-blue-900 dark:text-sky-400 dark:hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95"
                     title="New Collection"
                   >
                     + New Collection
                   </button>
                   <button
                     onClick={(e) => { e.stopPropagation(); handleEditCustomer(customer); }}
                     className="text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95"
                     title="Edit"
                   >
                     Edit
                   </button>
                   <button
                     onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(customer); }}
                     className="text-sm text-red-600 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 active:scale-95"
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
                       className="p-2 rounded-lg cursor-pointer bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95"
                       onClick={() => onCollectionSelect(collection)}
                       tabIndex={0}
                       role="button"
                       aria-label={`Select collection ${collection.name}`}
                       onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCollectionSelect(collection) } }}
                     >
                       {collection.name}
                     </div>
                   ))}
                 </div>
               )}
             </div>
           ))}
     
           {(!customers || customers.length === 0) && (
             <EmptyState icon="👥" title="No customers yet" description="Create your first customer to get started" action={{ label: '+ New Customer', onClick: handleCreateCustomer }} />
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
