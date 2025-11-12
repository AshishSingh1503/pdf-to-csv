import React from "react";
import { useToast } from '../contexts/useToast'
import Customer from "./Customer";
import PDFList from "./PDFList";

const Sidebar = ({ customer, pdfs, onPdfSelect }) => {
  const { showInfo } = useToast()
  return (
    <div className="w-80 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col text-slate-900 dark:text-slate-100">
      <div className="p-4 border-b border-gray-200 dark:border-slate-700">
        <Customer customer={customer} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <PDFList pdfs={pdfs} onPdfSelect={onPdfSelect} />
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-slate-700">
        <button
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => showInfo('New Customer clicked')}
        >
          + New Customer
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
