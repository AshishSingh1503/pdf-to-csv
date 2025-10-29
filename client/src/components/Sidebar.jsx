import React from "react";
import Customer from "./Customer";
import PDFList from "./PDFList";

const Sidebar = ({ customer, pdfs, onPdfSelect, isOpen, onClose }) => {
  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <div 
        className={`
          fixed md:static 
          inset-y-0 left-0 
          w-[280px] md:w-80 
          bg-white 
          border-r border-gray-200 
          flex flex-col 
          z-50
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Header with Customer Info */}
        <div className="sticky top-0 bg-white z-10">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <Customer customer={customer} />
            <button 
              onClick={onClose}
              className="md:hidden p-2 rounded-full hover:bg-gray-100"
              aria-label="Close sidebar"
            >
              <svg 
                className="w-5 h-5 text-gray-500" 
                fill="none" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth="2" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* PDF List - Scrollable Area */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <PDFList pdfs={pdfs} onPdfSelect={onPdfSelect} />
        </div>

        {/* Footer with Action Button */}
        <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200">
          <button
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg
              hover:bg-blue-700 active:bg-blue-800
              transition-colors duration-200
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            onClick={() => alert("New Customer clicked")}
          >
            + New Customer
          </button>
        </div>
      </div>
    </>
  );
};

export default Sidebar;