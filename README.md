# 📄 PDF to CSV Converter

Processing pipeline for extracting, validating, and structuring person records from PDF documents using Google Cloud Document AI.

## 🚀 Overview

This full-stack application automates the extraction of contact information (Name, Address, Mobile, Email, DOB, etc.) from PDF files. It handles high-volume batch processing, complex entity relationships, and ensures data integrity through rigorous validation and deduplication strategies.

### Key Features
- **Batch Processing**: Handle multiple PDF uploads simultaneously with high throughput.
- **AI-Powered Extraction**: Leverages Google Cloud Document AI for intelligent text parsing.
- **Smart Data Recovery**:Custom algorithms to recover "orphaned" entities (e.g., addresses not linked to a person).
- **Advanced Validation**:
  - Centralized validation logic shared between main and worker threads.
  - Verification of mobile numbers (AU format), email addresses, and dates.
  - "Look Left" support for date extraction (deprecated/removed in favor of strict DocAI normalization).
- **Deduplication**: Intelligent merging of duplicate records based on mobile numbers, prioritizing the most complete datasets.
- **Worker Threads**: CPU-intensive tasks (validation) offloaded to worker threads for non-blocking I/O.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19
- **Build Tool**: Vite
- **Styling**: Tailwind CSS v4
- **HTTP Client**: Axios

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (via `pg`)
- **Processing**:
  - `@google-cloud/documentai`
  - `worker_threads` for parallel processing
  - `p-limit` for concurrency control
- **Utilities**: `winston` (logging), `csv-writer`, `xlsx`, `archiver`

---

## 📂 Project Structure

Verified Monorepo structure:

```
pdf-to-csv/
├── client/                 # React Frontend
│   ├── src/
│   ├── index.html
│   └── vite.config.js
│
├── server/                 # Node.js Backend
│   ├── src/
│   │   ├── config/         # Centralized configuration
│   │   ├── controllers/    # Request handlers
│   │   ├── routes/         # API definitions
│   │   ├── services/       # Core business logic (DocumentProcessor)
│   │   └── utils/          # Helpers (Validators, Logger)
│   ├── index.js            # Entry point
│   └── package.json
│
└── README.md
```

---

## ⚙️ Configuration

The application is configured via environment variables. Create a `.env` file in the `server/` directory.

### Core
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server listening port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:5173` |

### Database
| Variable | Description |
|----------|-------------|
| `DB_HOST` | Database hostname |
| `DB_PORT` | Database port (e.g., `5432`) |
| `DB_NAME` | Database name |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password |
| `DB_SSL` | Enable SSL (`true`/`false`) |

### Google Cloud
| Variable | Description |
|----------|-------------|
| `PROJECT_ID` | GCP Project ID |
| `LOCATION` | Document AI Location (e.g., `us`) |
| `PROCESSOR_ID` | Document AI Processor ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON key |

### Performance & Tuning
| Variable | Description | Default |
|----------|-------------|---------|
| `MAX_WORKERS` | Max worker threads | `24` |
| `MAX_CONCURRENT_DOCAI_REQUESTS` | Concurent requests to DocAI | `150` |
| `DB_INSERT_CHUNK_SIZE` | Records per DB insert batch | `5000` |
| `RETRY_ATTEMPTS` | Retries for failed DocAI calls | `3` |
| `INITIAL_BACKOFF_MS` | Backoff start time (ms) | `1000` |

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- PostgreSQL Database
- Google Cloud Service Account with Document AI Admin access

### 2. Installation

**Backend**
```bash
cd server
npm install
```

**Frontend**
```bash
cd client
npm install
```

### 3. Running Locally

**Start Backend**
```bash
cd server
npm start
```
*Server runs on http://localhost:5000*

**Start Frontend**
```bash
cd client
npm run dev
```
*Client runs on http://localhost:5173*

---

## 🔄 Data Architecture

1.  **Extraction**: `documentProcessor.js` sends PDFs to DocAI.
2.  **Parsing**: Raw entities are mapped to a structured `Person` model.
3.  **Validation**: Records are passed to `validateRecords` (in `validators.js`), checking for:
    - Valid Name (length > 1)
    - Presence of Mobile Number
    - Mobile Number format (04...)
    - Presence of Address
4.  **Deduplication**: Valid records are grouped by Mobile. The entries with the most data (Address > Fields Count) are kept.
5.  **Storage**: Unique, valid records are inserted into PostgreSQL.

---

## 🔍 API Endpoints

- `POST /api/documents/upload`: Upload and process PDF files.
- `GET /api/documents/status`: Check processing status.
- `GET /api/data/export`: Download processed data as CSV/XLSX.
