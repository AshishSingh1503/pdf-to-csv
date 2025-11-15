import React, { useState, useRef, useEffect, useCallback } from "react";
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
import { TableSkeleton } from "../components/SkeletonLoader";
import EmptyState from "../components/EmptyState";

const Home = () => {
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedPdf] = useState(null);
  const fileInputRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPostProcess, setIsPostProcess] = useState(true);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCollectionsSidebar] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 50;
  const [downloadLinks] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [uploadStartTime, setUploadStartTime] = useState(null);

  // ✅ Batch Upload Logic
  const handleUpload = async (newFiles, collectionId) => {
    if (!newFiles.length) return;

    if (!collectionId) {
      console.error("Please select a collection before uploading files");
      return;
    }

    if (!customer && newFiles.length > 0) {
      const fileName = newFiles[0].name;
      const customerName = fileName.split("_")[0].replace(/-/g, " ");
      setCustomer({ name: customerName });
    }

  // Error handling strategy:
  // - Sidebar shows real-time processing status via WebSocket (queue position, progress, completion)
  // - Toast notifications only for: upload completion summary and actionable errors
  // - Let sidebar be the primary source of truth for processing status
  const BATCH_SIZE = 10; // limit per upload batch
    const fileChunks = [];
    for (let i = 0; i < newFiles.length; i += BATCH_SIZE) {
      fileChunks.push(newFiles.slice(i, i + BATCH_SIZE));
    }

  setTotalBatches(fileChunks.length);
  setUploadStartTime(Date.now());
  // Auto-open the uploaded files sidebar so users can see progress immediately
  setIsSidebarOpen(true);
    setLoading(true);
    setUploadProgress(0);
    setCurrentBatch(0);

  let abortedDueToCapacity = false;
  let successfulBatches = 0;
  let failedBatches = 0;

    for (let i = 0; i < fileChunks.length; i++) {
      const batch = fileChunks[i];
      setCurrentBatch(i + 1);
      console.log(`Uploading batch ${i + 1}/${fileChunks.length}...`);

      try {
        await uploadAndProcess(batch, collectionId, (progressEvent) => {
          setUploadProgress(prev => {
            try {
              if (progressEvent && progressEvent.total && progressEvent.total > 0) {
                const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                return Math.max(0, Math.min(100, pct));
              }
              if (progressEvent && typeof progressEvent.loaded === 'number' && progressEvent.loaded >= 0 && progressEvent.loaded <= 1) {
                return Math.max(0, Math.min(100, Math.round(progressEvent.loaded * 100)));
              }
            } catch (_err) {
              void _err;
            }
            return prev || 0;
          });
        });

        successfulBatches += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        failedBatches += 1;
        const resp = err && err.response;
        if (resp && resp.status === 503) {
          const d = resp.data || {};
          const serverMsg = d.error || d.message || 'Server is at capacity. Please try again in a few minutes.';
          console.error(`Batch ${i + 1} rejected: ${serverMsg}`);
          abortedDueToCapacity = true;
          break; 
        } else {
          console.error(`Batch ${i + 1} failed to upload:`, err.message);
        }
      }
    }

    const uploadSuccessful = successfulBatches > 0 && failedBatches === 0;

    // Refresh UI data independently of upload success; if fetch fails, warn but preserve upload success state
    const willRefresh = uploadSuccessful || abortedDueToCapacity;
    try {
      // Only attempt to refresh if uploads completed or we aborted due to capacity (so UI needs update)
      if (willRefresh) {
        await fetchData();
      }
    } catch (err) {
      // Don't surface a toast for refresh failures; sidebar (via WebSocket) is the single source of truth.
      console.error('Failed to refresh data after upload:', err);
    }

    // Final user-facing notifications based on upload outcome
    if (successfulBatches === fileChunks.length) {
      console.log(`✅ All ${successfulBatches} batches uploaded successfully (${newFiles.length} files).`);
    } else if (successfulBatches > 0) {
      console.warn(`⚠️ Partial upload complete: ${successfulBatches} of ${fileChunks.length} batches succeeded, ${failedBatches} failed.`);
    } else if (abortedDueToCapacity) {
      console.error('❌ Upload rejected: Server at capacity. Please try again in a few minutes.');
    } else {
      console.error(`❌ Upload failed: All ${failedBatches} batches failed.`);
    }

    // Cleanup UI state. If we triggered a data refresh, let fetchData() manage loading
    // to avoid brief flicker (it sets loading=true and clears it in its own finally).
    if (!willRefresh) {
      setLoading(false);
    }
    setUploadProgress(0);
    setCurrentBatch(0);
  };

  const handleHeaderUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const selectedFiles = [...e.target.files];
    if (selectedFiles.length > 0) {
      if (!selectedCollection) {
        console.error("Please select a collection before uploading files");
        return;
      }
      handleUpload(selectedFiles, selectedCollection.id);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const collectionId = selectedCollection ? selectedCollection.id : null;

      let postProcessData = [];
      let preProcessData = [];

      if (searchTerm) {
        const searchResult = await dataApi.search(
          searchTerm,
          collectionId,
          "both",
          currentPage,
          itemsPerPage
        );
        postProcessData = searchResult.data.postProcess || [];
        preProcessData = searchResult.data.preProcess || [];
        setTotalPages(searchResult.pagination.pages);
      } else {
        if (isPostProcess) {
          const result = await dataApi.getPostProcess(
            collectionId,
            null,
            currentPage,
            itemsPerPage
          );
          postProcessData = result.data;
          setTotalPages(result.pagination.pages);
        } else {
          const result = await dataApi.getPreProcess(
            collectionId,
            null,
            currentPage,
            itemsPerPage
          );
          preProcessData = result.data;
          setTotalPages(result.pagination.pages);
        }
      }

      setData({
        postProcessResults: postProcessData || [],
        preProcessResults: preProcessData || [],
      });
    } catch (error) {
      console.error("Error fetching data:", error);
      setData({ postProcessResults: [], preProcessResults: [] });
    } finally {
      setLoading(false);
    }
  }, [selectedCollection, searchTerm, currentPage, isPostProcess]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // keyboard shortcut: Ctrl/Cmd+U to open file upload
  useEffect(() => {
    const handler = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      if ((isMac && e.metaKey && e.key.toLowerCase() === 'u') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'u')) {
        e.preventDefault()
        fileInputRef.current?.click()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSearch = (term) => {
    setSearchTerm(term);
    setCurrentPage(1);
  };

  const handleCollectionSelect = (collection) => {
    setSelectedCollection(collection);
    setCurrentPage(1);
    setSearchTerm("");
  };

  const handleCustomerSelect = (customer) => {
    setSelectedCustomer(customer);
    setSelectedCollection(null);
  };

  

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleToggleProcess = () => {
    setIsPostProcess(!isPostProcess);
    setCurrentPage(1);
    setSortField(null);
    setSortDirection("asc");
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const handleClearSort = () => {
    setSortField(null);
    setSortDirection("asc");
    setCurrentPage(1);
  };

  const getCurrentData = () => {
    if (!data) return [];

    let sourceData = isPostProcess
      ? data.postProcessResults || []
      : data.preProcessResults || [];

    if (selectedPdf) {
      sourceData = sourceData.filter((item) => item.source === selectedPdf.name);
    }

    if (sortField) {
      sourceData = [...sourceData].sort((a, b) => {
        let aValue = a[sortField] || "";
        let bValue = b[sortField] || "";

        if (sortField === "dob" || sortField === "lastseen") {
          const aDate = new Date(aValue);
          const bDate = new Date(bValue);
          if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
            aValue = aDate;
            bValue = bDate;
          }
        } else if (sortField === "mobile") {
          aValue = aValue.replace(/\D/g, "");
          bValue = bValue.replace(/\D/g, "");
        }

        if (isPostProcess && (sortField === "first" || sortField === "last")) {
          aValue = a[sortField] || "";
          bValue = b[sortField] || "";
        } else if (!isPostProcess && sortField === "full_name") {
          aValue = a.full_name || "";
          bValue = b.full_name || "";
        }

        aValue = String(aValue).toLowerCase();
        bValue = String(bValue).toLowerCase();

        if (aValue < bValue) {
          return sortDirection === "asc" ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortDirection === "asc" ? 1 : -1;
        }
        return 0;
      });
    }

    return sourceData;
  };

  const paginatedData = getCurrentData();

  const [customersSidebarOpen, setCustomersSidebarOpen] = useState(true)

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-slate-50 dark:bg-slate-900">
      {showCollectionsSidebar && (
        <>
          {customersSidebarOpen && (
            <div className="fixed inset-0 bg-black/50 lg:hidden" onClick={() => setCustomersSidebarOpen(false)} aria-hidden="true" />
          )}
          <CustomersSidebar
            isOpen={customersSidebarOpen}
            onClose={() => setCustomersSidebarOpen(false)}
            selectedCustomer={selectedCustomer}
            onCustomerSelect={handleCustomerSelect}
            selectedCollection={selectedCollection}
            onCollectionSelect={handleCollectionSelect}
            onRefresh={fetchData}
          />
        </>
      )}

      <div className="flex-1 flex flex-col">
        <Header
          customer={customer}
          onUploadClick={handleHeaderUploadClick}
          selectedCollection={selectedCollection}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onToggleCustomersSidebar={() => {
            try {
              if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
                // desktop - no-op to avoid confusing users (sidebar is always visible on desktop)
                return;
              }
            } catch (_e) { void _e; }
            setCustomersSidebarOpen(prev => !prev)
          }}
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
              <div className="mb-4 p-3 bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-700 rounded-lg">
                <h3 className="font-medium text-blue-900 dark:text-slate-100">
                  {selectedCollection.name}
                </h3>
                {selectedCollection.description && (
                  <p className="text-sm text-blue-700 dark:text-slate-300">
                    {selectedCollection.description}
                  </p>
                )}
              </div>
            )}

            {downloadLinks && <DownloadButtons links={downloadLinks} />}

            {loading && (
              <div className="mt-4">
                <p className="text-gray-500 dark:text-slate-300">
                  Uploading and processing files...{" "}
                  {currentBatch > 0 && ` (Batch ${currentBatch} of ${totalBatches})`}
                </p>
                <ProgressBar
                  progress={uploadProgress}
                  showPercentage={true}
                  label={currentBatch > 0 ? `Batch ${currentBatch} of ${totalBatches}` : 'processing'}
                  estimatedTimeRemaining={uploadStartTime && currentBatch > 0 ? Math.round(((Date.now() - uploadStartTime) / currentBatch) * (totalBatches - currentBatch) / 1000) : null}
                />
              </div>
            )}

            {loading && !data ? (
              <TableSkeleton rows={10} columns={7} />
            ) : data ? (
              <ClientTable
                data={paginatedData}
                isPostProcess={isPostProcess}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            ) : (
              !loading && !data ? (
                <EmptyState
                  icon="📊"
                  title="No data available"
                  description={selectedCollection ? `No data found in "${selectedCollection.name}" collection.` : 'Select a collection or upload PDFs to see the results.'}
                />
              ) : null
            )}
          </div>
        </main>

        <Footer
          customer={customer}
          isPostProcess={isPostProcess}
          onToggleProcess={handleToggleProcess}
          sortField={sortField}
          onClearSort={handleClearSort}
          selectedCollection={selectedCollection}
        />
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </div>
      <UploadedFilesSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        selectedCollection={selectedCollection}
        onRefresh={fetchData}
        currentBatch={currentBatch}
        totalBatches={totalBatches}
      />
    </div>
  );
};

export default Home;
