# Working Document Processor

Original document processor for extracting contact information from PDFs using Google Cloud Document AI with relaxed address regex.

## Features

- **Document AI Integration**: Uses Google Cloud Document AI for entity extraction
- **Relaxed Address Regex**: More flexible address pattern matching
- **Multiple Output Formats**: CSV and Excel output with summary sheets
- **Duplicate Detection**: Find duplicate records based on mobile numbers
- **Address Ordering Fix**: Automatically fixes Document AI address ordering issues
- **Streamlit Web UI**: Easy-to-use web interface for processing and viewing data

## Setup

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure environment**:
   - Update `config.env` with your Google Cloud settings
   - Add your Google Cloud credentials JSON file
   - Set your Document AI processor ID

3. **Run processing**:
   ```bash
   # Use the Streamlit web app (recommended)
   python run_app.py
   
   # Or command line processing
   python process_documents.py
   ```

## Configuration

Edit `config.env`:
```env
# Google Cloud Configuration
PROJECT_ID=your-project-id
LOCATION=us
PROCESSOR_ID=your-processor-id
GOOGLE_APPLICATION_CREDENTIALS=./credentials.json

# Output Configuration
OUTPUT_DIR=output
CSV_FILENAME=extracted_data.csv
EXCEL_FILENAME=extracted_data.xlsx
ENABLE_DUPLICATE_DETECTION=true
DUPLICATE_KEY_FIELD=mobile
```

## Usage

```python
from working_document_processor import DocumentProcessor

# Initialize processor
processor = DocumentProcessor(
    project_id="your-project-id",
    location="us",
    processor_id="your-processor-id",
    credentials_path="credentials.json"
)

# Process documents
results = processor.process_multiple_documents(["file1.pdf", "file2.pdf"])

# Save results
processor.save_to_csv(results, "output.csv")
processor.save_to_excel(results, "output.xlsx")

# Detect duplicates
duplicates = processor.detect_duplicates(results)
```

## Key Features

### Relaxed Address Regex
- **Original Patterns**: Keeps all original regex patterns
- **Enhanced Address**: More flexible address pattern matching
- **Multiple Formats**: Supports various address formats and abbreviations

### Smart Data Processing
- **Name Parsing**: Uses nameparser with intelligent fallback
- **Phone Cleaning**: Automatic country code addition and validation
- **Data Combination**: Merges Document AI entities with regex extraction
- **Error Handling**: Robust error handling with detailed logging

### Output Options
- **CSV**: Clean, structured CSV output
- **Excel**: Multi-sheet Excel with summary statistics
- **Duplicate Detection**: Separate file for duplicate records

## Files

- `working_document_processor.py` - Main processor class (original with relaxed address regex)
- `app.py` - Streamlit web app for easy testing
- `run_app.py` - Script to run the Streamlit app
- `run_app.bat` - Windows batch file to run the app
- `process_documents.py` - Simple usage example
- `batch_process.py` - Batch processing for multiple PDFs
- `config.env` - Configuration file
- `requirements.txt` - Python dependencies
- `README.md` - This file

## Streamlit Web App

The easiest way to test the document processor is using the Streamlit web app:

### Features
- **Upload PDFs**: Drag and drop multiple PDF files
- **Process Files**: Extract data using Document AI
- **View Results**: See both raw and filtered data side by side
- **Download Options**: Get CSV, Excel, or ZIP files
- **Address Fixing**: Automatically fixes Document AI address ordering issues

### Usage

1. **Run the app**:
   ```bash
   python run_app.py
   ```

2. **Open your browser** to `http://localhost:8501`

3. **Upload PDF files** and click "Process Files"

4. **View results** in the interface

5. **Download results** as CSV or Excel

### Features:
- ✅ Upload multiple PDF files
- ✅ Real-time processing status
- ✅ Results preview
- ✅ Download as CSV or Excel
- ✅ Duplicate detection
- ✅ Error handling and reporting

## Requirements

- Python 3.7+
- Google Cloud Project with Document AI enabled
- Service account credentials
- Document AI processor configured