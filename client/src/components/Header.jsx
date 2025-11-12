import React from "react";
import CollectionSelector from "./CollectionSelector";
import { useTheme } from "../contexts/useTheme";

const Header = ({ customer, onUploadClick, selectedCollection, onToggleSidebar, onToggleCustomersSidebar }) => {
  const { effectiveTheme, toggleTheme } = useTheme();

  return (
    <div className="bg-white dark:bg-slate-800 p-4 border-b border-gray-200 dark:border-slate-700 text-slate-900 dark:text-slate-100">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <h1 className="text-lg sm:text-xl font-semibold">Document Processor</h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          {/* Customers toggle (visible on small screens) */}
          <button
            onClick={onToggleCustomersSidebar}
            className="sm:hidden bg-transparent text-slate-700 dark:text-slate-200 px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 active:scale-95 transition-transform"
            aria-label="Toggle customers sidebar"
          >
            Customers
          </button>
          {customer && (
            <select className="border rounded px-2 py-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-gray-300 dark:border-slate-600">
              <option>{customer.name}</option>
            </select>
          )}
          <button
            className="bg-slate-600 text-white px-3 sm:px-4 py-2 rounded hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 active:scale-95 transition-transform"
            onClick={onToggleSidebar}
          >
            Uploaded Documents
          </button>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={effectiveTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
            className="p-2 rounded bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
          >
            {effectiveTheme === 'dark' ? '🌞' : '🌙'}
          </button>
          <button
            className="bg-blue-600 text-white px-4 py-2 mx-1 rounded hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 active:scale-95 transition-transform"
            onClick={onUploadClick}
            disabled={false}
            title="Upload PDFs (Ctrl+U)"
          >
            Upload PDFs
          </button>
        </div>
      </div>

      {/* Collection Name */}
      <div>
        <h2 className="text-lg font-semibold">{selectedCollection ? selectedCollection.name : "All Collections"}</h2>
      </div>
    </div>
  );
};

export default Header;
