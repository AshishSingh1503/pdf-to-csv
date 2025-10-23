import React from "react";
import CollectionSelector from "./CollectionSelector";

const Header = ({ customer, onUploadClick, selectedCollection, onCollectionChange }) => {
  return (
    <div className="bg-white p-4 border-b border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold">Document Processor</h1>
        <div className="flex items-center space-x-2">
          {customer && (
            <select className="border rounded px-2 py-1">
              <option>{customer.name}</option>
            </select>
          )}
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={onUploadClick}
            disabled={!selectedCollection}
            title={!selectedCollection ? "Please select a collection first" : "Upload PDFs"}
          >
            Upload PDFs (Max 10)
          </button>
        </div>
      </div>
      
      {/* Collection Selector */}
      <div className="max-w-md">
        <CollectionSelector
          selectedCollection={selectedCollection}
          onCollectionChange={onCollectionChange}
        />
      </div>
    </div>
  );
};

export default Header;
