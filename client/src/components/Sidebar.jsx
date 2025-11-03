import React from "react";
import Customer from "./Customer";
import PDFList from "./PDFList";

const Sidebar = ({ customer, pdfs, onPdfSelect }) => {
  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <Customer customer={customer} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <PDFList pdfs={pdfs} onPdfSelect={onPdfSelect} />
      </div>
      <div className="p-4 border-t border-gray-200">
        <button
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          onClick={() => alert("New Customer clicked")}
        >
          + New Customer
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
