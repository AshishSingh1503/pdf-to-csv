import React from "react";

const Footer = ({ customer, data, isPostProcess, onToggleProcess, sortField, onClearSort }) => {
  const handleDownload = () => {
    if (data && data.zipPath) {
      window.open(`http://localhost:5000${data.zipPath}`, "_blank");
    } else {
      alert("No zip file available for download.");
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
          onClick={handleDownload}
        >
          Download
        </button>
      </div>
    </div>
  );
};

export default Footer;
