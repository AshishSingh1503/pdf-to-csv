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
    
    def process_document(self, file_path: str) -> Dict:
        """Process a single document and return both raw and filtered records with JSON data"""
        logger.info(f"Processing document: {file_path}")

        document = self._call_custom_extractor(file_path, self.processor_id)

        entities = self._extract_entities_simple(document)
        logger.info(f"📊 Found {len(entities)} entities")
        
        if len(entities) == 0:
            logger.error("❌ NO ENTITIES FOUND - Check processor ID and document format")
            return {
                'raw_records': [],
                'filtered_records': [],
                'file_name': os.path.basename(file_path),
                'pre_processing_json': {},
                'post_processing_json': {}
            }
        
        # Get raw records (no filtering)
        raw_records = self._simple_grouping(entities)
        logger.info(f"Raw records: {len(raw_records)}")
        
        # Get filtered records (with validation)
        filtered_records = self._clean_and_validate(raw_records)
        logger.info(f"Filtered records: {len(filtered_records)}")
        
        # Create pre-processing records with full_name instead of first_name/last_name
        pre_processing_records = []
        for record in raw_records:
            pre_processing_records.append({
                'full_name': f"{record.get('first_name', '')} {record.get('last_name', '')}".strip(),
                'mobile': record.get('mobile', ''),
                'address': record.get('address', ''),
                'email': record.get('email', ''),
                'dateofbirth': record.get('dateofbirth', ''),
                'landline': record.get('landline', ''),
                'lastseen': record.get('lastseen', ''),
                'file_name': os.path.basename(file_path)
            })

        # Create pre-processing JSON (raw Document AI entities + records)
        pre_processing_json = {
            'file_name': os.path.basename(file_path),
            'processing_timestamp': pd.Timestamp.now().isoformat(),
            'raw_records': pre_processing_records,
            'document_ai_entities': entities,
            'total_entities': len(entities),
            'entity_types': list(set([e['type'] for e in entities])),
            'raw_text': document.text if hasattr(document, 'text') else '',
            'metadata': {
                'processor_id': self.processor_id,
                'project_id': self.project_id,
                'location': self.location
            }
        }
        
        # Create post-processing JSON (processed records)
        post_processing_json = {
            'file_name': os.path.basename(file_path),
            'processing_timestamp': pd.Timestamp.now().isoformat(),
            'raw_records': raw_records,
            'filtered_records': filtered_records,
            'summary': {
                'total_raw_records': len(raw_records),
                'total_filtered_records': len(filtered_records),
                'success_rate': f"{(len(filtered_records)/len(raw_records)*100):.1f}%" if raw_records else "0%"
            },
            'field_counts': {
                'names': len([r for r in raw_records if r.get('first_name')]),
                'mobiles': len([r for r in raw_records if r.get('mobile')]),
                'addresses': len([r for r in raw_records if r.get('address')]),
                'emails': len([r for r in raw_records if r.get('email')]),
                'dateofbirths': len([r for r in raw_records if r.get('dateofbirth')]),
                'landlines': len([r for r in raw_records if r.get('landline')]),
                'lastseens': len([r for r in raw_records if r.get('lastseen')])
            },
            'metadata': {
                'processor_id': self.processor_id,
                'project_id': self.project_id,
                'location': self.location
            }
        }
        
        # Return both raw and filtered with JSON data
        return {
            'raw_records': raw_records,
            'filtered_records': filtered_records,
            'file_name': os.path.basename(file_path),
            'pre_processing_json': pre_processing_json,
            'post_processing_json': post_processing_json
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
            entity_type = entity.type_.lower().strip()
            entity_value = entity.mention_text.strip()
            
            # Debug logging
            logger.info(f"Entity found: type='{entity_type}', value='{entity_value}'")
            
            entities.append({
                'type': entity_type,
                'value': entity_value
            })
        
        logger.info(f"Total entities extracted: {len(entities)}")
        return entities
    
    def _simple_grouping(self, entities: List[Dict]) -> List[Dict]:
        """Group entities into records without filtering"""
        records = []
        names = [e['value'] for e in entities if e['type'] == 'name']
        mobiles = [e['value'] for e in entities if e['type'] == 'mobile']
        addresses = [e['value'] for e in entities if e['type'] == 'address']
        emails = [e['value'] for e in entities if e['type'] == 'email']
        dateofbirths = [e['value'] for e in entities if e['type'] == 'dateofbirth']
        landlines = [e['value'] for e in entities if e['type'] == 'landline']
        lastseens = [e['value'] for e in entities if e['type'] == 'lastseen']
        
        logger.info(f"Found: {len(names)} names, {len(mobiles)} mobiles, {len(addresses)} addresses, {len(emails)} emails, {len(dateofbirths)} dateofbirths, {len(landlines)} landlines, {len(lastseens)} lastseens")
        
        # Debug: Show what entity types we found
        entity_types = [e['type'] for e in entities]
        logger.info(f"Entity types found: {set(entity_types)}")
        
        max_count = max(len(names), len(mobiles), len(addresses), len(emails), len(dateofbirths), len(landlines), len(lastseens)) if any([names, mobiles, addresses, emails, dateofbirths, landlines, lastseens]) else 0
        
        for i in range(max_count):
            record = {}
            
            if i < len(names):
                # Split name into first and last
                name_parts = names[i].split()
                if len(name_parts) >= 2:
                    record['first_name'] = name_parts[0]
                    record['last_name'] = ' '.join(name_parts[1:])
                else:
                    record['first_name'] = names[i]
                    record['last_name'] = ''
            if i < len(mobiles):
                record['mobile'] = mobiles[i]
            if i < len(addresses):
                record['address'] = addresses[i]
            if i < len(emails):
                record['email'] = emails[i]
            if i < len(dateofbirths):
                record['dateofbirth'] = dateofbirths[i]
            if i < len(landlines):
                record['landline'] = landlines[i]
            if i < len(lastseens):
                record['lastseen'] = lastseens[i]
            
            if record.get('first_name'):
                records.append(record)
                logger.info(f"Created record {i+1}: {record}")
        
        logger.info(f"Created {len(records)} records total")
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

    def _clean_name(self, name: str) -> str:
        """
        Minimal cleaning for names:
        - Remove weird unicode artifacts, ellipses, bullets
        - Remove digits (including trailing zeros) and question marks
        - Remove stray punctuation except - and '
        - Collapse whitespace and title-case
        """
        if not name:
            return ''
        s = name.strip()

        # remove common weird OCR characters
        s = s.replace('�', '').replace('･･･', '').replace('…', '').replace('•', '')
        s = s.replace('\u2026', '')  # ellipsis
        # remove digits and question marks anywhere
        s = re.sub(r'[\d\?]+', '', s)
        # remove punctuation except letters, spaces, hyphen, apostrophe
        s = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]", '', s)
        # collapse multiple spaces
        s = re.sub(r'\s+', ' ', s).strip()
        # title-case but preserve existing internal capitalization of hyphenated names
        parts = [p.capitalize() for p in s.split(' ')] if s else []
        return ' '.join(parts).strip()

    def _normalize_date_field(self, date_str: str) -> str:
        """
        Minimal OCR-tolerant date normalization.
        Returns ISO date 'YYYY-MM-DD' or '' if unparseable.
        Handles examples like:
            '26Jul--1971' -> '1971-07-26'
            '15Aug--2022' -> '2022-08-15'
            '07Aug-2019-' -> '2019-08-07'
            '17-Jun-1970' -> '1970-06-17'
        """
        if not date_str:
            return ''
        s = date_str.strip()

        # Replace weird double hyphens and similar with single hyphen
        s = re.sub(r'[-\u2013\u2014]+', '-', s)        # handle em/en dashes
        s = re.sub(r'-{2,}', '-', s)                  # multiple hyphens -> single
        # remove trailing/leading hyphens or stray non-alphanumeric except / or -
        s = re.sub(r'^[\-\s]+|[\-\s]+$', '', s)
        s = re.sub(r'[^0-9A-Za-z \-\/]', '', s)
        s = s.replace('.', '-')  # dots to hyphen

        # common OCR glue: 25Jul1962 -> insert hyphen between alpha and digits if needed
        m = re.match(r'^(\d{1,2})([A-Za-z]{3,})(\d{4})$', s)
        if m:
            s = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

        # try parsing using pandas (dayfirst)
        try:
            dt = pd.to_datetime(s, dayfirst=True, errors='coerce')
            if pd.isna(dt):
                return ''
            return dt.strftime('%Y-%m-%d')
        except Exception:
            return ''

    def _clean_and_validate(self, records: List[Dict]) -> List[Dict]:
        """Clean validation - mobile required, proper name format, address validation"""
        clean_records = []
        
        for record in records:
            # raw values from the record
            raw_first = record.get('first_name', '').strip()
            raw_last = record.get('last_name', '').strip()
            raw_dob = record.get('dateofbirth', '').strip()
            raw_lastseen = record.get('lastseen', '').strip()

            # minimal cleaning requested: only clean names and normalize dates
            first_name = self._clean_name(raw_first)
            last_name = self._clean_name(raw_last)

            # keep the original 'mobile', 'address', etc. variables as you had them
            mobile = record.get('mobile', '').strip()
            address = record.get('address', '').strip()
            email = record.get('email', '').strip()
            landline = record.get('landline', '').strip()

            # normalize date fields to ISO or empty (no other validation)
            dateofbirth = self._normalize_date_field(raw_dob)
            lastseen = self._normalize_date_field(raw_lastseen)
            
            if not first_name:
                continue
            
            if len(first_name) <= 1:
                continue

            if not mobile:
                continue
                
            mobile_digits = re.sub(r'\D', '', mobile)
            if not (len(mobile_digits) == 10 and mobile_digits.startswith('04')):
                continue

            if not address or not re.search(r'\d', address[:15]):
                continue
            
            # Fix address ordering
            fixed_address = self._fix_address_ordering(address)
            
            clean_records.append({
                'first_name': first_name,
                'last_name': last_name, 
                'mobile': mobile_digits,
                'address': fixed_address,
                'email': email if email else '',
                'dateofbirth': dateofbirth if dateofbirth else '',
                'landline': landline if landline else '',
                'lastseen': lastseen if lastseen else ''
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
        standard_columns = ['first_name', 'last_name', 'mobile', 'address', 'email', 'dateofbirth', 'landline', 'lastseen']
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
        standard_columns = ['first_name', 'last_name', 'mobile', 'address', 'email', 'dateofbirth', 'landline', 'lastseen']
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
