import streamlit as st
import os
import pandas as pd
import io
import json
from dotenv import load_dotenv
from working_document_processor import WorkingDocumentProcessor
import tempfile
import zipfile
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv('config.env')

# --- Configuration from environment variables ---
PROJECT_ID = os.getenv('PROJECT_ID')
LOCATION = os.getenv('LOCATION', 'us')
PROCESSOR_ID = os.getenv('PROCESSOR_ID')
CREDENTIALS_PATH = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
OUTPUT_DIR = os.getenv('OUTPUT_DIR', 'output')
ENABLE_DUPLICATE_DETECTION = os.getenv('ENABLE_DUPLICATE_DETECTION', 'true').lower() == 'true'
DUPLICATE_KEY_FIELD = os.getenv('DUPLICATE_KEY_FIELD', 'mobile')

# --- Streamlit App ---
st.set_page_config(layout="wide", page_title="PDF to CSV/Excel Processor")

st.title("📄 PDF to CSV/Excel Processor")
st.markdown("Upload your PDF files to extract contact information and download as CSV or Excel.")

# Sidebar for configuration and status
st.sidebar.header("Configuration & Status")
st.sidebar.write(f"**Project ID:** `{PROJECT_ID}`")
st.sidebar.write(f"**Location:** `{LOCATION}`")
st.sidebar.write(f"**Processor ID:** `{PROCESSOR_ID}`")
st.sidebar.write(f"**Credentials Path:** `{CREDENTIALS_PATH}`")

if not all([PROJECT_ID, LOCATION, PROCESSOR_ID, CREDENTIALS_PATH]):
    st.sidebar.error("🚨 Missing environment variables! Please check `config.env`.")
    st.stop()

# Initialize processor
try:
    processor = WorkingDocumentProcessor(
        project_id=PROJECT_ID,
        location=LOCATION,
        processor_id=PROCESSOR_ID,
        credentials_path=CREDENTIALS_PATH
    )
    st.sidebar.success("✅ Document Processor Initialized!")
except Exception as e:
    st.sidebar.error(f"❌ Failed to initialize Document Processor: {e}")
    st.stop()

uploaded_files = st.file_uploader("Upload PDF Files", type="pdf", accept_multiple_files=True)

if uploaded_files:
    if st.button("Process Files"):
        if not uploaded_files:
            st.warning("Please upload at least one PDF file.")
            st.stop()

        all_raw_records = []
        all_filtered_records = []
        all_pre_processing_json = []
        all_post_processing_json = []
        processed_file_count = 0
        total_files = len(uploaded_files)
        progress_bar = st.progress(0)
        status_text = st.empty()

        for i, uploaded_file in enumerate(uploaded_files):
            status_text.text(f"Processing file {i+1}/{total_files}: {uploaded_file.name}...")
            progress_bar.progress((i + 1) / total_files)

            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_file:
                    tmp_file.write(uploaded_file.getvalue())
                    tmp_file_path = tmp_file.name

                # Process the document
                result = processor.process_document(tmp_file_path)
                if result:
                    # Add file name to each record
                    for record in result['raw_records']:
                        record['file_name'] = uploaded_file.name
                    for record in result['filtered_records']:
                        record['file_name'] = uploaded_file.name
                        
                    all_raw_records.extend(result['raw_records'])
                    all_filtered_records.extend(result['filtered_records'])
                    
                    # Collect JSON data
                    if result.get('pre_processing_json'):
                        all_pre_processing_json.append(result['pre_processing_json'])
                    if result.get('post_processing_json'):
                        all_post_processing_json.append(result['post_processing_json'])
                        
                processed_file_count += 1
                os.remove(tmp_file_path) # Clean up temp file

            except Exception as e:
                st.error(f"Error processing {uploaded_file.name}: {e}")
                logger.error(f"Error processing {uploaded_file.name}: {e}", exc_info=True)
                if os.path.exists(tmp_file_path):
                    os.remove(tmp_file_path)

        status_text.success(f"✅ Processed {processed_file_count} of {total_files} files.")

        # Display results
        if all_raw_records or all_filtered_records:
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("📊 Raw Records (Unfiltered)")
                if all_raw_records:
                    raw_df = pd.DataFrame(all_raw_records)
                    st.dataframe(raw_df)
                    st.write(f"**Total Raw Records:** {len(all_raw_records)}")
                else:
                    st.info("No raw records found.")
            
            with col2:
                st.subheader("✅ Filtered Records (Validated)")
                if all_filtered_records:
                    filtered_df = pd.DataFrame(all_filtered_records)
                    st.dataframe(filtered_df)
                    st.write(f"**Total Filtered Records:** {len(all_filtered_records)}")
                else:
                    st.info("No filtered records found.")

            # Download options
            st.subheader("📥 Download Results")

            # Create ZIP file with both raw and filtered data plus JSON
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                # Add raw CSV
                if all_raw_records:
                    raw_csv = io.StringIO()
                    raw_df.to_csv(raw_csv, index=False)
                    zip_file.writestr("raw_data.csv", raw_csv.getvalue())
                
                # Add filtered CSV
                if all_filtered_records:
                    filtered_csv = io.StringIO()
                    filtered_df.to_csv(filtered_csv, index=False)
                    zip_file.writestr("filtered_data.csv", filtered_csv.getvalue())
                
                # Add individual JSON files
                for i, json_data in enumerate(all_pre_processing_json):
                    filename = json_data.get('file_name', f'file_{i+1}')
                    json_name = filename.replace('.pdf', '_pre.json')
                    zip_file.writestr(f"json/{json_name}", json.dumps(json_data, indent=2))
                
                for i, json_data in enumerate(all_post_processing_json):
                    filename = json_data.get('file_name', f'file_{i+1}')
                    json_name = filename.replace('.pdf', '_post.json')
                    zip_file.writestr(f"json/{json_name}", json.dumps(json_data, indent=2))
                
                # Add combined JSON files
                if all_pre_processing_json:
                    combined_pre_json = {
                        'processing_session': {
                            'total_files': processed_file_count,
                            'timestamp': pd.Timestamp.now().isoformat()
                        },
                        'files': all_pre_processing_json
                    }
                    zip_file.writestr("combined_pre_processing.json", json.dumps(combined_pre_json, indent=2))
                
                if all_post_processing_json:
                    combined_post_json = {
                        'processing_session': {
                            'total_files': processed_file_count,
                            'timestamp': pd.Timestamp.now().isoformat()
                        },
                        'files': all_post_processing_json
                    }
                    zip_file.writestr("combined_post_processing.json", json.dumps(combined_post_json, indent=2))
                
                # Add summary
                summary_data = {
                    'Metric': ['Total Files Processed', 'Raw Records', 'Filtered Records', 'Success Rate'],
                    'Value': [
                        processed_file_count,
                        len(all_raw_records),
                        len(all_filtered_records),
                        f"{(len(all_filtered_records)/len(all_raw_records)*100):.1f}%" if all_raw_records else "0%"
                    ]
                }
                summary_df = pd.DataFrame(summary_data)
                summary_csv = io.StringIO()
                summary_df.to_csv(summary_csv, index=False)
                zip_file.writestr("summary.csv", summary_csv.getvalue())

            # Download buttons - 2x3 grid
            st.subheader("📥 Download Options")
            
            # Row 1: CSV files
            col1, col2, col3 = st.columns(3)
            
            with col1:
                if all_raw_records:
                    raw_csv_buffer = io.StringIO()
                    raw_df.to_csv(raw_csv_buffer, index=False)
                    st.download_button(
                        label="📄 Raw CSV",
                        data=raw_csv_buffer.getvalue(),
                        file_name="raw_data.csv",
                        mime="text/csv",
                        use_container_width=True
                    )
            
            with col2:
                if all_filtered_records:
                    filtered_csv_buffer = io.StringIO()
                    filtered_df.to_csv(filtered_csv_buffer, index=False)
                    st.download_button(
                        label="✅ Filtered CSV",
                        data=filtered_csv_buffer.getvalue(),
                        file_name="filtered_data.csv",
                        mime="text/csv",
                        use_container_width=True
                    )
            
            with col3:
                st.download_button(
                    label="📦 ZIP (All Data)",
                    data=zip_buffer.getvalue(),
                    file_name="pdf_extraction_results.zip",
                    mime="application/zip",
                    use_container_width=True
                )
            
            # Row 2: Excel files
            col1, col2, col3 = st.columns(3)
            
            with col1:
                if all_raw_records:
                    raw_excel_buffer = io.BytesIO()
                    with pd.ExcelWriter(raw_excel_buffer, engine='openpyxl') as writer:
                        raw_df.to_excel(writer, sheet_name='Raw Data', index=False)
                    st.download_button(
                        label="📊 Raw Excel",
                        data=raw_excel_buffer.getvalue(),
                        file_name="raw_data.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        use_container_width=True
                    )
            
            with col2:
                if all_filtered_records:
                    filtered_excel_buffer = io.BytesIO()
                    with pd.ExcelWriter(filtered_excel_buffer, engine='openpyxl') as writer:
                        filtered_df.to_excel(writer, sheet_name='Filtered Data', index=False)
                    st.download_button(
                        label="📊 Filtered Excel",
                        data=filtered_excel_buffer.getvalue(),
                        file_name="filtered_data.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        use_container_width=True
                    )
            
            with col3:
                # Empty column for alignment
                pass

            # Row 3: JSON files
            if all_pre_processing_json or all_post_processing_json:
                st.subheader("📄 JSON Downloads")
                col1, col2, col3, col4 = st.columns(4)
                
                with col1:
                    if all_pre_processing_json:
                        # Individual pre-processing JSON files
                        for i, json_data in enumerate(all_pre_processing_json):
                            filename = json_data.get('file_name', f'file_{i+1}')
                            json_name = filename.replace('.pdf', '_pre.json')
                            st.download_button(
                                label=f"📄 {json_name}",
                                data=json.dumps(json_data, indent=2),
                                file_name=json_name,
                                mime="application/json",
                                key=f"pre_json_{i}"
                            )
                
                with col2:
                    if all_post_processing_json:
                        # Individual post-processing JSON files
                        for i, json_data in enumerate(all_post_processing_json):
                            filename = json_data.get('file_name', f'file_{i+1}')
                            json_name = filename.replace('.pdf', '_post.json')
                            st.download_button(
                                label=f"📄 {json_name}",
                                data=json.dumps(json_data, indent=2),
                                file_name=json_name,
                                mime="application/json",
                                key=f"post_json_{i}"
                            )
                
                with col3:
                    if all_pre_processing_json:
                        # Combined pre-processing JSON
                        combined_pre_json = {
                            'processing_session': {
                                'total_files': processed_file_count,
                                'timestamp': pd.Timestamp.now().isoformat()
                            },
                            'files': all_pre_processing_json
                        }
                        st.download_button(
                            label="📄 Combined Pre JSON",
                            data=json.dumps(combined_pre_json, indent=2),
                            file_name="combined_pre_processing.json",
                            mime="application/json"
                        )
                
                with col4:
                    if all_post_processing_json:
                        # Combined post-processing JSON
                        combined_post_json = {
                            'processing_session': {
                                'total_files': processed_file_count,
                                'timestamp': pd.Timestamp.now().isoformat()
                            },
                            'files': all_post_processing_json
                        }
                        st.download_button(
                            label="📄 Combined Post JSON",
                            data=json.dumps(combined_post_json, indent=2),
                            file_name="combined_post_processing.json",
                            mime="application/json"
                        )

            # Show duplicate detection info
            if ENABLE_DUPLICATE_DETECTION and all_filtered_records and 'mobile' in filtered_df.columns:
                duplicates = processor.detect_duplicates(all_filtered_records)
                if duplicates:
                    st.warning(f"⚠️ Found {len(duplicates)} duplicate records based on mobile number.")
                else:
                    st.info("✅ No duplicate records found.")
        else:
            st.warning("No records extracted from the uploaded files.")

# Footer
st.markdown("---")
st.markdown("**Note:** Raw records contain all extracted data without validation. Filtered records contain only validated data with proper name format, valid mobile numbers, and addresses with street numbers.")
st.markdown("**Fields:** first_name, last_name, mobile, address, email, dateofbirth, landline, lastseen")