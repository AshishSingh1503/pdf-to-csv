import React, { useState, useRef } from "react";
import { uploadAndProcess } from "../api/documentApi";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import ClientTable from "../components/ClientTable";
import Pagination from "../components/Pagination";
import Footer from "../components/Footer";

const Home = () => {
  const [pdfs, setPdfs] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const fileInputRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const handleUpload = async (newFiles) => {
    if (!newFiles.length) return;

    if (!customer && newFiles.length > 0) {
      const fileName = newFiles[0].name;
      const customerName = fileName.split('_')[0].replace(/-/g, ' ');
      setCustomer({ name: customerName });
    }

    setPdfs(prevPdfs => [...prevPdfs, ...newFiles]);
    setLoading(true);
    const result = await uploadAndProcess(newFiles);
    setData(prevData => ({
      ...result,
      results: [...(prevData?.results || []), ...result.results]
    }));
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

  const handlePdfSelect = (pdf) => {
    setSelectedPdf(pdf);
    setCurrentPage(1);
  };

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const filteredData = data && selectedPdf
    ? data.results.filter(item => item.source === selectedPdf.name)
    : data ? data.results : [];
  
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar customer={customer} pdfs={pdfs} onPdfSelect={handlePdfSelect} />
      <div className="flex-1 flex flex-col">
        <Header customer={customer} onUploadClick={handleHeaderUploadClick} />
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
             <ClientTable data={paginatedData} />
             
            ) : (
              <p className="mt-4 text-gray-500">Upload and process PDFs to see the results.</p>
            )}
          </div>
        </main>
        <Footer customer={customer} data={data} />
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
      </div>
    </div>
  );
};

export default Home;
