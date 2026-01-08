# 📄 PDF to CSV Person Extraction System

A robust, full-stack solution for ingesting PDF files, intelligently extracting Person entities using Google Cloud Document AI, and rigorously validating/cleaning the data for high-quality CSV/Database output.

---

## 🚀 Project Overview

**What is this?**
This system automates the digitization of unstructure PDF documents containing personal information. It is designed to handle messy inputs (jumbled text, partial addresses, various date formats) and produce clean, standardized records.

**What data are we ingesting?**
The system creates "Person" records containing:
- **Full Name** (First/Last)
- **Mobile Number** (Strictly validated Australian `04xxxxxxxx` format)
- **Address** (Cleaned and normalized)
- **Email** (Validation)
- **Date of Birth** & **Last Seen** (Normalized dates)
- **Landline** (Validated)

---

## 🔄 Data Architecture & Flow

### 1. Ingestion
Data enters the system via two primary methods:
- **Direct Upload**: Users upload PDFs directly through the React Frontend.
- **Google Cloud Storage (GCS)**: The system can process files stored in GCS buckets (supported in `processPDFs`).

### 2. Processing (The "Brain")
Once a PDF is received:
1.  **Google Document AI**: The file is sent to a specific processor trained to identify entities (Person, Name, Address, etc.).
2.  **Raw Entity Extraction**: The app parses the AI response, mapping raw text entities to a `Person` object.
3.  **Entity Recovery**: If an address is "floating" (not linked to a specific person by AI) but overlaps vertically with a person record, the system intelligently "recovers" and assigns it.

### 3. Logic Pipeline (Validation & Cleaning)
Every record goes through a rigorous centralized validation suite (`validators.js`):

#### 🧹 Address Logic
- **Cleaning**: Removes special characters, collapses whitespace, and trims noise.
- **Smart Reordering**:
    - The system detects if an address is jumbled (e.g., "State Postcode Street").
    - **Strict Protection**: It *only* attempts to reorder if it finds a **Valid Australian State** (NSW, VIC, QLD, WA, SA, TAS, ACT, NT). This prevents false positives where words like "Unit" (containing "nit") were mistakenly identified as "NT".
- **Normalization**: Ensures final format is `[Street] [State] [Postcode]`.

#### 📱 Mobile Logic
- **Jumble Fix**: Can repair numbers like `1234560488` by rotating them to find the valid `04` start.
- **Format Constraint**: Must be exactly 10 digits and start with `04`. Non-compliant numbers cause record **Rejection**.

#### 📅 Date Logic
- **Normalization**: Converts `20-Aug-2001`, `2001.08.20`, etc., to `YYYY-MM-DD`.
- **Validation**:
    - Enforces years between 1900-2025.
    - Validates day/month correctness (e.g., rejects Feb 30).
    - Invalid dates are cleared (set to empty) rather than rejecting the whole record.

#### 👥 Deduplication Strategy
When multiple records share the same **Mobile Number**:
1.  **Winner**: The record with a valid Address is prioritized.
2.  **Tie-Breaker**: If both have addresses (or neither), the one with the most populated fields (Name, Email, etc.) wins.
3.  **Loser**: Duplicates are discarded to ensure unique Person entities.

### 4. Storage & Export
- **Database**: Valid outcomes are inserted into **PostgreSQL**.
- **Export**: Users can download the final clean dataset as CSV or Excel files.

---

## 🛠️ Technology Stack

| Component | Tech | Purpose |
| :--- | :--- | :--- |
| **Backend** | **Node.js / Express** | API & Orchestration |
| **Language** | **JavaScript (ES Modules)** | Logic |
| **Database** | **PostgreSQL** | Persistent storage |
| **AI Service** | **Google Document AI** | OCR & Entity Extraction |
| **Processing** | **Worker Threads** | Offloading heavy CPU validation tasks |
| **Queue** | **p-limit** | Concurrency control for API rate limits |
| **Frontend** | **React** | User Interface |
| **Styling** | **Tailwind CSS** | UI Component styling |

---

## 📂 Project Structure

```bash
server/
├── src/
│   ├── services/
│   │   ├── documentProcessor.js  # Core orchestration (DocAI -> Extraction -> Validation)
│   │   └── validations.worker.js # CPU-bound validation tasks
│   ├── utils/
│   │   └── validators.js         # The "Source of Truth" for all regex/cleaning logic
│   ├── config/                   # Envs & Constants
│   └── routes/                   # API Endpoints
└── ...
```

## ⚙️ Key Configuration (Envs)

- `MAX_WORKERS`: Controls parallel processing power (Default: 24).
- `MAX_CONCURRENT_DOCAI_REQUESTS`: Throttles calls to Google to avoid quotas.
- `PROJECT_ID` / `PROCESSOR_ID`: Link to the specific Google Cloud resources.

---

## 🚀 Quick Usage

1.  **Start Server**: `cd server && npm start`
2.  **Start Client**: `cd client && npm run dev`
3.  **Upload**: Go to `localhost:5173`, drag & drop partial or full PDFs.
4.  **Monitor**: Watch the logs for "Processing file..." and "Success rate..." stats.
5.  **Export**: Download the clean list.
