import React from "react";

const Header = ({ onUploadClick }) => {
  return (
    <div className="bg-white p-4 border-b border-gray-200 flex justify-between items-center">
      <h1 className="text-xl font-semibold">Oct 25_Lilian Dukovski_Wyoming WA 2250- Page 1-73 End</h1>
      <div className="flex items-center space-x-2">
        <select className="border rounded px-2 py-1">
          <option>Lilian Dukovski</option>
        </select>
        <button className="bg-gray-200 px-4 py-2 rounded" onClick={() => alert("Uploaded Files clicked")}>
          Uploaded Files
        </button>
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
