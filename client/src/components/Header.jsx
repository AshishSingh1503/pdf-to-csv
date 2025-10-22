import React from "react";

const Header = ({ customer, onUploadClick }) => {
  return (
    <div className="bg-white p-4 border-b border-gray-200 flex justify-between items-center">
      <h1 className="text-xl font-semibold">Document Processor</h1>
      <div className="flex items-center space-x-2">
        {customer && (
          <select className="border rounded px-2 py-1">
            <option>{customer.name}</option>
          </select>
        )}
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          onClick={onUploadClick}
        >
          Upload PDFs (Max 10)
        </button>
      </div>
    </div>
  );
};

export default Header;
