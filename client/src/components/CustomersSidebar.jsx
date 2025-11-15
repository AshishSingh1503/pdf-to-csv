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
  const [activeCollections, setActiveCollections] = useState({});
  const [archivedCollections, setArchivedCollections] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDesktop, setIsDesktop] = useState(false);
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
      const active = await collectionsApi.getAll(customerId, 'active');
      setActiveCollections(prev => ({ ...prev, [customerId]: active.data }));
      const archived = await collectionsApi.getAll(customerId, 'archived');
      setArchivedCollections(prev => ({ ...prev, [customerId]: archived.data }));
    } catch (err) {
      console.error(`Error fetching collections for customer ${customerId}:`, err);
    }
  };

  const handleArchiveCollection = async (collectionId, customerId) => {
    const confirmed = window.confirm('Are you sure you want to archive this collection?');
    if (!confirmed) return;
    try {
      await collectionsApi.archive(collectionId);
      fetchCollectionsForCustomer(customerId);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to archive collection:', err);
    }
  };

  const handleUnarchiveCollection = async (collectionId, customerId) => {
    const confirmed = window.confirm('Are you sure you want to unarchive this collection?');
    if (!confirmed) return;
    try {
      await collectionsApi.unarchive(collectionId);
      fetchCollectionsForCustomer(customerId);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to unarchive collection:', err);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  // track desktop breakpoint so aria-hidden reflects actual visibility
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handle = (e) => setIsDesktop(e.matches);
    // set initial
    setIsDesktop(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', handle);
    else mq.addListener(handle);
    return () => {
      try {
        if (mq.removeEventListener) mq.removeEventListener('change', handle);
        else mq.removeListener(handle);
      } catch (_e) { void _e; }
    };
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

  const handleEditCollection = (collection, customer) => {
    setModalMode('edit');
    setEditingCollection(collection);
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

  const isActuallyVisible = isOpen || isDesktop;

  return (
    <div className={`w-full lg:w-80 fixed lg:relative left-0 top-0 h-full z-40 transform transition-transform duration-300 bg-white dark:bg-slate-800 border-r ${!isOpen ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}`}
      aria-hidden={!isActuallyVisible}
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
                     {activeCollections[customer.id]?.length || 0} active collections
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
                   {activeCollections[customer.id]?.map(collection => (
                     <div
                       key={collection.id}
                       className="p-2 rounded-lg cursor-pointer bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95 flex justify-between items-center"
                       onClick={() => onCollectionSelect(collection)}
                       tabIndex={0}
                       role="button"
                       aria-label={`Select collection ${collection.name}`}
                       onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCollectionSelect(collection) } }}
                     >
                       <span>{collection.name}</span>
                        <div className="relative group">
                          <button className="text-xs text-gray-500 hover:text-gray-700">...</button>
                          <div className="absolute right-0 w-28 bg-white border rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-10">
                            <a
                              href="#"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditCollection(collection, customer);
                              }}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              Rename
                            </a>
                            <a
                              href="#"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleArchiveCollection(collection.id, customer.id);
                              }}
                              className="block px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                            >
                              Archive
                            </a>
                          </div>
                        </div>
                     </div>
                   ))}
                   {archivedCollections[customer.id]?.length > 0 && (
                     <div>
                       <h4 className="mt-2 text-sm font-semibold text-gray-500">Archived</h4>
                       {archivedCollections[customer.id].map(collection => (
                         <div
                           key={collection.id}
                           className="p-2 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-400 flex justify-between items-center"
                         >
                           <span>{collection.name}</span>
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               handleUnarchiveCollection(collection.id, customer.id);
                             }}
                             className="text-xs text-gray-500 hover:text-blue-500"
                             title="Unarchive Collection"
                           >
                             Unarchive
                           </button>
                         </div>
                       ))}
                     </div>
                   )}
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
