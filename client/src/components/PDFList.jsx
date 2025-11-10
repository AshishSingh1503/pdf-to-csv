import React from "react";

const PDFList = ({ pdfs }) => {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Uploaded PDFs</h2>
      <ul className="space-y-1 text-slate-700 dark:text-slate-300">
        {pdfs.map((pdf, index) => (
          <li key={index} className="p-2 bg-gray-100 dark:bg-slate-700 rounded">{pdf.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default PDFList;
