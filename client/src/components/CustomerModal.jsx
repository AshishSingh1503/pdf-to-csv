import React, { useState, useEffect, useRef } from "react";
import { customerApi } from "../api/customerApi";
import { useToast } from '../contexts/ToastContext'

const CustomerModal = ({ isOpen, onClose, onSave, customer, mode }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { showSuccess, showError } = useToast()
  const nameRef = useRef(null)
  const modalRef = useRef(null)
  const prevActiveRef = useRef(null)

  useEffect(() => {
    if (customer) {
      setName(customer.name || "");
      setEmail(customer.email || "");
      setPhone(customer.phone || "");
    } else {
      setName("");
      setEmail("");
      setPhone("");
    }
    setError("");
  }, [customer, isOpen]);

  useEffect(() => {
    if (isOpen) {
      prevActiveRef.current = document.activeElement
      setTimeout(() => {
        const el = nameRef.current
        if (el) el.focus()
        const focusable = modalRef.current?.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])') || []
        if (focusable.length && !focusable[0].contains(document.activeElement)) focusable[0].focus()
      }, 50)
    } else {
      try { prevActiveRef.current?.focus() } catch (e) {}
    }
  }, [isOpen])

  useEffect(() => {
    const trap = (e) => {
      if (!isOpen) return
      if (e.key === 'Escape') {
        onClose()
      }
      if (e.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])')
        if (!focusable || focusable.length === 0) return
        const nodes = Array.prototype.slice.call(focusable)
        const idx = nodes.indexOf(document.activeElement)
        if (e.shiftKey) {
          if (idx === 0) {
            e.preventDefault()
            nodes[nodes.length - 1].focus()
          }
        } else {
          if (idx === nodes.length - 1) {
            e.preventDefault()
            nodes[0].focus()
          }
        }
      }
    }
    window.addEventListener('keydown', trap)
    return () => window.removeEventListener('keydown', trap)
  }, [isOpen, onClose])

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Customer name is required.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (mode === "create") {
        await customerApi.create({ name, email, phone });
      } else {
        await customerApi.update(customer.id, { name, email, phone });
      }
      onSave();
      onClose();
      showSuccess(mode === 'create' ? 'Customer created successfully' : 'Customer updated successfully')
    } catch (err) {
      const msg = err.response?.data?.error || `Failed to ${mode} customer.`
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70 flex items-center justify-center z-50" aria-hidden={!isOpen}>
      <div ref={modalRef} role="dialog" aria-modal="true" className="bg-white dark:bg-slate-800 rounded-lg p-6 w-full max-w-md text-slate-900 dark:text-slate-100">
        <h2 className="text-xl font-semibold mb-4">
          {mode === "create" ? "Create New Customer" : "Edit Customer"}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">Name</label>
            <input
              type="text"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
              {error}
            </div>
          )}
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 rounded-md dark:bg-slate-700 dark:text-slate-100"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md"
              disabled={loading}
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomerModal;
