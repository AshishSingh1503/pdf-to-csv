# PDF to CSV/DB Data Extractor

![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![React](https://img.shields.io/badge/react-%5E19.0.0-blue.svg)
![PostgreSQL](https://img.shields.io/badge/postgres-%5E14.0-blue.svg)

A production-grade, high-performance application designed to extract structured data from complex PDF documents using Google Cloud Document AI and store it efficiently in a PostgreSQL database.

## 🚀 Features

*   **Advanced AI Extraction**: Leverages Google Document AI to parse unstructured PDF documents with high accuracy.
*   **Parent/Child Entity Support**: Handles complex nested data structures (e.g., multiple records per page) using parent `person_record` entities.
*   **Robust Data Validation**: Enforces strict validation rules for fields like mobile numbers (Australian format), dates, and addresses.
*   **High Performance Architecture**:
    *   **Parallel Processing**: Utilizes Node.js worker threads for CPU-intensive validation tasks.
    *   **Batch Database Operations**: Optimized bulk inserts to handle high throughput.
    *   **Scalable**: Configurable for high-resource environments (e.g., 8 vCPU / 64GB RAM).
*   **Duplicate Detection**: Optional logic to prevent duplicate records based on unique identifiers (e.g., mobile number).
*   **Modern Web Interface**: A responsive React-based frontend (Vite + Tailwind CSS) for easy file uploads and real-time status monitoring.
*   **Cloud Ready**: Dockerized and optimized for deployment on Google Cloud Run.

## 🏗 Architecture

The application follows a modern 3-tier architecture:

1.  **Frontend**: React application built with Vite and Tailwind CSS. Handles file uploads and displays processing status via WebSockets.
2.  **Backend**: Node.js (Express) server. Manages API endpoints, orchestrates Document AI processing, and handles database interactions.
3.  **Database**: PostgreSQL database for persistent storage of extracted records and file metadata.
4.  **AI Service**: Google Cloud Document AI for OCR and entity extraction.

## 🛠 Prerequisites

Before running the application, ensure you have the following:

*   **Node.js** (v18 or higher)
*   **PostgreSQL** (v14 or higher)
*   **Google Cloud Project** with:
    *   Document AI API enabled.
    *   A Service Account with `Document AI Processor User` and `Storage Object Admin` roles.
    *   A configured Document AI Processor (Custom Extractor).

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd pdf-to-csv
    ```

2.  **Install Backend Dependencies**:
    ```bash
    cd server
    npm install
    ```

3.  **Install Frontend Dependencies**:
    ```bash
    cd ../client
    npm install
    ```

## ⚙️ Configuration

The application is configured using environment variables.

1.  **Backend Configuration**:
    Create a `.env` file in the `server` directory (copy from `.env.example` or `config.env`).

    **Key Variables:**
    *   `PORT`: Server port (default: 5000).
    *   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: Database connection details.
    *   `PROJECT_ID`: Google Cloud Project ID.
    *   `LOCATION`: Google Cloud Location (e.g., `us`).
    *   `PROCESSOR_ID`: Document AI Processor ID.
    *   `GOOGLE_APPLICATION_CREDENTIALS`: Path to your Service Account JSON key.

2.  **Frontend Configuration**:
    Create a `.env` file in the `client` directory if needed (e.g., for API URL overrides).

## 🚀 Usage

### Local Development

1.  **Start the Database**:
    Ensure your PostgreSQL instance is running. You can initialize the schema using the provided SQL script:
    ```bash
    psql -U <username> -d <dbname> -f setup_new_db.sql
    ```

2.  **Start the Backend**:
    ```bash
    cd server
    npm start
    ```

3.  **Start the Frontend**:
    ```bash
    cd client
    npm run dev
    ```
    Access the application at `http://localhost:5173`.

### Deployment (Google Cloud Run)

The application is designed to be deployed to Google Cloud Run.

1.  **Build and Deploy**:
    Use the provided `deploy.sh` script or `gcloud` commands to build the container image and deploy it to Cloud Run.
    ```bash
    ./deploy.sh
    ```
    *Note: Ensure you have the Google Cloud SDK installed and authenticated.*

## 📚 API Documentation

### `POST /api/upload`
Uploads one or more PDF files for processing.
*   **Body**: `multipart/form-data` with `files` field.
*   **Response**: JSON object containing processing results and job ID.

### `GET /api/status`
Retrieves the status of the system or specific jobs.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/amazing-feature`).
3.  Commit your changes (`git commit -m 'Add some amazing feature'`).
4.  Push to the branch (`git push origin feature/amazing-feature`).
5.  Open a Pull Request.

## 📄 License

This project is licensed under the ISC License.
