import React from "react";

const DownloadButtons = ({ zipUrl }) => {
  if (!zipUrl) return null;

  return (
    <div className="mt-6">
      <a
        href={`http://localhost:5000${zipUrl}`}
        download
        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
      >
        📦 Download All as ZIP
      </a>
    </div>
  );
};

export default DownloadButtons;
