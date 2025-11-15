// client/src/components/UploadedFilesSidebar.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getUploadedFiles, getBatchStatus, reprocessFile } from '../api/documentApi';
import socket from '../services/websocket';
import ProgressBar from './ProgressBar';
import EmptyState from './EmptyState'

const ReprocessButton = ({ file, onReprocess }) => {
  const [isReprocessing, setIsReprocessing] = useState(false);

  const handleReprocessClick = async (e) => {
    e.stopPropagation();
    if (isReprocessing) return;
    setIsReprocessing(true);
    try {
      await onReprocess(file.id);
    } catch (error) {
      console.error(`Reprocessing failed for file ${file.id}:`, error);
      // Optionally show a toast or message to the user
    } finally {
      setIsReprocessing(false);
    }
  };

  const isTerminalStatus = file.processing_status === 'completed' || file.processing_status === 'failed';
  const canReprocess = isTerminalStatus && file.cloud_storage_path_raw;
  const tooltipText = !isTerminalStatus
    ? 'File must be in a "completed" or "failed" state to reprocess.'
    : !file.cloud_storage_path_raw
    ? 'Raw PDF removed - reprocess unavailable.'
    : 'Reprocess this file';

  return (
    <div className="relative group">
      <button
        onClick={handleReprocessClick}
        disabled={!canReprocess || isReprocessing}
        className={`px-2 py-1 text-xs font-semibold rounded ${
          canReprocess
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-600 dark:text-gray-500'
        }`}
      >
        {isReprocessing ? '...' : 'Reprocess'}
      </button>
      <div className="absolute bottom-full mb-2 w-max px-2 py-1 bg-gray-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {tooltipText}
      </div>
    </div>
  );
};


const UploadedFilesSidebar = ({ isOpen, onClose, selectedCollection, onRefresh, currentBatch = 0, totalBatches = 0 }) => {
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

  // fetchFiles is stable via useCallback below and used by the WS handler
  useEffect(() => {
    if (isOpen && selectedCollection) {
      fetchFiles();
    }
  }, [isOpen, selectedCollection, fetchFiles]);

  useEffect(() => {
    const handler = async (event) => {
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

        // Edge-case handling: Sometimes the server emits BATCH_PROCESSING_STARTED or
        // BATCH_PROCESSING_PROGRESS without a collectionId and before this UI has
        // observed the queued event. In that case try to hydrate the batch from the
        // server and seed a minimal activeBatches entry so the event is applied to
        // the currently selected collection.
        if (!matchesCollection && selectedCollection && !collectionId && batchId &&
            (message.type === 'BATCH_PROCESSING_STARTED' || message.type === 'BATCH_PROCESSING_PROGRESS')) {
          try {
            const resp = await getBatchStatus(batchId);
            const respCollection = resp && (resp.collectionId ?? resp.collection_id ?? resp.collection);
            if (resp && (resp.success === undefined || resp.success) && respCollection !== undefined && Number(respCollection) === Number(selectedCollection.id)) {
              // Seed a minimal batch entry so the rest of the handler can proceed
              const counts = resp.counts || {};
              const files = resp.files || [];
              const total = counts.total || files.length || message.fileCount || 0;
              const startedAt = resp.startedAt ? new Date(resp.startedAt) : (message.startedAt ? new Date(message.startedAt) : undefined);
              const seed = {
                batchId,
                status: message.status || 'processing',
                queueStatus: 'processing',
                message: message.message || 'Processing...',
                fileCount: total,
                progress: typeof message.progress === 'number' ? message.progress : undefined,
                startTime: startedAt,
                lastUpdate: new Date(),
              };
              setActiveBatches(prev => ({ ...prev, [batchId]: { ...(prev[batchId] || {}), ...seed } }));
              matchesCollection = true;
            }
          } catch (err) {
            console.warn('Failed to hydrate batch for missing collectionId', err);
          }
        }

        // Batch-level events
        if (message.type === 'BATCH_PROCESSING_STARTED' && matchesCollection) {
          if (!batchId) return;
          const existing = activeBatchesRef.current && activeBatchesRef.current[batchId];
          const merged = {
            batchId: batchId,
            status: 'started',
            queueStatus: 'processing',
            message: message.message || `Processing batch started (${message.fileCount || 0} files)`,
            fileCount: message.fileCount || (existing ? existing.fileCount : 0),
            // prefer server-provided startedAt so elapsed time is accurate when opening mid-batch
            startTime: message.startedAt ? new Date(message.startedAt) : (existing ? existing.startTime : new Date()),
            lastUpdate: new Date(),
            // drop queue-specific fields when transitioning to processing
            queuePosition: undefined,
            estimatedWaitTime: undefined,
            totalQueued: undefined,
            progress: existing ? existing.progress : undefined,
          };
          setActiveBatches(prev => ({ ...prev, [batchId]: { ...(prev[batchId] || {}), ...merged } }));
          addOrReplaceMessage({ text: merged.message, type: 'info', ts: Date.now(), batchId });
        }

        // New: Batch queued (position/ETA)
        if (message.type === 'BATCH_QUEUED' && matchesCollection) {
          if (!batchId) return;
          const position = message.position ?? message.queuePosition ?? undefined;
          const estimated = message.estimatedWaitTime ?? message.estimated_wait_time ?? undefined;
          const totalQueued = message.totalQueued ?? message.total_queued ?? undefined;
          const enqueuedAt = message.timestamp ? new Date(message.timestamp) : new Date();
          const batchObj = {
            batchId,
            status: 'queued',
            queueStatus: 'queued',
            message: message.message || `Queued for processing (${message.fileCount || 0} files)`,
            fileCount: message.fileCount || 0,
            queuePosition: typeof position === 'number' ? position : undefined,
            estimatedWaitTime: typeof estimated === 'number' ? estimated : undefined,
            totalQueued: typeof totalQueued === 'number' ? totalQueued : undefined,
            enqueuedAt,
            lastUpdate: new Date(),
          };
          setActiveBatches(prev => ({ ...prev, [batchId]: { ...(prev[batchId] || {}), ...batchObj } }));
          addOrReplaceMessage({ text: `📋 Batch queued (position ${batchObj.queuePosition ?? '?'})`, type: 'info', ts: Date.now(), batchId });
        }

        // New: Queue full error broadcast from server (not gated by collection)
        if (message.type === 'QUEUE_FULL') {
          try {
            const serverMsg = message.message || 'Upload rejected: Server at capacity. Try again in a few minutes.';
            const ts = Date.now();
            // Push an error message visible regardless of selected collection; do NOT auto-dismiss
            addOrReplaceMessage({ text: serverMsg, type: 'error', ts, scope: 'global' });
          } catch (err) {
            console.warn('Failed to handle QUEUE_FULL message', err);
          }
        }

        // Note: BATCH_DEQUEUED events are intentionally ignored here. The server
        // emits a dequeued event as part of the normal queued->processing transition
        // and it is followed immediately by BATCH_PROCESSING_STARTED. Handling
        // dequeued as a transient cancellation caused confusing warnings in the UI,
        // so we do not act on it.

        // New: Queue position updated for existing queued batches
        if (message.type === 'BATCH_QUEUE_POSITION_UPDATED' && matchesCollection) {
          if (!batchId) return;
          const position = message.position ?? undefined;
          const estimated = message.estimatedWaitTime ?? message.estimated_wait_time ?? undefined;
          const totalQueued = message.totalQueued ?? message.total_queued ?? undefined;
          setActiveBatches(prev => {
            const copy = { ...prev };
            const existing = copy[batchId];
            if (!existing) return prev; // ignore updates for unknown batches
            if (existing.queueStatus && existing.queueStatus !== 'queued') return prev; // ignore if already processing/finished
            const newPos = typeof position === 'number' ? position : existing.queuePosition;
            const newEst = typeof estimated === 'number' ? estimated : existing.estimatedWaitTime;
            const newTotal = typeof totalQueued === 'number' ? totalQueued : existing.totalQueued;
            // only update if something changed to avoid re-renders
            if (newPos === existing.queuePosition && newEst === existing.estimatedWaitTime && newTotal === existing.totalQueued) return prev;
            copy[batchId] = { ...existing, queuePosition: newPos, estimatedWaitTime: newEst, totalQueued: newTotal, lastUpdate: new Date() };
            // optionally add a subtle message if position improved noticeably
            if (existing.queuePosition && typeof newPos === 'number' && newPos < existing.queuePosition) {
              addOrReplaceMessage({ text: `📈 Queue position updated: ${newPos}`, type: 'info', ts: Date.now(), batchId });
            }
            return copy;
          });
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
                  queueStatus: 'processing',
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
              const existing = copy[batchId] || {};
              // If the batch is not already in a terminal state, ensure queueStatus reflects processing
              const terminal = existing.queueStatus === 'completed' || existing.queueStatus === 'failed';
              copy[batchId] = {
                ...existing,
                status: message.status || existing.status,
                // only set queueStatus to 'processing' if not terminal and not already set
                queueStatus: terminal ? existing.queueStatus : (existing.queueStatus || 'processing'),
                message: message.message || existing.message,
                progress: typeof progressVal === 'number' ? progressVal : (progressVal ? Number(progressVal) : existing.progress),
                // only set startTime if server gives one and we don't already have it
                startTime: existing.startTime || (message.startedAt ? new Date(message.startedAt) : existing.startTime),
                lastUpdate: new Date(),
              };
            }
            return copy;
          });

          if (message.status === 'database_insert_complete' || message.status === 'cloud_upload_complete') {
            const msg = message.status === 'database_insert_complete' ? 'Records inserted into database' : 'Files uploaded to cloud';
            addOrReplaceMessage({ text: msg, type: 'info', ts: Date.now(), batchId });
          }
        }

        if (message.type === 'BATCH_PROCESSING_COMPLETED' && matchesCollection) {
          if (!batchId) return;
          // mark completed briefly then remove for a smooth UI transition
          const ts = Date.now();
          setActiveBatches(prev => {
            const copy = { ...prev };
            if (copy[batchId]) {
              copy[batchId] = { ...copy[batchId], queueStatus: 'completed', lastUpdate: new Date() };
            }
            return copy;
          });
          addOrReplaceMessage({ text: `✅ Batch completed successfully (${message.fileCount || 0} files)`, type: 'success', ts, batchId });
          // remove after short delay so user sees completion state
          const removeTid = setTimeout(() => {
            setActiveBatches(prev => {
              const copy = { ...prev };
              delete copy[batchId];
              return copy;
            });
          }, 500);
          timeoutsRef.current.push(removeTid);
          // refresh files list (debounced)
          scheduleFetchFiles();
          if (onRefresh) onRefresh();
          // auto remove success message after 5s — capture ts to remove specific one
          const tid = setTimeout(() => {
            // dismiss by batchId so we remove the consolidated batch message
            dismissMessage(batchId);
          }, 5000);
          timeoutsRef.current.push(tid);
        }

        if (message.type === 'BATCH_PROCESSING_FAILED' && matchesCollection) {
          if (!batchId) return;
          // show failed state before removing
          setActiveBatches(prev => {
            const copy = { ...prev };
            if (copy[batchId]) {
              copy[batchId] = { ...copy[batchId], queueStatus: 'failed', lastUpdate: new Date() };
            }
            return copy;
          });
          addOrReplaceMessage({ text: `❌ Batch processing failed: ${message.error || 'unknown'}`, type: 'error', ts: Date.now(), batchId });
          const removeFailTid = setTimeout(() => {
            setActiveBatches(prev => {
              const copy = { ...prev };
              delete copy[batchId];
              return copy;
            });
          }, 10000);
          timeoutsRef.current.push(removeFailTid);
          scheduleFetchFiles();
          if (onRefresh) onRefresh();
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
          if (onRefresh) onRefresh();
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


  const handleReprocess = async (fileId) => {
    try {
      await reprocessFile(fileId);
      // The websocket will update the file status, but we can also optimistically update it here
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, processing_status: 'reprocessing' } : f));
    } catch (error) {
      console.error('Error reprocessing file:', error);
      // You might want to show a toast notification to the user here
    }
  };

  const formatElapsedTime = (startTime) => {
    if (!startTime) return '';
    const diff = Date.now() - new Date(startTime).getTime();
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins > 0) return `${mins}m ${remSecs}s`;
    return `${remSecs}s`;
  };

  const formatWaitTime = (seconds) => {
    if (seconds === null || seconds === undefined) return '';
    const s = Number(seconds);
    if (!isFinite(s)) return '';
    if (s < 60) return '<1 min';
    if (s < 3600) {
      const m = Math.round(s / 60);
      return `~${m} min`;
    }
    const hrs = Math.floor(s / 3600);
    const mins = Math.round((s % 3600) / 60);
    return `~${hrs}h ${mins}m`;
  };

  const dismissMessage = (ts) => {
    // allow dismissing by batchId or by ts for legacy messages
    setBatchMessages(prev => prev.filter(m => {
      if (!m) return false;
      if (typeof ts === 'string' && m.batchId && m.batchId === ts) return false;
      if (m.ts === ts) return false;
      return true;
    }));
  };

  // Add or replace batch/global messages. For batch-scoped messages include
  // batchId so we keep at most one message per batch. Global messages use
  // scope: 'global' and are not replaced.
  const addOrReplaceMessage = (newMsg) => {
    setBatchMessages(prev => {
      // Prepend new message, but drop existing messages for the same batchId
      const merged = [newMsg, ...prev.filter(m => !(newMsg.batchId && m.batchId && m.batchId === newMsg.batchId))];
      // Deduplicate by key (batchId or global ts) while preserving order
      const seen = new Set();
      const out = [];
      for (const m of merged) {
        const key = m.batchId ? `b:${m.batchId}` : `g:${m.ts}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(m);
        }
      }
      // Keep a reasonable cap to avoid unbounded growth
      return out.slice(0, 10);
    });
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

  // Derive grouped/sorted batches for display: processing first, then queued by position
  const allBatches = Object.values(activeBatches || {});
  const processingBatches = allBatches.filter(b => b && (b.queueStatus === 'processing' || b.queueStatus === 'started' || b.status === 'started' || b.status === 'processing'));
  const queuedBatches = allBatches.filter(b => b && b.queueStatus === 'queued');
  queuedBatches.sort((a, b) => {
    const pa = (typeof a.queuePosition === 'number') ? a.queuePosition : Infinity;
    const pb = (typeof b.queuePosition === 'number') ? b.queuePosition : Infinity;
    return pa - pb;
  });

  // Total files across processing and queued batches (used for a compact summary)
  const totalFilesCount = (processingBatches || []).reduce((sum, b) => sum + (b.fileCount || 0), 0) + (queuedBatches || []).reduce((sum, b) => sum + (b.fileCount || 0), 0);

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 sm:hidden" onClick={onClose} />}
      <div className={`fixed top-0 right-0 h-full w-full sm:w-96 max-w-full bg-white dark:bg-gray-800 dark:text-white shadow-lg p-4 z-50 overflow-y-auto ${!isOpen ? 'hidden' : ''}`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold dark:text-white">Batch Processing Status</h2>
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
                <h3 className="font-semibold text-sm dark:text-slate-100">
                  Processing ({processingBatches.length}) • Queued ({queuedBatches.length})
                  <span className="text-xs text-gray-500 ml-2">({totalFilesCount} files total)</span>
                </h3>
                {(currentBatch > 0 && totalBatches > 0) && (
                  <div className="text-xs text-blue-700 dark:text-slate-300">Batch {currentBatch} of {totalBatches} processing…</div>
                )}
              </div>
              <div className="space-y-2">
                {/* Currently Processing first */}
                {processingBatches.length > 0 && (
                  <>
                    <div className="mb-2 text-sm font-medium dark:text-slate-100">Currently Processing ({processingBatches.length})</div>
                    {processingBatches.map(batch => {
                      const isCompleted = batch.queueStatus === 'completed';
                      return (
                        <div key={batch.batchId} className={`flex flex-col p-2 ${isCompleted ? 'bg-green-50 dark:bg-green-900/10' : 'bg-white dark:bg-gray-800'} dark:border-gray-600 rounded shadow-sm`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`w-3 h-3 rounded-full ${isCompleted ? 'bg-green-500' : 'animate-pulse bg-blue-500'}`} />
                              <div>
                                <div className="text-sm font-medium dark:text-slate-100">Batch: Processing ({batch.fileCount || 0} files)</div>
                                {batch.message && (
                                  <div className="text-xs text-gray-500 dark:text-slate-300">{batch.message}</div>
                                )}
                                <div className="text-xs text-gray-500 dark:text-slate-300">{batch.startTime ? `• ${formatElapsedTime(batch.startTime)} ago` : ''}</div>
                              </div>
                            </div>
                            <div>
                              {isCompleted ? (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full text-green-800 bg-green-200 dark:text-green-200 dark:bg-green-900/20">Completed</span>
                              ) : (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30">Processing</span>
                              )}
                            </div>
                          </div>

                          {/* Progress indicator for processing batches (hide if just completed) */}
                          {!isCompleted && typeof batch.progress === 'number' ? (() => {
                            const now = Date.now();
                            let eta = null;
                            if (batch.startTime && typeof batch.progress === 'number' && batch.progress > 0) {
                              const elapsedSecs = Math.max(1, Math.floor((now - new Date(batch.startTime).getTime()) / 1000));
                              eta = Math.round(elapsedSecs * (100 / batch.progress - 1));
                              if (!isFinite(eta) || eta < 0) eta = null;
                            }
                            return (
                              <div className="mt-2">
                                {/* <ProgressBar progress={batch.progress} showPercentage={true} label={batch.message || 'Processing'} estimatedTimeRemaining={eta} /> */}
                              </div>
                            )
                          })() : null}
                        </div>
                      )
                    })}
                  </>
                )}

                {/* Note: dequeued batches intentionally not shown; dequeued is treated as part of queued->processing transition */}

                {/* Queued batches next, sorted by queuePosition */}
                {queuedBatches.length > 0 && (
                  <>
                    <div className="mt-3 mb-2 text-sm font-medium dark:text-slate-100">Queued ({queuedBatches.length})</div>
                    {queuedBatches.map(batch => (
                      <div key={batch.batchId} className="flex flex-col p-2 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800/10 rounded shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="text-amber-500">⏳</div>
                            <div>
                              <div className="text-sm font-medium dark:text-slate-100">
                                {(() => {
                                  const pos = (typeof batch.queuePosition === 'number') ? `${batch.queuePosition}${batch.totalQueued ? ` of ${batch.totalQueued}` : ''}` : '?';
                                  const eta = (batch.estimatedWaitTime !== null && batch.estimatedWaitTime !== undefined) ? `, ${formatWaitTime(batch.estimatedWaitTime)} wait` : '';
                                  return `Batch: Queued (position ${pos}${eta})`;
                                })()}
                              </div>
                              {batch.message && (
                                <div className="text-xs text-gray-500 dark:text-slate-300">{batch.message}</div>
                              )}
                              <div className="text-xs text-gray-500 dark:text-slate-300">{batch.enqueuedAt ? `• queued ${formatElapsedTime(batch.enqueuedAt)} ago` : ''}</div>
                            </div>
                          </div>
                          <div className="text-xs text-amber-700 dark:text-amber-300"><span className="px-2 py-1 text-xs font-semibold rounded-full text-amber-700 bg-amber-100 dark:text-amber-200 dark:bg-amber-900/20">Queued</span></div>
                        </div>
                        {/* Do not show progress bar or elapsed time for queued batches */}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Recent Batch Messages */}
          {batchMessages.length > 0 && (
            <div className="mb-4 p-2">
              {batchMessages.map((m) => (
                <div key={m.batchId ?? m.ts} className={`flex items-start justify-between p-2 mb-2 rounded ${m.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : m.type === 'error' ? 'bg-red-50 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200'}`}>
                  <div>
                    <div className="text-sm">{m.text}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-300">{new Date(m.ts).toLocaleTimeString()}</div>
                  </div>
                  <div>
                    <button onClick={() => dismissMessage(m.batchId ?? m.ts)} className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200">x</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isOpen && loading && (
            <div className="p-2">
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading batch status…</div>
            </div>
          )}

          {(!loading && (!files || files.length === 0) && getActiveBatchCount() === 0) && (
            <EmptyState icon="📄" title="No active batches" description="Upload files to see batch processing status" />
          )}

          {/* Uploaded Files Section */}
          {files && files.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-sm dark:text-slate-100 mb-2">
                Uploaded Files ({files.length})
              </h3>
              <ul className="space-y-2">
                {files.map((file) => (
                  <li key={file.id} className="p-2 bg-gray-50 dark:bg-gray-700 rounded-md flex items-center justify-between">
                    <div className="truncate">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{file.original_filename}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Status: <span className={`font-semibold ${file.processing_status === 'completed' ? 'text-green-500' : file.processing_status === 'failed' ? 'text-red-500' : 'text-yellow-500'}`}>{file.processing_status}</span>
                      </p>
                    </div>
                    <ReprocessButton file={file} onReprocess={handleReprocess} />
                  </li>
                ))}
              </ul>
            </div>
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
