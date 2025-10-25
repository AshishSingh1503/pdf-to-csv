import React from "react";
import { apiClient } from "../api/apiClient";

const Footer = ({ customer, data, isPostProcess, onToggleProcess, sortField, onClearSort, selectedCollection }) => {
  const handleDownload = (fileType) => {
    if (selectedCollection) {
      const type = isPostProcess ? 'post' : 'pre';
      let url = `${apiClient.defaults.baseURL}/documents/download/collection/${selectedCollection.id}`;
      if(fileType === 'excel') {
        url += '/excel';
      }
      url += `?type=${type}`;
      window.open(url, "_blank");
    } else {
      alert("Please select a collection to download.");
    }
  };

  return (
    <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
      <div>
        {customer && (
          <p className="text-sm text-gray-500">
            Customer: {customer.name}
          </p>
        )}
      </div>
      <div className="flex items-center space-x-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={isPostProcess}
            onChange={onToggleProcess}
          />
          <span>Post Process</span>
        </label>
        {sortField && (
          <button
            className="bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600"
            onClick={onClearSort}
            title="Clear sorting"
          >
            Clear Sort
          </button>
        )}
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          onClick={() => handleDownload('csv')}
        >
          Download CSV
        </button>
        <button
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          onClick={() => handleDownload('excel')}
        >
          Download Excel
        </button>
      </div>
    </div>
  );
};

export default Footer;
