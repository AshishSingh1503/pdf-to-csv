# PDF to CSV Converter

This project is a full-stack application designed to process PDF documents using Google Cloud Document AI, extract structured data (specifically person records), validate and clean the data, and export it to CSV format.

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Data Flow](#data-flow)
- [Key Components](#key-components)
  - [Server](#server)
  - [Client](#client)
- [Setup & Usage](#setup--usage)

## Overview

The application automates the extraction of contact information (Name, Address, Mobile, Email, etc.) from PDF files. It handles:
- **Batch Processing**: Upload multiple PDFs at once.
- **AI Extraction**: Uses Google Cloud Document AI to parse unstructured text.
- **Intelligent Parsing**: Custom logic to handle parent/child entity relationships and recover "orphaned" data (e.g., addresses not directly linked to a person).
- **Validation**: Parallelized validation using worker threads to ensure data quality.
- **Deduplication**: Merges duplicate records based on mobile numbers, prioritizing the most complete data.

## Architecture

The project is a Monorepo containing:
- **Client**: A React application (Vite + Tailwind CSS) for the user interface.
- **Server**: An Express.js Node.js server that handles the core business logic, API endpoints, and integration with Google Cloud.
- **Database**: Uses a SQL database (likely PostgreSQL or MySQL based on `models`) to store extracted data.

## Data Flow

1.  **Upload**:
    *   User selects PDF files in the Client.
    *   Files are uploaded to the Server via the `/api/documents/upload` endpoint.
    *   The `DocumentController` receives the files and initiates the processing job.

2.  **Processing (`documentProcessor.js`)**:
    *   The server processes files in batches.
    *   **Document AI**: Each PDF is sent to Google Cloud Document AI.
    *   **Extraction**: The `extractRecordsFromParentEntities` function parses the AI response.
        *   It identifies `person_record` entities.
        *   It extracts properties like Name, Address, Mobile, etc.
        *   **Recovery**: It attempts to find "orphaned" Address entities (detected by the AI but not linked) and assigns them to the nearest person record based on vertical proximity.

3.  **Validation (`validations.worker.js`)**:
    *   Extracted records are sent to a worker thread pool for parallel validation.
    *   The `validators.js` utility cleans names, formats addresses, validates emails/phones, and normalizes dates.
    *   Invalid records are flagged or rejected.

4.  **Deduplication & Storage**:
    *   Valid records are grouped by Mobile number.
    *   Duplicates are merged, keeping the most complete information.
    *   Finalized records are saved to the database.

5.  **Export**:
    *   Users can view and export the processed data as CSV files via the Client.

## Key Components

### Server (`server/src`)

*   **`app.js`**: Main entry point. Sets up Express, middleware (CORS, file upload), and routes.
*   **`routes/`**: Defines API endpoints.
    *   `documentRoutes.js`: Handles file uploads and processing status.
    *   `dataRoutes.js`: Retrieval of processed data.
*   **`controllers/`**:
    *   `documentController.js`: Manages the upload request, interacts with the processor, and handles responses.
*   **`services/`**:
    *   `documentProcessor.js`: **Core Logic**. Handles Document AI interaction, entity extraction, and orchestration of validation.
    *   `validations.worker.js`: Worker thread script for CPU-intensive validation tasks.
*   **`utils/`**:
    *   `validators.js`: Shared validation and cleaning functions (e.g., `cleanName`, `validateEmail`).
    *   `logger.js`: Centralized logging configuration.

### Client (`client/`)

*   Built with **React** and **Vite**.
*   Uses **Tailwind CSS** for styling.
*   Provides a dashboard for uploading files, monitoring progress, and downloading results.

## Setup & Usage

### Prerequisites
- Node.js (v16+ recommended)
- Google Cloud Platform account with Document AI enabled.
- Database (PostgreSQL/MySQL) running.

### Environment Variables
Create a `.env` file in the `server` directory with:
- `PORT`: Server port (default 3000)
- `DB_URI`: Database connection string
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to GCP service account key
- `GCP_PROJECT_ID`: Google Cloud Project ID
- `GCP_LOCATION`: Document AI location (e.g., `us`)
- `GCP_PROCESSOR_ID`: Document AI Processor ID

### Running the Project

1.  **Install Dependencies**:
    ```bash
    # Server
    cd server
    npm install

    # Client
    cd ../client
    npm install
    ```

2.  **Start Server**:
    ```bash
    cd server
    npm start
    ```

3.  **Start Client**:
    ```bash
    cd client
    npm run dev
    ```

4.  **Access**: Open `http://localhost:5173` (or the port shown in client terminal).
