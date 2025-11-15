import React, { useState, useEffect, useRef } from "react";
import { collectionsApi } from "../api/collectionsApi";

const CollectionModal = ({ isOpen, onClose, onSave, collection = null, customer, mode = 'create' }) => {
  const [formData, setFormData] = useState({ name: '', description: '', customer_id: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && collection) {
        setFormData({
          name: collection.name || '',
          description: collection.description || '',
          customer_id: collection.customer_id
        });
      } else {
        setFormData({ name: '', description: '', customer_id: customer ? customer.id : null });
      }
      setError('');
    }
  }, [isOpen, mode, collection, customer]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Collection name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (mode === 'create') {
        await collectionsApi.create(formData);
      } else {
        await collectionsApi.update(collection.id, formData);
      }
      onSave();
      onClose();
      console.log(mode === 'create' ? 'Collection created successfully' : 'Collection updated successfully');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to save collection';
      setError(msg);
      console.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const nameRef = useRef(null);
  const modalRef = useRef(null);
  const prevActiveRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      prevActiveRef.current = document.activeElement;
      setTimeout(() => {
        const el = nameRef.current;
        if (el) el.focus();
        const focusable = modalRef.current?.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])') || [];
        if (focusable.length && !focusable[0].contains(document.activeElement)) focusable[0].focus();
      }, 50);
    } else {
      try { prevActiveRef.current?.focus(); } catch (_e) { void _e; }
    }
  }, [isOpen]);

  useEffect(() => {
    const trap = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!focusable || focusable.length === 0) return;
        const nodes = Array.prototype.slice.call(focusable);
        const idx = nodes.indexOf(document.activeElement);
        if (e.shiftKey) {
          if (idx === 0) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
        } else {
          if (idx === nodes.length - 1) { e.preventDefault(); nodes[0].focus(); }
        }
      }
    };
    window.addEventListener('keydown', trap);
    return () => window.removeEventListener('keydown', trap);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70 flex items-center justify-center z-50" aria-hidden={!isOpen}>
      <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white dark:bg-slate-800 rounded-lg p-6 w-full max-w-md mx-4 text-slate-900 dark:text-slate-100">
        <h2 className="text-xl font-semibold mb-4">
          {mode === 'create' ? 'Create New Collection' : 'Edit Collection'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">Collection Name *</label>
            <input
              type="text"
              name="name"
              ref={nameRef}
              value={formData.name}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter collection name"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter collection description (optional)"
              rows={3}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{error}</div>
          )}

          <div className="flex justify-end space-x-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600" disabled={loading}>Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50" disabled={loading}>{loading ? 'Saving...' : (mode === 'create' ? 'Create' : 'Update')}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CollectionModal;
