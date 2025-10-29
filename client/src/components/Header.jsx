import React from "react";
import CollectionSelector from "./CollectionSelector";

const Header = ({ customer, onUploadClick, selectedCollection, onCollectionChange, onToggleSidebar, onToggleCustomersSidebar }) => {
  return (
    <div className="bg-white p-4 border-b border-gray-200">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-4">
        <div className="flex items-center mb-4 sm:mb-0">
          <button
            onClick={onToggleCustomersSidebar}
            className="lg:hidden mr-4 text-gray-500 hover:text-gray-700"
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
                d="M4 6h16M4 12h16m-7 6h7"
              />
            </svg>
          </button>
          <h1 className="text-xl font-semibold">Document Processor</h1>
        </div>
        <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full sm:w-auto">
          {customer && (
            <select className="border rounded px-2 py-1 w-full sm:w-auto">
              <option>{customer.name}</option>
            </select>
          )}
          <button
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 w-full sm:w-auto"
            onClick={onToggleSidebar}
          >
            Uploaded Document
          </button>
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 w-full sm:w-auto"
            onClick={onUploadClick}
            disabled={false}
            title="Upload PDFs"
          >
            Upload PDFs (Max 25)
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
