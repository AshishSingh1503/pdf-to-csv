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


// import React from 'react';

// const DownloadButtons = ({ links }) => {
//   if (!links) return null;

//   return (
//     <div className="my-4 p-4 bg-gray-100 rounded-lg">
//       <h3 className="text-lg font-semibold mb-2">Download Results</h3>
//       <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
//         <a href={links.rawCsv} download className="btn btn-primary">Raw CSV</a>
//         <a href={links.filteredCsv} download className="btn btn-primary">Filtered CSV</a>
//         <a href={links.rawExcel} download className="btn btn-primary">Raw Excel</a>
//         <a href={links.filteredExcel} download className="btn btn-primary">Filtered Excel</a>
//         <a href={links.combinedPreJson} download className="btn btn-secondary">Pre-processing JSON</a>
//         <a href={links.combinedPostJson} download className="btn btn-secondary">Post-processing JSON</a>
//         <a href={links.zip} download className="btn btn-accent">Download ZIP</a>
//       </div>
//     </div>
//   );
// };

// export default DownloadButtons;
