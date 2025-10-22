import os
import re
import pandas as pd
from google.cloud import documentai_v1 as documentai
from google.api_core.client_options import ClientOptions
from typing import List, Dict
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WorkingDocumentProcessor:
    def __init__(self, project_id: str, location: str, processor_id: str, credentials_path: str):
        self.project_id = project_id
        self.location = location
        self.processor_id = processor_id
        self.credentials_path = credentials_path
        
        # Set credentials
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path
        
        opts = ClientOptions(api_endpoint=f"{location}-documentai.googleapis.com")
        self.client = documentai.DocumentProcessorServiceClient(client_options=opts)
    
    def process_document(self, file_path: str) -> List[Dict]:
        """Process a single document and return both raw and filtered records"""
        logger.info(f"Processing document: {file_path}")

        document = self._call_custom_extractor(file_path, self.processor_id)

        entities = self._extract_entities_simple(document)
        logger.info(f"📊 Found {len(entities)} entities")
        
        if len(entities) == 0:
            logger.error("❌ NO ENTITIES FOUND - Check processor ID and document format")
            return []
        
        # Get raw records (no filtering)
        raw_records = self._simple_grouping(entities)
        logger.info(f"Raw records: {len(raw_records)}")
        
        # Get filtered records (with validation)
        filtered_records = self._clean_and_validate(raw_records)
        logger.info(f"Filtered records: {len(filtered_records)}")
        
        # Return both raw and filtered
        return {
            'raw_records': raw_records,
            'filtered_records': filtered_records,
            'file_name': os.path.basename(file_path)
        }
    
    def _call_custom_extractor(self, file_path: str, processor_id: str):
        processor_name = self.client.processor_path(
            self.project_id, self.location, processor_id
        )
        
        with open(file_path, "rb") as f:
            content = f.read()
        
        request = documentai.ProcessRequest(
            name=processor_name,
            raw_document=documentai.RawDocument(
                content=content,
                mime_type="application/pdf"
            )
        )
        
        result = self.client.process_document(request=request)
        return result.document
    
    def _extract_entities_simple(self, document):
        entities = []
        
        for entity in document.entities:
            entities.append({
                'type': entity.type_.lower().strip(),
                'value': entity.mention_text.strip()
            })
        
        return entities
    
    def _simple_grouping(self, entities: List[Dict]) -> List[Dict]:
        """Group entities into records without filtering"""
        records = []
        names = [e['value'] for e in entities if 'name' in e['type']]
        mobiles = [e['value'] for e in entities if 'mobile' in e['type'] or 'phone' in e['type']]
        addresses = [e['value'] for e in entities if 'address' in e['type']]
        emails = [e['value'] for e in entities if 'email' in e['type']]
        
        logger.info(f"Found: {len(names)} names, {len(mobiles)} mobiles, {len(addresses)} addresses, {len(emails)} emails")
        max_count = max(len(names), len(mobiles), len(addresses), len(emails)) if any([names, mobiles, addresses, emails]) else 0
        
        for i in range(max_count):
            record = {}
            
            if i < len(names):
                record['name'] = names[i]
            if i < len(mobiles):
                record['mobile'] = mobiles[i]
            if i < len(addresses):
                record['address'] = addresses[i]
            if i < len(emails):
                record['email'] = emails[i]
            
            if record.get('name'):
                records.append(record)
        
        return records
    
    def _fix_address_ordering(self, address: str) -> str:
        """Fix address ordering where postcode/state appears before street address"""
        if not address:
            return address
            
        address = address.strip()
        
        # Pattern 1: Postcode and state at the beginning
        # Matches: NSW 2289 114 Northcott Drive ADAMSTOWN HEIGHTS
        postcode_state_pattern = r'^([A-Z]{2,3}\s+\d{4})\s+(.+)$'
        match = re.match(postcode_state_pattern, address)
        
        if match:
            postcode_state = match.group(1)  # NSW 2289
            street_address = match.group(2)  # 114 Northcott Drive ADAMSTOWN HEIGHTS
            # Reorder: street_address + postcode_state
            return f"{street_address} {postcode_state}"
        
        # Pattern 2: Postcode at the beginning without state
        # Matches: 2289 114 Northcott Drive ADAMSTOWN HEIGHTS NSW
        postcode_only_pattern = r'^(\d{4})\s+(.+?)\s+([A-Z]{2,3})$'
        match = re.match(postcode_only_pattern, address)
        
        if match:
            postcode = match.group(1)  # 2289
            street_address = match.group(2)  # 114 Northcott Drive ADAMSTOWN HEIGHTS
            state = match.group(3)  # NSW
            # Reorder: street_address + state + postcode
            return f"{street_address} {state} {postcode}"
        
        # Pattern 3: State and postcode in the middle
        # Matches: 114 Northcott Drive NSW 2289 ADAMSTOWN HEIGHTS
        state_postcode_middle_pattern = r'^(.+?)\s+([A-Z]{2,3}\s+\d{4})\s+(.+)$'
        match = re.match(state_postcode_middle_pattern, address)
        
        if match:
            street_part1 = match.group(1)  # 114 Northcott Drive
            state_postcode = match.group(2)  # NSW 2289
            street_part2 = match.group(3)  # ADAMSTOWN HEIGHTS
            # Reorder: street_part1 + street_part2 + state_postcode
            return f"{street_part1} {street_part2} {state_postcode}"
        
        return address

    def _clean_and_validate(self, records: List[Dict]) -> List[Dict]:
        """Clean validation - mobile required, proper name format, address validation"""
        clean_records = []
        
        for record in records:
            name = record.get('name', '').strip()
            mobile = record.get('mobile', '').strip()  
            address = record.get('address', '').strip()
            email = record.get('email', '').strip()
            
            if not name:
                continue
            
            name_parts = name.split()
            if len(name_parts) < 2:
                continue
                
            first_name = name_parts[0]
            last_name = name_parts[1] 
            
            if len(first_name) <= 1:
                continue

            if not mobile:
                continue
                
            mobile_digits = re.sub(r'\D', '', mobile)
            if not (len(mobile_digits) == 10 and mobile_digits.startswith('04')):
                continue

            if not address or not re.search(r'\d', address[:10]):
                continue
            
            # Fix address ordering
            fixed_address = self._fix_address_ordering(address)
            
            clean_records.append({
                'first_name': first_name,
                'last_name': last_name, 
                'mobile': mobile_digits,
                'address': fixed_address,
                'email': email if email else ''
            })
        
        # Remove duplicates based on mobile
        unique_records = []
        seen_mobiles = set()
        
        for record in clean_records:
            mobile = record['mobile']
            if mobile not in seen_mobiles:
                unique_records.append(record)
                seen_mobiles.add(mobile)
        
        return unique_records
    
    def detect_duplicates(self, records: List[Dict]) -> List[Dict]:
        """Detect duplicate records based on mobile number"""
        if not records:
            return []
        
        mobile_counts = {}
        duplicates = []
        
        for record in records:
            mobile = record.get('mobile', '')
            if mobile in mobile_counts:
                mobile_counts[mobile].append(record)
            else:
                mobile_counts[mobile] = [record]
        
        for mobile, records_list in mobile_counts.items():
            if len(records_list) > 1:
                for record in records_list:
                    record['duplicate_mobile'] = mobile
                    record['duplicate_count'] = len(records_list)
                    duplicates.append(record)
        
        return duplicates
    
    def save_csv(self, records: List[Dict], output_path: str, include_metadata: bool = False):
        """Save records to CSV"""
        if not records:
            logger.warning("No records to save")
            return
        
        df = pd.DataFrame(records)
        
        # Standardize column order
        standard_columns = ['first_name', 'last_name', 'mobile', 'address', 'email']
        if include_metadata:
            standard_columns.extend(['file_name', 'extraction_date'])
        
        # Only include columns that exist in the data
        available_columns = [col for col in standard_columns if col in df.columns]
        df = df[available_columns]
        
        df.to_csv(output_path, index=False)
        logger.info(f"💾 Saved {len(records)} records to {output_path}")

    def save_excel(self, records: List[Dict], output_path: str, include_metadata: bool = False):
        """Save records to Excel"""
        if not records:
            logger.warning("No records to save")
            return
        
        df = pd.DataFrame(records)
        
        # Standardize column order
        standard_columns = ['first_name', 'last_name', 'mobile', 'address', 'email']
        if include_metadata:
            standard_columns.extend(['file_name', 'extraction_date'])
        
        # Only include columns that exist in the data
        available_columns = [col for col in standard_columns if col in df.columns]
        df = df[available_columns]
        
        df.to_excel(output_path, index=False)
        logger.info(f"💾 Saved {len(records)} records to {output_path}")

    def process_multiple_documents(self, file_paths: List[str]) -> Dict:
        """Process multiple documents and return combined results"""
        all_raw_records = []
        all_filtered_records = []
        processed_files = []
        
        for file_path in file_paths:
            try:
                result = self.process_document(file_path)
                if result:
                    all_raw_records.extend(result['raw_records'])
                    all_filtered_records.extend(result['filtered_records'])
                    processed_files.append(result['file_name'])
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}")
        
        return {
            'raw_records': all_raw_records,
            'filtered_records': all_filtered_records,
            'processed_files': processed_files,
            'total_raw': len(all_raw_records),
            'total_filtered': len(all_filtered_records)
        }