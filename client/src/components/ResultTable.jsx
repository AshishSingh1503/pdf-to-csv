import React from "react";

const ResultTable = ({ data }) => {
  return (
    <div className="mt-6">
      <h2 className="text-xl font-semibold mb-2 text-slate-900 dark:text-slate-100">Processed Results</h2>
      <pre className="bg-gray-100 dark:bg-slate-800 p-4 rounded max-h-96 overflow-auto text-slate-900 dark:text-slate-100">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

export default ResultTable;
