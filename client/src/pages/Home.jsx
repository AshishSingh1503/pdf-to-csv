import React, { useState, useRef, useEffect } from "react";
import { uploadAndProcess } from "../api/documentApi";
import { dataApi } from "../api/collectionsApi";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import ClientTable from "../components/ClientTable";
import Pagination from "../components/Pagination";
import Footer from "../components/Footer";
import CollectionsSidebar from "../components/CollectionsSidebar";
import SearchBar from "../components/SearchBar";

const Home = () => {
  const [pdfs, setPdfs] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const fileInputRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPostProcess, setIsPostProcess] = useState(true);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCollectionsSidebar, setShowCollectionsSidebar] = useState(true);
  const itemsPerPage = 50;

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

    setPdfs(prevPdfs => [...prevPdfs, ...newFiles]);
    setLoading(true);
    
    try {
      const result = await uploadAndProcess(newFiles, collectionId);
      setData(prevData => ({
        ...result,
        postProcessResults: [...(prevData?.postProcessResults || []), ...result.postProcessResults],
        preProcessResults: [...(prevData?.preProcessResults || []), ...result.preProcessResults]
      }));
      
      // Refresh data from database
      await fetchData();
      
      alert(`Successfully processed ${newFiles.length} file(s) and saved to collection`);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to process files. Please try again.');
    } finally {
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

  // Fetch data from database
  const fetchData = async () => {
    try {
      setLoading(true);
      const collectionId = selectedCollection ? selectedCollection.id : null;
      
      let postProcessData = [];
      let preProcessData = [];
      
      if (searchTerm) {
        const searchResult = await dataApi.search(searchTerm, collectionId, 'both');
        postProcessData = searchResult.data.postProcess || [];
        preProcessData = searchResult.data.preProcess || [];
      } else {
        const [postResult, preResult] = await Promise.all([
          dataApi.getPostProcess(collectionId, null, currentPage, itemsPerPage),
          dataApi.getPreProcess(collectionId, null, currentPage, itemsPerPage)
        ]);
        postProcessData = postResult.data;
        preProcessData = preResult.data;
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

  // Load data when collection or search changes
  useEffect(() => {
    fetchData();
  }, [selectedCollection, searchTerm, currentPage]);

  const handleSearch = (term) => {
    setSearchTerm(term);
    setCurrentPage(1);
  };

  const handleCollectionSelect = (collection) => {
    setSelectedCollection(collection);
    setCurrentPage(1);
    setSearchTerm('');
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
    setCurrentPage(1); // Reset to first page when switching
    setSortField(null); // Reset sorting when switching
    setSortDirection('asc');
  };

  const handleSort = (field) => {
    if (sortField === field) {
      // If clicking the same field, toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // If clicking a new field, set it and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Reset to first page when sorting
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
    
    // Apply sorting if a sort field is selected
    if (sortField) {
      sourceData = [...sourceData].sort((a, b) => {
        let aValue = a[sortField] || '';
        let bValue = b[sortField] || '';
        
        // Handle special cases for sorting
        if (sortField === 'dob' || sortField === 'lastseen') {
          // For date fields, try to parse as dates
          const aDate = new Date(aValue);
          const bDate = new Date(bValue);
          if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
            aValue = aDate;
            bValue = bDate;
          }
        } else if (sortField === 'mobile') {
          // For mobile numbers, extract digits for comparison
          aValue = aValue.replace(/\D/g, '');
          bValue = bValue.replace(/\D/g, '');
        }
        
        // Handle name fields differently for pre/post process
        if (isPostProcess && (sortField === 'first' || sortField === 'last')) {
          aValue = a[sortField] || '';
          bValue = b[sortField] || '';
        } else if (!isPostProcess && sortField === 'full_name') {
          aValue = a.full_name || '';
          bValue = b.full_name || '';
        }
        
        // Convert to strings for comparison
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

  const filteredData = getCurrentData();
  
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Collections Sidebar */}
      {showCollectionsSidebar && (
        <CollectionsSidebar
          selectedCollection={selectedCollection}
          onCollectionSelect={handleCollectionSelect}
          onRefresh={fetchData}
        />
      )}
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <Header 
          customer={customer} 
          onUploadClick={handleHeaderUploadClick}
          selectedCollection={selectedCollection}
          onCollectionChange={setSelectedCollection}
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

            {/* Search Bar */}
            <SearchBar
              onSearch={handleSearch}
              placeholder="Search data..."
              disabled={loading}
            />

            {/* Collection Info */}
            {selectedCollection && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-medium text-blue-900">{selectedCollection.name}</h3>
                {selectedCollection.description && (
                  <p className="text-sm text-blue-700">{selectedCollection.description}</p>
                )}
              </div>
            )}

            {loading && <p className="mt-4 text-gray-500">Loading data...</p>}

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
        />
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
      </div>
    </div>
  );
};

export default Home;
