import React from "react";
import { apiClient } from "../api/apiClient";

const Footer = ({ customer, isPostProcess, onToggleProcess, sortField, onClearSort, selectedCollection }) => {
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

  const handleDownloadSummary = () => {
    if (!selectedCollection || !selectedCollection.id) {
      alert("Please select a collection to download.");
      return;
    }

    // Use the server route exposed at /download/collection/:collectionId/summary
    const url = `${apiClient.defaults.baseURL}/documents/download/collection/${selectedCollection.id}/summary`;
    window.open(url, "_blank");
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
          className={`bg-blue-600 text-white px-4 py-2 rounded ${!selectedCollection ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'}`}
          onClick={() => handleDownload('csv')}
          disabled={!selectedCollection}
          aria-disabled={!selectedCollection}
        >
          Download CSV
        </button>
        <button
          className={`bg-green-600 text-white px-4 py-2 rounded ${!selectedCollection ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-700'}`}
          onClick={() => handleDownload('excel')}
          disabled={!selectedCollection}
          aria-disabled={!selectedCollection}
        >
          Download Excel
        </button>
        <button
          className={`bg-purple-600 text-white px-4 py-2 rounded ${!selectedCollection ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-700'}`}
          onClick={handleDownloadSummary}
          disabled={!selectedCollection}
          aria-disabled={!selectedCollection}
        >
          Download Summary
        </button>
      </div>
    </div>
  );
};

export default Footer;
