import React, { useState, useRef, useEffect } from "react";
import { uploadAndProcess } from "../api/documentApi";
import { dataApi } from "../api/collectionsApi";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import ClientTable from "../components/ClientTable";
import Pagination from "../components/Pagination";
import Footer from "../components/Footer";
import CustomersSidebar from "../components/CustomersSidebar";
import SearchBar from "../components/SearchBar";
import DownloadButtons from "../components/DownloadButtons";
import UploadedFilesSidebar from "../components/UploadedFilesSidebar";
import ProgressBar from "../components/ProgressBar";
import socket from "../services/websocket";

const Home = () => {
  const [pdfs, setPdfs] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const fileInputRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPostProcess, setIsPostProcess] = useState(true);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCollectionsSidebar, setShowCollectionsSidebar] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 50;
  const [downloadLinks, setDownloadLinks] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCustomerSidebarOpen, setIsCustomerSidebarOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUpload = async (newFiles, collectionId) => {
    if (!newFiles.length) return;

    if (!collectionId) {
      alert('Please select a collection before uploading files');
      return;
    }

    if (!customer && newFiles.length > 0) {
      const fileName = newFiles[0].name;
      const customerName = fileName.split('_')[0].replace(/-/g, ' ');
      setCustomer({ name: customerName });
    }

    setLoading(true);

    try {
      const result = await uploadAndProcess(newFiles, collectionId, (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(percentCompleted);
        if (percentCompleted === 100) {
          setTimeout(() => {
            setLoading(false);
          }, 1000);
        }
      });
      
      await fetchData();
      
      alert(`Successfully uploaded ${newFiles.length} file(s) and started processing.`);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to process files. Please try again.');
      setLoading(false);
    }
  };

  const handleHeaderUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const selectedFiles = [...e.target.files];
    if (selectedFiles.length > 0) {
      if (!selectedCollection) {
        alert('Please select a collection before uploading files');
        return;
      }
      handleUpload(selectedFiles, selectedCollection.id);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const collectionId = selectedCollection ? selectedCollection.id : null;
      
      let postProcessData = [];
      let preProcessData = [];
      
      if (searchTerm) {
        const searchResult = await dataApi.search(searchTerm, collectionId, 'both', currentPage, itemsPerPage);
        postProcessData = searchResult.data.postProcess || [];
        preProcessData = searchResult.data.preProcess || [];
        setTotalPages(searchResult.pagination.pages);
      } else {
        if (isPostProcess) {
          const result = await dataApi.getPostProcess(collectionId, null, currentPage, itemsPerPage);
          postProcessData = result.data;
          setTotalPages(result.pagination.pages);
        } else {
          const result = await dataApi.getPreProcess(collectionId, null, currentPage, itemsPerPage);
          preProcessData = result.data;
          setTotalPages(result.pagination.pages);
        }
      }
      
      setData({
        postProcessResults: postProcessData || [],
        preProcessResults: preProcessData || []
      });
    } catch (error) {
      console.error('Error fetching data:', error);
      setData({ postProcessResults: [], preProcessResults: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedCollection, searchTerm, currentPage, isPostProcess]);

  useEffect(() => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'ALL_FILES_PROCESSED' && message.collectionId === selectedCollection?.id) {
        fetchData();
      }
    };
  }, [selectedCollection]);

  const handleSearch = (term) => {
    setSearchTerm(term);
    setCurrentPage(1);
  };

  const handleCollectionSelect = (collection) => {
    setSelectedCollection(collection);
    setCurrentPage(1);
    setSearchTerm('');
  };

  const handleCustomerSelect = (customer) => {
    setSelectedCustomer(customer);
    setSelectedCollection(null);
  };

  const handlePdfSelect = (pdf) => {
    setSelectedPdf(pdf);
    setCurrentPage(1);
  };

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleToggleProcess = () => {
    setIsPostProcess(!isPostProcess);
    setCurrentPage(1);
    setSortField(null);
    setSortDirection('asc');
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const handleClearSort = () => {
    setSortField(null);
    setSortDirection('asc');
    setCurrentPage(1);
  };

  const getCurrentData = () => {
    if (!data) return [];
    
    let sourceData = isPostProcess ? (data.postProcessResults || []) : (data.preProcessResults || []);
    
    if (selectedPdf) {
      sourceData = sourceData.filter(item => item.source === selectedPdf.name);
    }
    
    if (sortField) {
      sourceData = [...sourceData].sort((a, b) => {
        let aValue = a[sortField] || '';
        let bValue = b[sortField] || '';
        
        if (sortField === 'dob' || sortField === 'lastseen') {
          const aDate = new Date(aValue);
          const bDate = new Date(bValue);
          if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
            aValue = aDate;
            bValue = bDate;
          }
        } else if (sortField === 'mobile') {
          aValue = aValue.replace(/\D/g, '');
          bValue = bValue.replace(/\D/g, '');
        }
        
        if (isPostProcess && (sortField === 'first' || sortField === 'last')) {
          aValue = a[sortField] || '';
          bValue = b[sortField] || '';
        } else if (!isPostProcess && sortField === 'full_name') {
          aValue = a.full_name || '';
          bValue = b.full_name || '';
        }
        
        aValue = String(aValue).toLowerCase();
        bValue = String(bValue).toLowerCase();
        
        if (aValue < bValue) {
          return sortDirection === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortDirection === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    
    return sourceData;
  };

  const paginatedData = getCurrentData();

  return (
    <div className="flex h-screen bg-gray-50">
      <CustomersSidebar
        selectedCustomer={selectedCustomer}
        onCustomerSelect={handleCustomerSelect}
        selectedCollection={selectedCollection}
        onCollectionSelect={handleCollectionSelect}
        onRefresh={fetchData}
        isOpen={isCustomerSidebarOpen}
        onClose={() => setIsCustomerSidebarOpen(false)}
      />
      
      <div className="flex-1 flex flex-col">
        <Header 
          customer={customer} 
          onUploadClick={handleHeaderUploadClick}
          selectedCollection={selectedCollection}
          onCollectionChange={setSelectedCollection}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onToggleCustomersSidebar={() => setIsCustomerSidebarOpen(!isCustomerSidebarOpen)}
        />
        
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

            <SearchBar
              onSearch={handleSearch}
              placeholder="Search data..."
              disabled={loading}
            />

            {selectedCollection && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-medium text-blue-900">{selectedCollection.name}</h3>
                {selectedCollection.description && (
                  <p className="text-sm text-blue-700">{selectedCollection.description}</p>
                )}
              </div>
            )}

            {downloadLinks && <DownloadButtons links={downloadLinks} />}

            {loading && (
              <div className="mt-4">
                <p className="text-gray-500">Uploading and processing files...</p>
                <ProgressBar progress={uploadProgress} />
              </div>
            )}

            {data ? (
             <ClientTable 
               data={paginatedData} 
               isPostProcess={isPostProcess}
               sortField={sortField}
               sortDirection={sortDirection}
               onSort={handleSort}
             />
             
            ) : (
              <p className="mt-4 text-gray-500">
                {selectedCollection 
                  ? `No data found in "${selectedCollection.name}" collection.` 
                  : "Select a collection or upload PDFs to see the results."
                }
              </p>
            )}
          </div>
        </main>
        
        <Footer 
          customer={customer} 
          data={data} 
          isPostProcess={isPostProcess}
          onToggleProcess={handleToggleProcess}
          sortField={sortField}
          onClearSort={handleClearSort}
          selectedCollection={selectedCollection}
        />
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
      </div>
      <UploadedFilesSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} selectedCollection={selectedCollection} />
    </div>
  );
};

export default Home;
