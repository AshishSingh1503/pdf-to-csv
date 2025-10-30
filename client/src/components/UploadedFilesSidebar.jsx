// client/src/components/UploadedFilesSidebar.jsx
import React, { useState, useEffect } from 'react';
import { getUploadedFiles, reprocessFile } from '../api/documentApi';
import socket from '../services/websocket';
import ProgressBar from './ProgressBar';

const UploadedFilesSidebar = ({ isOpen, onClose, selectedCollection }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processingInfo, setProcessingInfo] = useState({ processed: 0, total: 0, estimatedTimeLeft: 0 });

  useEffect(() => {
    if (isOpen && selectedCollection) {
      fetchFiles();
    }
  }, [isOpen, selectedCollection]);

  useEffect(() => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'FILE_PROCESSED') {
        setFiles(prevFiles => {
          return prevFiles.map(file => {
            if (file.id === message.fileMetadata.id) {
              return { ...file, ...message.fileMetadata, timeTaken: message.timeTaken };
            }
            return file;
          });
        });
        setProcessingInfo(message.progress);
      }

      if (message.type === 'ALL_FILES_PROCESSED' && message.collectionId === selectedCollection?.id) {
        fetchFiles();
        setProcessingInfo({ processed: 0, total: 0, estimatedTimeLeft: 0 });
      }
      
      if (message.type === 'FILE_REPROCESSED' && message.collectionId === selectedCollection?.id) {
        fetchFiles();
      }
      if (message.type === 'UPLOAD_PROGRESS') {
        setFiles(prevFiles => {
          return prevFiles.map(file => {
            if (file.id === message.fileId) {
              return { ...file, upload_progress: message.progress };
            }
            return file;
          });
        });
      }
    };
  }, [selectedCollection]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const fetchedFiles = await getUploadedFiles(selectedCollection.id);
      setFiles(fetchedFiles);
    } catch (error) {
      console.error('Error fetching uploaded files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReprocess = async (fileId) => {
    try {
      await reprocessFile(fileId);
      alert(`File ${fileId} is being reprocessed.`);
    } catch (error) {
      console.error('Error reprocessing file:', error);
      alert('Failed to reprocess file.');
    }
  };

  const handleDownload = (file) => {
    // Implement download logic here
    window.open(file.cloud_storage_path, '_blank');
  };

  if (!isOpen) {
    return null;
  }

   return (
      <>
        {/* Overlay for mobile */}
        {isOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={onClose}
          />
        )}
  
        <div
          className={`fixed top-0 right-0 h-full bg-white shadow-lg z-50 overflow-y-auto transition-transform duration-300 ease-in-out transform ${
            isOpen ? "translate-x-0" : "translate-x-full"
          } w-full md:w-96 flex flex-col`}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Uploaded Files</h2>
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Close sidebar"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {processingInfo.total > 0 && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium text-blue-900">
                  Processing: {processingInfo.processed} of {processingInfo.total} files
                </p>
                <p className="text-xs text-blue-700">
                  Estimated time left: {Math.round(processingInfo.estimatedTimeLeft)}s
                </p>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No files uploaded yet
              </div>
            ) : (
              <div className="space-y-3">
                {files.map((file) => (
                  <div key={file.id} className="border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {file.original_filename}
                        </p>
                        <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                          <span>{new Date(file.created_at).toLocaleString()}</span>
                          <span>{(file.file_size / 1024).toFixed(2)} KB</span>
                          {file.timeTaken && <span>Time: {file.timeTaken.toFixed(2)}s</span>}
                        </div>
                      </div>
  
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {file.processing_status === 'failed' && (
                          <button 
                            onClick={() => handleReprocess(file.id)}
                            className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                            title="Reprocess"
                          >
                            {/* <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg> */}
                          </button>
                        )}
  
                        {file.processing_status === 'processing' ? (
                          <div className="flex items-center gap-2">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-yellow-700"></div>
                            <span className="text-xs font-medium text-yellow-700">Processing...</span>
                          </div>
                        ) : (
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              file.processing_status === 'completed'
                                ? 'text-green-700 bg-green-100'
                                : 'text-red-700 bg-red-100'
                            }`}
                          >
                            {file.processing_status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
  
          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
            <button 
              onClick={onClose}
              className="w-full bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              Close
            </button>
          </div>
        </div>
      </>
    );
  };

export default UploadedFilesSidebar;
