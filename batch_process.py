"""
Batch processing script for multiple PDF files
"""

import os
import glob
from working_document_processor import DocumentProcessor
from dotenv import load_dotenv

def main():
    # Load configuration
    load_dotenv('config.env')
    
    # Get configuration
    PROJECT_ID = os.getenv('PROJECT_ID')
    LOCATION = os.getenv('LOCATION', 'us')
    PROCESSOR_ID = os.getenv('PROCESSOR_ID')
    CREDENTIALS_PATH = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    OUTPUT_DIR = os.getenv('OUTPUT_DIR', 'output')
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Initialize processor
    processor = DocumentProcessor(
        project_id=PROJECT_ID,
        location=LOCATION,
        processor_id=PROCESSOR_ID,
        credentials_path=CREDENTIALS_PATH
    )
    
    # Find all PDF files in current directory
    pdf_files = glob.glob("*.pdf")
    
    if not pdf_files:
        print("No PDF files found in current directory")
        return
    
    print(f"Found {len(pdf_files)} PDF files to process")
    
    # Process all documents
    results = processor.process_multiple_documents(pdf_files)
    
    # Filter out error results
    successful_results = [r for r in results if 'error' not in r]
    error_results = [r for r in results if 'error' in r]
    
    print(f"Successfully processed: {len(successful_results)} files")
    if error_results:
        print(f"Errors in: {len(error_results)} files")
    
    # Save successful results
    if successful_results:
        csv_path = os.path.join(OUTPUT_DIR, 'extracted_data.csv')
        excel_path = os.path.join(OUTPUT_DIR, 'extracted_data.xlsx')
        
        processor.save_to_csv(successful_results, csv_path)
        processor.save_to_excel(successful_results, excel_path)
        
        print(f"Results saved to: {csv_path}")
        print(f"Results saved to: {excel_path}")
        
        # Detect duplicates
        if os.getenv('ENABLE_DUPLICATE_DETECTION', 'true').lower() == 'true':
            key_field = os.getenv('DUPLICATE_KEY_FIELD', 'mobile')
            duplicates = processor.detect_duplicates(successful_results, key_field)
            
            if duplicates:
                duplicates_path = os.path.join(OUTPUT_DIR, 'duplicates.csv')
                processor.save_to_csv(duplicates, duplicates_path)
                print(f"Duplicates saved to: {duplicates_path}")
                print(f"Found {len(duplicates)} duplicate records")
            else:
                print("No duplicates found")
    
    # Save error log if any
    if error_results:
        error_path = os.path.join(OUTPUT_DIR, 'errors.csv')
        import pandas as pd
        error_df = pd.DataFrame(error_results)
        error_df.to_csv(error_path, index=False)
        print(f"Error log saved to: {error_path}")

if __name__ == "__main__":
    main()
