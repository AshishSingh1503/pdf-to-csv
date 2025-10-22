import React from "react";

const Footer = () => {
  return (
    <div className="bg-white px-4 py-3 flex items-center justify-end border-t border-gray-200 sm:px-6">
      <div className="flex items-center space-x-4">
        <label className="flex items-center space-x-2">
          <input type="checkbox" className="form-checkbox" />
          <span>Post Process</span>
        </label>
        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Download
        </button>
      </div>
    </div>
  );
};

export default Footer;
