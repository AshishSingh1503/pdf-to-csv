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
import { useToast } from "../contexts/ToastContext";
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
  const { showSuccess, showError } = useToast();

  // ✅ Batch Upload Logic
  const handleUpload = async (newFiles, collectionId) => {
    if (!newFiles.length) return;

    if (!collectionId) {
      showError("Please select a collection before uploading files");
      return;
    }

    if (!customer && newFiles.length > 0) {
      const fileName = newFiles[0].name;
      const customerName = fileName.split("_")[0].replace(/-/g, " ");
      setCustomer({ name: customerName });
    }

    const BATCH_SIZE = 25; // limit per upload batch
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

    try {
      let abortedDueToCapacity = false;
      for (let i = 0; i < fileChunks.length; i++) {
        const batch = fileChunks[i];
        setCurrentBatch(i + 1);
        console.log(`Uploading batch ${i + 1}/${fileChunks.length}...`);

        try {
          const data = await uploadAndProcess(batch, collectionId, (progressEvent) => {
            setUploadProgress(prev => {
              try {
                if (progressEvent && progressEvent.total && progressEvent.total > 0) {
                  const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                  return Math.max(0, Math.min(100, pct));
                }
                // Some XHR implementations may provide a fractional loaded (0-1)
                if (progressEvent && typeof progressEvent.loaded === 'number' && progressEvent.loaded >= 0 && progressEvent.loaded <= 1) {
                  return Math.max(0, Math.min(100, Math.round(progressEvent.loaded * 100)));
                }
              } catch (err) {
                // fall through to return previous
              }
              return prev || 0;
            });
          });

          // If server accepted but returned queued position, surface a light notification so users know ETA
          try {
            if (data && data.position !== undefined && data.position > 0) {
              const eta = data.estimatedWaitTime ? ` Estimated wait: ${data.estimatedWaitTime}s.` : '';
              showSuccess(`Batch queued at position ${data.position}.${eta}`);
            }
          } catch (e) {
            // ignore toast failures
          }

          // Optional pause between batches
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err) {
          // Axios-like error handling to detect HTTP 503 + queueFull responses
          const resp = err && err.response;
          if (resp && resp.status === 503) {
            const d = resp.data || {};
            const serverMsg = d.error || d.message || 'Server is at capacity. Please try again in a few minutes.';
            let extra = '';
            try {
              if (d.queueFull) {
                if (d.estimatedWaitTime) extra = ` Estimated wait: ${d.estimatedWaitTime}s.`;
                else if (typeof d.position === 'number') extra = ` Position: ${d.position}.`;
                else if (typeof d.queueLength === 'number') extra = ` Queue length: ${d.queueLength}.`;
              }
            } catch (e) {}

            showError(`Server busy: ${serverMsg}${extra}`);
            // stop further batches and let the upload UI reset in finally
            abortedDueToCapacity = true;
            break;
          }

          // For other errors, rethrow so outer catch handles generic failures
          throw err;
        }
      }

      await fetchData();
      if (!abortedDueToCapacity) {
        showSuccess(`✅ Successfully uploaded ${newFiles.length} file(s) in ${fileChunks.length} batch(es).`);
      } else {
        // If aborted due to capacity, refresh UI and notify user they can retry later
        showError('Upload paused: server at capacity. Some files may not have been queued. Please try again in a few minutes.');
      }
    } catch (error) {
      console.error("Upload error:", error);
      showError("❌ Failed to process some files. Please try again.");
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setCurrentBatch(0);
    }
  };

  const handleHeaderUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const selectedFiles = [...e.target.files];
    if (selectedFiles.length > 0) {
      if (!selectedCollection) {
        showError("Please select a collection before uploading files");
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
          onToggleCustomersSidebar={() => setCustomersSidebarOpen(prev => !prev)}
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
                  label={currentBatch > 0 ? `Batch ${currentBatch} of ${totalBatches}` : 'Uploading'}
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
        currentBatch={currentBatch}
        totalBatches={totalBatches}
      />
    </div>
  );
};

export default Home;
