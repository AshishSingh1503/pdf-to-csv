"""
Simple usage example for the enhanced document processor
"""

from working_document_processor import DocumentProcessor
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('config.env')

def main():
    # Configuration from environment
    PROJECT_ID = os.getenv('PROJECT_ID')
    LOCATION = os.getenv('LOCATION', 'us')
    PROCESSOR_ID = os.getenv('PROCESSOR_ID')
    CREDENTIALS_PATH = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    
    # Initialize processor
    processor = DocumentProcessor(
        project_id=PROJECT_ID,
        location=LOCATION,
        processor_id=PROCESSOR_ID,
        credentials_path=CREDENTIALS_PATH
    )
    
    # List of PDF files to process
    pdf_files = [
        "sample1.pdf",
        "sample2.pdf",
        "sample3.pdf"
    ]
    
    # Process all documents
    print("Processing documents...")
    results = processor.process_multiple_documents(pdf_files)
    
    # Save to CSV
    csv_path = os.getenv('CSV_FILENAME', 'extracted_data.csv')
    processor.save_to_csv(results, csv_path)
    print(f"Data saved to: {csv_path}")
    
    # Save to Excel
    excel_path = os.getenv('EXCEL_FILENAME', 'extracted_data.xlsx')
    processor.save_to_excel(results, excel_path)
    print(f"Data saved to: {excel_path}")
    
    # Detect duplicates if enabled
    if os.getenv('ENABLE_DUPLICATE_DETECTION', 'true').lower() == 'true':
        key_field = os.getenv('DUPLICATE_KEY_FIELD', 'mobile')
        duplicates = processor.detect_duplicates(results, key_field)
        
        if duplicates:
            processor.save_to_csv(duplicates, 'duplicates.csv')
            print(f"Found {len(duplicates)} duplicate records")
        else:
            print("No duplicates found")
    
    print("Processing complete!")

if __name__ == "__main__":
    main()
