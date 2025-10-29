// client/src/components/UploadedFilesSidebar.jsx
import React, { useState, useEffect } from 'react';
import { getUploadedFiles, reprocessFile } from '../api/documentApi';
import socket from '../services/websocket';

const UploadedFilesSidebar = ({ isOpen, onClose, selectedCollection }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && selectedCollection) {
      fetchFiles();
    }
  }, [isOpen, selectedCollection]);

  useEffect(() => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'FILES_PROCESSED' && message.collectionId === selectedCollection?.id) {
        fetchFiles();
      }
      if (message.type === 'FILE_REPROCESSED' && message.collectionId === selectedCollection?.id) {
        fetchFiles();
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
    <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-lg p-4 z-50 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Uploaded Files</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      {loading ? (
        <p>Loading files...</p>
      ) : (
        <div className="space-y-4">
          {files.map((file) => (
            <div key={file.id} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold">{file.original_filename}</p>
                  <p className="text-sm text-gray-500">
                    {new Date(file.created_at).toLocaleString()} &nbsp; {(file.file_size / 1024).toFixed(2)} KB
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button onClick={() => handleDownload(file)} title="Download" className="text-gray-500 hover:text-gray-700">
                    📄
                  </button>
                  {file.processing_status === 'failed' && (
                    <button onClick={() => handleReprocess(file.id)} title="Reprocess" className="text-gray-500 hover:text-gray-700">
                      🔄
                    </button>
                  )}
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      file.processing_status === 'completed'
                        ? 'text-green-800 bg-green-200'
                        : file.processing_status === 'processing'
                        ? 'text-yellow-800 bg-yellow-200'
                        : 'text-red-800 bg-red-200'
                    }`}
                  >
                    {file.processing_status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="absolute bottom-4 right-4">
        <button onClick={onClose} className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900">
          Close
        </button>
      </div>
    </div>
  );
};

export default UploadedFilesSidebar;
