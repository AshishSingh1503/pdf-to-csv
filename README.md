# PDF to CSV/DB Data Extractor

A production-grade application for extracting structured data from PDF documents using Google Document AI and storing it in a PostgreSQL database.

## Features

*   **Robust Extraction**: Uses Google Document AI to parse PDF documents.
*   **Smart Clustering**: Implements "Anchor-Based" clustering to accurately group attributes (Mobile, Address, DOB) with the correct Name entity, even in complex layouts.
*   **Data Validation**: Enforces strict validation rules (e.g., Australian mobile number formats, valid dates).
*   **High Performance**:
    *   **Parallel Processing**: Utilizes worker threads for CPU-intensive validation.
    *   **Batch Inserts**: Optimized for high-throughput database operations.
    *   **Scalable**: Configurable for high-resource environments (e.g., 8 vCPU / 64GB RAM).
*   **Duplicate Detection**: Prevents duplicate records based on mobile numbers.
*   **Modern UI**: React-based frontend for file uploads and status monitoring.

## Architecture

*   **Backend**: Node.js (Express)
*   **Database**: PostgreSQL
*   **AI Service**: Google Cloud Document AI
*   **Frontend**: React (Vite)

## Configuration

The application is configured via environment variables. See `.env.example` for a template.

### Key Environment Variables

*   **Server**: `PORT`, `NODE_ENV`
*   **Database**: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
*   **Document AI**: `PROJECT_ID`, `LOCATION`, `PROCESSOR_ID`, `GOOGLE_APPLICATION_CREDENTIALS`
*   **Performance Tuning**:
    *   `MAX_WORKERS`: Max concurrent Document AI requests (default: 24).
    *   `WORKER_THREAD_POOL_SIZE`: Number of validation threads (default: 4).
    *   `DB_INSERT_CHUNK_SIZE`: Rows per DB insert batch (default: 5000).

## Getting Started

1.  **Prerequisites**:
    *   Node.js (v18+)
    *   PostgreSQL
    *   Google Cloud Service Account with Document AI permissions.

2.  **Installation**:
    ```bash
    cd server
    npm install
    cd ../client
    npm install
    ```

3.  **Database Setup**:
    Ensure your PostgreSQL database is running and accessible. The application handles basic table creation, or use `setup_new_db.sql` for manual setup.

4.  **Running the App**:
    *   **Server**: `cd server && npm start`
    *   **Client**: `cd client && npm run dev`

## Project Structure

*   `server/`: Backend API and processing logic.
    *   `src/services/documentProcessor.js`: Core logic for PDF processing and entity extraction.
    *   `src/config/`: Configuration management.
*   `client/`: Frontend React application.
*   `archive/`: Deprecated files and scripts.

## License

[Your License Here]
