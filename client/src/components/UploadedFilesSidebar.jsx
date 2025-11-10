// client/src/components/UploadedFilesSidebar.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getUploadedFiles, getBatchStatus } from '../api/documentApi';
import socket from '../services/websocket';
import ProgressBar from './ProgressBar';
import { FileCardSkeleton } from './SkeletonLoader'
import EmptyState from './EmptyState'

const UploadedFilesSidebar = ({ isOpen, onClose, selectedCollection, currentBatch = 0, totalBatches = 0 }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeBatches, setActiveBatches] = useState({});
  const activeBatchesRef = useRef(activeBatches);
  const [batchMessages, setBatchMessages] = useState([]);
  const timeoutsRef = useRef([]);
  const fetchTimerRef = useRef(null);

  // Clear batch state when the selected collection or sidebar open state changes
  // Note: intentionally depend only on selectedCollection and isOpen so that changes
  // to function identities (fetchFiles/scheduleFetchFiles) don't reset the UI.
  useEffect(() => {
    setActiveBatches({});
    setBatchMessages([]);
  }, [selectedCollection, isOpen]);

  // keep a ref copy of activeBatches for use inside the WS handler (avoids stale closures)
  useEffect(() => {
    activeBatchesRef.current = activeBatches;
  }, [activeBatches]);

  // fetchFiles is stable via useCallback below and used by the WS handler
  useEffect(() => {
    if (isOpen && selectedCollection) {
      fetchFiles();
    }
  }, [isOpen, selectedCollection, fetchFiles]);

  useEffect(() => {
    const handler = (event) => {
      try {
        const message = JSON.parse(event.data);

  // Expect server to use camelCase top-level keys
  const collectionId = message.collectionId;
  const batchId = message.batchId;

        // Determine whether this message should be applied to the currently selected collection.
        // Behavior:
        // - If a collectionId is present, it must match the selectedCollection.id.
        // - If collectionId is missing, only accept the event if the batchId is already tracked
        //   in activeBatches for this UI (prevents STARTED events without collectionId from showing up).
        let matchesCollection = false;
        if (selectedCollection) {
          if (collectionId !== undefined) {
            matchesCollection = Number(collectionId) === Number(selectedCollection.id);
          } else if (batchId && activeBatchesRef.current && activeBatchesRef.current[batchId]) {
            // Accept events for batches we already track locally
            matchesCollection = true;
          }
        }

        // Batch-level events
        if (message.type === 'BATCH_PROCESSING_STARTED' && matchesCollection) {
          if (!batchId) return;
          const batch = {
            batchId: batchId,
            status: 'started',
            message: message.message || `Processing batch started (${message.fileCount || 0} files)`,
            fileCount: message.fileCount || 0,
            // prefer server-provided startedAt so elapsed time is accurate when opening mid-batch
            startTime: message.startedAt ? new Date(message.startedAt) : new Date(),
            lastUpdate: new Date(),
          };
          setActiveBatches(prev => ({ ...prev, [batchId]: { ...(prev[batchId] || {}), ...batch } }));
          setBatchMessages(prev => [{ text: batch.message, type: 'info', ts: Date.now() }, ...prev].slice(0, 5));
        }

        if (message.type === 'BATCH_PROCESSING_PROGRESS' && matchesCollection) {
          if (!batchId) return;
          const progressVal = message.progress ?? message.percent;
          setActiveBatches(prev => {
            const copy = { ...prev };
      if (!copy[batchId]) {
              // create placeholder if missing. Prefer server-provided startedAt; otherwise leave undefined
                copy[batchId] = {
                  batchId,
                  status: message.status || 'processing',
                  message: message.message || 'Processing...',
                  fileCount: message.fileCount || 0,
                  progress: typeof progressVal === 'number' ? progressVal : (progressVal ? Number(progressVal) : undefined),
                  startTime: message.startedAt ? new Date(message.startedAt) : undefined,
                  lastUpdate: new Date(),
                };
                // If server didn't provide startedAt and we don't yet know fileCount/progress, try hydrating from batch endpoint
                if (!message.startedAt) {
                  (async () => {
                    try {
                      const resp = await getBatchStatus(batchId);
                      if (resp && resp.success) {
                        setActiveBatches(prev => {
                          const copy2 = { ...prev };
                          const existing = copy2[batchId] || {};
                          const counts = resp.counts || {};
                          const files = resp.files || [];
                          const total = counts.total || files.length || existing.fileCount || 0;
                          const processed = (counts.completed || 0) + (counts.failed || 0);
                          const p = total > 0 ? Math.round((processed / total) * 100) : existing.progress;
                          copy2[batchId] = {
                            ...existing,
                            fileCount: total,
                            progress: typeof p === 'number' ? p : existing.progress,
                            // prefer server-provided startedAt when present
                            startTime: resp.startedAt ? new Date(resp.startedAt) : existing.startTime,
                            lastUpdate: new Date(),
                          };
                          return copy2;
                        });
                        // hydrate files into the file list if we currently have none
                        setFiles(prev => {
                          if (!prev || prev.length === 0) {
                            return resp.files || prev;
                          }
                          return prev;
                        });
                      }
                    } catch (err) {
                      console.warn('Batch hydration failed', err);
                    }
                  })();
                }
            } else {
              copy[batchId] = {
                ...copy[batchId],
                status: message.status || copy[batchId].status,
                message: message.message || copy[batchId].message,
                progress: typeof progressVal === 'number' ? progressVal : (progressVal ? Number(progressVal) : copy[batchId].progress),
                // only set startTime if server gives one and we don't already have it
                startTime: copy[batchId].startTime || (message.startedAt ? new Date(message.startedAt) : copy[batchId].startTime),
                lastUpdate: new Date(),
              };
            }
            return copy;
          });

          if (message.status === 'database_insert_complete' || message.status === 'cloud_upload_complete') {
            const msg = message.status === 'database_insert_complete' ? 'Records inserted into database' : 'Files uploaded to cloud';
            setBatchMessages(prev => [{ text: msg, type: 'info', ts: Date.now() }, ...prev].slice(0, 5));
          }
        }

        if (message.type === 'BATCH_PROCESSING_COMPLETED' && matchesCollection) {
          if (!batchId) return;
          setActiveBatches(prev => {
            const copy = { ...prev };
            delete copy[batchId];
            return copy;
          });
          const ts = Date.now();
          setBatchMessages(prev => [{ text: `✅ Batch completed successfully (${message.fileCount || 0} files)`, type: 'success', ts }, ...prev].slice(0, 5));
          // refresh files list (debounced)
          scheduleFetchFiles();
          // auto remove success message after 5s — capture ts to remove specific one
          const tid = setTimeout(() => {
            setBatchMessages(prev => prev.filter(m => m.ts !== ts));
          }, 5000);
          timeoutsRef.current.push(tid);
        }

        if (message.type === 'BATCH_PROCESSING_FAILED' && matchesCollection) {
          if (!batchId) return;
          setActiveBatches(prev => {
            const copy = { ...prev };
            delete copy[batchId];
            return copy;
          });
          setBatchMessages(prev => [{ text: `❌ Batch processing failed: ${message.error || 'unknown'}`, type: 'error', ts: Date.now() }, ...prev].slice(0, 5));
          scheduleFetchFiles();
        }

        // Individual file events (backwards compatibility)
        if (message.type === 'FILES_PROCESSED') {
          // Server should provide fileMetadata as camelCase, but fall back to legacy if present
          const meta = message.fileMetadata || message.file_metadata || {};
          const metaCollection = meta.collectionId ?? meta.collection_id ?? undefined;
          const metaId = meta.id;

          // If a collectionId is present in the message, prefer that matching path.
          if (collectionId !== undefined && selectedCollection) {
            if (!matchesCollection) return;
          } else if (metaCollection !== undefined && selectedCollection) {
            // If the message contains a collection id, verify it matches the currently selected collection.
            if (Number(metaCollection) !== Number(selectedCollection.id)) return;
          }

          // At this point either the collection matched or collection info wasn't available.
          // Proceed cautiously: update only if the file id exists in our current file list.
          if (!metaId) return;
          setFiles(prevFiles => {
            const found = prevFiles.find(f => f.id === metaId);
            const newStatus = meta.processingStatus ?? meta.processing_status;
            if (!found) {
              // If the file isn't present yet, schedule a fetch to refresh the list (debounced).
              // If our local list is empty, fetch immediately to populate UI.
              if (!prevFiles || prevFiles.length === 0) {
                fetchFiles();
              } else {
                scheduleFetchFiles();
              }
              return prevFiles;
            }
            return prevFiles.map(file => file.id === metaId ? { ...file, processing_status: newStatus ?? file.processing_status } : file);
          });
        }
        if (message.type === 'FILE_REPROCESSED' && matchesCollection) {
          fetchFiles();
        }
        if (message.type === 'WS_RECONNECTED') {
          // On reconnect, refresh files to avoid missed events while disconnected
          scheduleFetchFiles();
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
          } catch (err) {
            console.warn('Failed to handle WS message', err);
          }
    };

    socket.subscribe(handler);
    // Hydrate from buffered events for this collection so sidebar doesn't miss history.
    try {
      if (selectedCollection) {
        if (typeof socket.getBufferedEventsForCollection === 'function') {
          const buffered = socket.getBufferedEventsForCollection(selectedCollection.id) || [];
          // replay older -> newer
          buffered.slice().reverse().forEach(ev => {
            try { handler({ data: JSON.stringify(ev.msg) }); } catch (err) { console.warn('Failed to replay buffered event', err); }
          });
        } else {
          // If buffering isn't available, proactively refresh the file list to avoid missed updates
          scheduleFetchFiles();
        }
      }
    } catch (err) {
      console.warn('⚠️  Failed to hydrate from buffered WS events:', err && err.message);
      // Fallback: ensure file list is refreshed
      scheduleFetchFiles();
    }
    return () => {
      socket.unsubscribe(handler);
      // clear any timeouts
      (timeoutsRef.current || []).forEach(t => clearTimeout(t));
      timeoutsRef.current = [];
      if (fetchTimerRef.current) {
        try { clearTimeout(fetchTimerRef.current); } catch (err) { console.warn('clearTimeout error', err); }
        fetchTimerRef.current = null;
      }
    };
  }, [selectedCollection, isOpen, fetchFiles, scheduleFetchFiles]);

  // stable fetchFiles so we can reference it safely in effects/handlers
  const fetchFiles = useCallback(async () => {
    if (!selectedCollection) return;
    setLoading(true);
    try {
      const fetchedFiles = await getUploadedFiles(selectedCollection.id);
      setFiles(fetchedFiles);
    } catch (error) {
      console.error('Error fetching uploaded files:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCollection]);

  const scheduleFetchFiles = useCallback(() => {
    try {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    } catch (err) { console.warn('clearTimeout error', err); }
    fetchTimerRef.current = setTimeout(() => {
      fetchFiles();
      fetchTimerRef.current = null;
    }, 350);
  }, [fetchFiles]);

  // removed unused/redundant handlers (re-enable when UI supports them)

  const formatElapsedTime = (startTime) => {
    if (!startTime) return '';
    const diff = Date.now() - new Date(startTime).getTime();
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins > 0) return `${mins}m ${remSecs}s`;
    return `${remSecs}s`;
  };

  const dismissMessage = (ts) => {
    setBatchMessages(prev => prev.filter(m => m.ts !== ts));
  };

  const getActiveBatchCount = () => Object.keys(activeBatches).length;

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 sm:hidden" onClick={onClose} />}
      <div className={`fixed top-0 right-0 h-full w-full sm:w-96 max-w-full bg-white dark:bg-gray-800 dark:text-white shadow-lg p-4 z-50 overflow-y-auto ${!isOpen ? 'hidden' : ''}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold dark:text-white">Uploaded Files</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white">
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
        <div className="space-y-4 pb-20"> {/* added bottom padding so floating button doesn’t overlap */}

          {/* Batch Status Section */}
          {(getActiveBatchCount() > 0 || (currentBatch > 0 && totalBatches > 0)) && (
            <div className="mb-4 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm dark:text-slate-100">Processing batches ({getActiveBatchCount()})</h3>
                {(currentBatch > 0 && totalBatches > 0) && (
                  <div className="text-xs text-blue-700 dark:text-slate-300">Batch {currentBatch} of {totalBatches} processing…</div>
                )}
              </div>
              <div className="space-y-2">
                      {Object.values(activeBatches).map(batch => (
                  <div key={batch.batchId} className="flex flex-col p-2 bg-white dark:bg-gray-800 dark:border-gray-600 rounded shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-3 h-3 rounded-full animate-pulse bg-blue-500" />
                        <div>
                          <div className="text-sm font-medium dark:text-slate-100">{batch.message}</div>
                          <div className="text-xs text-gray-500 dark:text-slate-300">{batch.fileCount} files {batch.startTime ? `• ${formatElapsedTime(batch.startTime)} ago` : ''}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-slate-300">{batch.status}</div>
                    </div>

                    {/* Progress indicator: show ProgressBar with label, percentage and ETA when available */}
                    {typeof batch.progress === 'number' ? (() => {
                      const now = Date.now();
                      let eta = null;
                      if (batch.startTime && typeof batch.progress === 'number' && batch.progress > 0) {
                        const elapsedSecs = Math.max(1, Math.floor((now - new Date(batch.startTime).getTime()) / 1000));
                        eta = Math.round(elapsedSecs * (100 / batch.progress - 1));
                        if (!isFinite(eta) || eta < 0) eta = null;
                      }
                      return (
                        <div className="mt-2">
                          <ProgressBar progress={batch.progress} showPercentage={true} label={batch.message || 'Processing'} estimatedTimeRemaining={eta} />
                        </div>
                      )
                    })() : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Batch Messages */}
          {batchMessages.length > 0 && (
            <div className="mb-4 p-2">
              {batchMessages.slice(0, 5).map((m) => (
                <div key={m.ts} className={`flex items-start justify-between p-2 mb-2 rounded ${m.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : m.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200'}`}>
                  <div>
                    <div className="text-sm">{m.text}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-300">{new Date(m.ts).toLocaleTimeString()}</div>
                  </div>
                  <div>
                    <button onClick={() => dismissMessage(m.ts)} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200">x</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isOpen && loading && <FileCardSkeleton count={5} />}

          {files.map((file) => {
            const safeStatus = (file.processing_status || '').trim();
            return (
            <div key={file.id} className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800 dark:border-gray-600 text-gray-900 dark:text-white">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold">{file.original_filename}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(file.created_at).toLocaleString()} &nbsp; {(file.file_size / 1024).toFixed(2)} KB
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  {/* <button onClick={() => handleDownload(file)} title="Download" className="text-gray-500 hover:text-gray-700">
                    📄
                  </button>
                  {file.processing_status === 'failed' && (
                    <button onClick={() => handleReprocess(file.id)} title="Reprocess" className="text-gray-500 hover:text-gray-700">
                      🔄
                    </button>
                  )} */}
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      safeStatus === 'completed'
                        ? 'text-green-800 bg-green-200 dark:text-green-200 dark:bg-green-900/20'
                        : safeStatus === 'processing'
                        ? 'text-yellow-800 bg-yellow-200 dark:text-yellow-300 dark:bg-yellow-900/40'
                        : 'text-red-800 bg-red-200 dark:text-red-200 dark:bg-red-900/20'
                    }`}
                  >
                    {safeStatus}
                  </span>
                </div>
              </div>
              {(safeStatus === 'processing' && typeof file.upload_progress === 'number') && (
                <div className="mt-2">
                  <ProgressBar progress={file.upload_progress} />
                </div>
              )}
            </div>
          )})}

          {(!loading && (!files || files.length === 0)) && (
            <EmptyState icon="📄" title="No files uploaded yet" description="Upload PDF files to see them here" />
          )}
        </div>
      </div>
      {/* ✅ Floating Close Button — fixed properly */}
      {isOpen && (
        <button
          onClick={onClose}
          className="fixed bottom-6 right-6 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-gray-900 dark:bg-slate-700 dark:hover:bg-slate-600 transition-all z-50 min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close uploaded files sidebar"
        >
          Close
        </button>
      )}
    </>
  );
};

export default UploadedFilesSidebar;
