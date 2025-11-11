# Legacy Python/Streamlit Implementation

Archive Date: 2025-11-11

## Reason for archival

This repository was migrated from a Python/Streamlit-based implementation to a Node.js (Express) backend and React frontend. The original Python code (Document AI extractor, Streamlit UI, and simple batch scripts) has been preserved here for historical/reference purposes but is no longer part of the active application stack.

These files are retained to help future maintainers understand the migration history and for occasional reference when porting logic or debugging extraction heuristics.

## Files archived

- `working_document_processor.py` — Legacy Document AI processor class (entity extraction, grouping, cleaning, CSV/Excel save helpers).
- `app.py` — Streamlit-based user interface for uploading PDFs and downloading CSV/Excel/JSON results.
- `run_app.py` — Small launcher script to run the Streamlit app (installs Streamlit if missing).
- `process_documents.py` — Small example/demo script showing usage of the processor.
- `batch_process.py` — Legacy batch processing script that finds PDFs in a folder and processes them.
- `chlatochla.py` — Alternative/experimental variant of the document processor (kept for comparison).
- `requirements.txt` — Python dependency list used by the legacy implementation.

## Replacements in the current codebase

- Backend: `server/` now contains the Node.js/Express implementation, including a `documentProcessor` service implemented in JavaScript and a production-ready `BatchQueueManager`.
- Frontend: `client/` is a React app (Vite) that replaces the Streamlit UI and connects to the backend via HTTP + WebSocket for realtime updates.

Key replacements:
- `server/src/services/documentProcessor.js` — JS implementation of extraction and post-processing logic.
- `server/src/services/batchQueueManager.js` — centralized FIFO queue with backpressure, timeouts, and metrics.
- `client/src/pages/Home.jsx` and `client/src/components/UploadedFilesSidebar.jsx` — React upload UI and realtime status sidebar.

## Notes & guidance

- The archived Python files are deliberately kept for reference. They are not used in the current CI/CD pipelines and are not intended to be run in production.
- If you prefer to keep the repository smaller or want to remove the archived files from version control, delete this `archive/legacy-python/` directory and uncomment the `archive/` line in `.gitignore`.

## Contact

If you have questions about the migration or need specific logic ported from Python to JavaScript, open an issue and tag `@maintainers` for follow-up.
