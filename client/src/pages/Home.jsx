import React, { useState, useRef } from "react";
import { uploadAndProcess } from "../api/documentApi";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import ClientTable from "../components/ClientTable";
import Pagination from "../components/Pagination";
import Footer from "../components/Footer";

const Home = () => {
  const [files, setFiles] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const handleUpload = async (newFiles) => {
    if (!newFiles.length) return;
    setFiles(newFiles);
    setLoading(true);
    const result = await uploadAndProcess(newFiles);
    setData(result);
    setLoading(false);
  };

  const handleHeaderUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const selectedFiles = [...e.target.files];
    if (selectedFiles.length > 0) {
      handleUpload(selectedFiles);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header onUploadClick={handleHeaderUploadClick} />
        <main className="flex-1 overflow-y-auto">
          <div className="p-4">
            <input
              type="file"
              multiple
              accept=".pdf"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="hidden"
            />

            {loading && <p className="mt-4 text-gray-500">Processing files...</p>}

            {data ? (
             <ClientTable data={data.results} />
             
            ) : (
              <p className="mt-4 text-gray-500">Upload and process PDFs to see the results.</p>
            )}
          </div>
        </main>
        <Footer data={data} />
        <Pagination />
      </div>
    </div>
  );
};

export default Home;
