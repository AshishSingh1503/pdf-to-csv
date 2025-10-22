import React, { useState } from "react";
import { uploadAndProcess } from "../api/documentApi";
import ResultTable from "../components/ResultTable";
import DownloadButtons from "../components/DownloadButtons";

const Home = () => {
  const [files, setFiles] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!files.length) return alert("Please upload at least one PDF");
    setLoading(true);
    const result = await uploadAndProcess(files);
    setData(result);
    setLoading(false);
  };

  return (
    <div className="p-10 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">📄 PDF → CSV Document Processor</h1>

      <input
        type="file"
        multiple
        accept=".pdf"
        onChange={(e) => setFiles([...e.target.files])}
        className="border p-2 mb-4"
      />

      <button
        onClick={handleUpload}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {loading ? "Processing..." : "Process PDFs"}
      </button>

      {loading && <p className="mt-4 text-gray-500">Processing files...</p>}

      {data && (
        <>
          <ResultTable data={data.results} />
          <DownloadButtons zipUrl={data.zip} />
        </>
      )}
    </div>
  );
};

export default Home;
