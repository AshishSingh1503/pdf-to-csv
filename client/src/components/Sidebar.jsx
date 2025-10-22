import React from "react";

const Sidebar = () => {
  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold">Customers</h2>
        <div className="flex space-x-2 mt-2">
          <button className="px-3 py-1 text-sm bg-gray-200 rounded">Name</button>
          <button className="px-3 py-1 text-sm bg-gray-200 rounded">Created</button>
          <button className="px-3 py-1 text-sm bg-gray-200 rounded">Archived</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* Customer Collections */}
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
