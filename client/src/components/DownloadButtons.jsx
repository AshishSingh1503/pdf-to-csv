import React from "react";

const DownloadButtons = ({ zipUrl }) => {
  if (!zipUrl) return null;

  return (
    <div className="mt-6">
      <a
        href={`https://pdf2csv-backend-2xcfwc7m6a-uc.a.run.app/${zipUrl}`}
        download
        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
      >
        📦 Download All as ZIP
      </a>
    </div>
  );
};

export default DownloadButtons;
