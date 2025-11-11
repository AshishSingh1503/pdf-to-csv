"""
working_document_processor.py

Minimal, drop-in WorkingDocumentProcessor class for Document AI PDF -> structured CSV processing.

Notes:
- Requires google-cloud-documentai library installed.
- Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path or pass credentials_path to the constructor.
- This file intentionally avoids async/queue infra — it is synchronous and simple.
"""

import os
import re
import math
import logging
import tempfile
from typing import List, Dict
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
from google.cloud import documentai_v1 as documentai
from google.api_core.client_options import ClientOptions

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class WorkingDocumentProcessor:
    def __init__(self, project_id: str, location: str, processor_id: str, credentials_path: str = None):
        """
        Initialize the Document processor.
        - project_id, location, processor_id: Document AI processor identifiers.
        - credentials_path: path to GOOGLE_APPLICATION_CREDENTIALS JSON (optional if env already set).
        """
        self.project_id = project_id
        self.location = location
        self.processor_id = processor_id

        if credentials_path:
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path

        opts = ClientOptions(api_endpoint=f"{location}-documentai.googleapis.com")
        self.client = documentai.DocumentProcessorServiceClient(client_options=opts)

    # -------------------------
    # Core processing
    # -------------------------
    def process_document(self, file_path: str) -> Dict:
        """Process a single document and return raw + filtered JSON."""
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

        raw_records = self._simple_grouping(entities)
        logger.info(f"Raw records: {len(raw_records)}")

        filtered_records = self._clean_and_validate(raw_records)
        logger.info(f"Filtered records: {len(filtered_records)}")

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

        return {
            'raw_records': raw_records,
            'filtered_records': filtered_records,
            'file_name': os.path.basename(file_path),
            'pre_processing_json': pre_processing_json,
            'post_processing_json': post_processing_json
        }

    def _call_custom_extractor(self, file_path: str, processor_id: str):
        processor_name = self.client.processor_path(self.project_id, self.location, processor_id)

        with open(file_path, "rb") as f:
            content = f.read()

        request = documentai.ProcessRequest(
            name=processor_name,
            raw_document=documentai.RawDocument(content=content, mime_type="application/pdf")
        )

        result = self.client.process_document(request=request)
        return result.document

    # -------------------------
    # Entity extraction + grouping
    # -------------------------
    def _extract_entities_simple(self, document):
        entities = []
        for entity in getattr(document, "entities", []):
            entity_type = entity.type_.lower().strip() if hasattr(entity, "type_") else getattr(entity, "type", "").lower().strip()
            entity_value = entity.mention_text.strip() if getattr(entity, "mention_text", None) else ""
            logger.info(f"Entity found: type='{entity_type}', value='{entity_value}'")
            entities.append({'type': entity_type, 'value': entity_value})
        logger.info(f"Total entities extracted: {len(entities)}")
        return entities

    def _simple_grouping(self, entities: List[Dict]) -> List[Dict]:
        records = []
        names = [e['value'] for e in entities if e['type'] == 'name']
        mobiles = [e['value'] for e in entities if e['type'] == 'mobile']
        addresses = [e['value'] for e in entities if e['type'] == 'address']
        emails = [e['value'] for e in entities if e['type'] == 'email']
        dateofbirths = [e['value'] for e in entities if e['type'] == 'dateofbirth']
        landlines = [e['value'] for e in entities if e['type'] == 'landline']
        lastseens = [e['value'] for e in entities if e['type'] == 'lastseen']

        logger.info(f"Found: {len(names)} names, {len(mobiles)} mobiles, {len(addresses)} addresses, {len(emails)} emails, {len(dateofbirths)} dateofbirths, {len(landlines)} landlines, {len(lastseens)} lastseens")

        max_count = max(len(names), len(mobiles), len(addresses), len(emails), len(dateofbirths), len(landlines), len(lastseens)) if any([names, mobiles, addresses, emails, dateofbirths, landlines, lastseens]) else 0

        for i in range(max_count):
            record = {}
            if i < len(names):
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

    # -------------------------
    # Cleaning helpers
    # -------------------------
    def _fix_address_ordering(self, address: str) -> str:
        if not address:
            return address
        address = address.strip()

        postcode_state_pattern = r'^([A-Z]{2,3}\s+\d{4})\s+(.+)$'
        match = re.match(postcode_state_pattern, address)
        if match:
            postcode_state = match.group(1)
            street_address = match.group(2)
            return f"{street_address} {postcode_state}"

        postcode_only_pattern = r'^(\d{4})\s+(.+?)\s+([A-Z]{2,3})$'
        match = re.match(postcode_only_pattern, address)
        if match:
            postcode = match.group(1)
            street_address = match.group(2)
            state = match.group(3)
            return f"{street_address} {state} {postcode}"

        state_postcode_middle_pattern = r'^(.+?)\s+([A-Z]{2,3}\s+\d{4})\s+(.+)$'
        match = re.match(state_postcode_middle_pattern, address)
        if match:
            street_part1 = match.group(1)
            state_postcode = match.group(2)
            street_part2 = match.group(3)
            return f"{street_part1} {street_part2} {state_postcode}"

        return address

    def _clean_name(self, name: str) -> str:
        if not name:
            return ''
        s = name.strip()
        s = s.replace('�', '').replace('･･･', '').replace('…', '').replace('•', '')
        s = s.replace('\u2026', '')
        s = re.sub(r'[\d\?]+', '', s)
        s = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]", '', s)
        s = re.sub(r'\s+', ' ', s).strip()
        parts = [p.capitalize() for p in s.split(' ')] if s else []
        return ' '.join(parts).strip()

    def _normalize_date_field(self, date_str: str) -> str:
        if not date_str:
            return ''
        s = date_str.strip()
        s = re.sub(r'[-\u2013\u2014]+', '-', s)
        s = re.sub(r'-{2,}', '-', s)
        s = re.sub(r'^[\-\s]+|[\-\s]+$', '', s)
        s = re.sub(r'[^0-9A-Za-z \-\/]', '', s)
        s = s.replace('.', '-')

        m = re.match(r'^(\d{1,2})([A-Za-z]{3,})(\d{4})$', s)
        if m:
            s = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

        try:
            dt = pd.to_datetime(s, dayfirst=True, errors='coerce')
            if pd.isna(dt):
                return ''
            return dt.strftime('%Y-%m-%d')
        except Exception:
            return ''

    def _clean_and_validate(self, records: List[Dict]) -> List[Dict]:
        clean_records = []

        for record in records:
            raw_first = record.get('first_name', '').strip()
            raw_last = record.get('last_name', '').strip()
            raw_dob = record.get('dateofbirth', '').strip()
            raw_lastseen = record.get('lastseen', '').strip()

            first_name = self._clean_name(raw_first)
            last_name = self._clean_name(raw_last)

            mobile = record.get('mobile', '').strip()
            address = record.get('address', '').strip()
            email = record.get('email', '').strip()
            landline = record.get('landline', '').strip()

            dateofbirth = self._normalize_date_field(raw_dob)
            lastseen = self._normalize_date_field(raw_lastseen)

            if not first_name:
                continue
            if len(first_name) <= 1:
                continue
            if not mobile:
                continue

            mobile_digits = re.sub(r'\D', '', mobile)
            # 10-digit Australian mobile starting with 04 (kept from original code)
            if not (len(mobile_digits) == 10 and mobile_digits.startswith('04')):
                continue

            # simple address check: require a digit in the first 15 chars
            if not address or not re.search(r'\d', address[:15]):
                continue

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

        unique_records = []
        seen_mobiles = set()
        for record in clean_records:
            mobile = record['mobile']
            if mobile not in seen_mobiles:
                unique_records.append(record)
                seen_mobiles.add(mobile)

        return unique_records

    # -------------------------
    # Duplicates & saving
    # -------------------------
    def detect_duplicates(self, records: List[Dict]) -> List[Dict]:
        if not records:
            return []
        mobile_counts = {}
        duplicates = []
        for record in records:
            mobile = record.get('mobile', '')
            mobile_counts.setdefault(mobile, []).append(record)
        for mobile, recs in mobile_counts.items():
            if len(recs) > 1:
                for r in recs:
                    r['duplicate_mobile'] = mobile
                    r['duplicate_count'] = len(recs)
                    duplicates.append(r)
        return duplicates

    def save_csv(self, records: List[Dict], output_path: str, include_metadata: bool = False, append: bool = False):
        """Save records to CSV. If append=True, append to existing file (header only if file not exists)."""
        if not records:
            logger.warning("No records to save")
            return
        df = pd.DataFrame(records)
        standard_columns = ['first_name', 'last_name', 'mobile', 'address', 'email', 'dateofbirth', 'landline', 'lastseen']
        if include_metadata:
            standard_columns.extend(['file_name', 'extraction_date'])
        available_columns = [col for col in standard_columns if col in df.columns]
        df = df[available_columns]

        write_header = True
        mode = 'w'
        if append and os.path.exists(output_path):
            write_header = False
            mode = 'a'

        df.to_csv(output_path, index=False, mode=mode, header=write_header)
        logger.info(f"💾 Saved {len(records)} records to {output_path}")

    def save_excel(self, records: List[Dict], output_path: str, include_metadata: bool = False):
        if not records:
            logger.warning("No records to save")
            return
        df = pd.DataFrame(records)
        standard_columns = ['first_name', 'last_name', 'mobile', 'address', 'email', 'dateofbirth', 'landline', 'lastseen']
        if include_metadata:
            standard_columns.extend(['file_name', 'extraction_date'])
        available_columns = [col for col in standard_columns if col in df.columns]
        df = df[available_columns]
        df.to_excel(output_path, index=False)
        logger.info(f"💾 Saved {len(records)} records to {output_path}")

    # -------------------------
    # Bulk processing (simple)
    # -------------------------
    def process_multiple_documents(self, file_paths: List[str]) -> Dict:
        """Legacy simple multi-file processor (keeps prior behavior)."""
        all_raw_records = []
        all_filtered_records = []
        processed_files = []

        for file_path in file_paths:
            try:
                result = self.process_document(file_path)
                if result:
                    all_raw_records.extend(result.get('raw_records', []))
                    all_filtered_records.extend(result.get('filtered_records', []))
                    processed_files.append(result.get('file_name', os.path.basename(file_path)))
            except Exception as e:
                logger.error(f"Error processing {file_path}: {e}")

        return {
            'raw_records': all_raw_records,
            'filtered_records': all_filtered_records,
            'processed_files': processed_files,
            'total_raw': len(all_raw_records),
            'total_filtered': len(all_filtered_records)
        }

    def process_multiple_documents_batched(self,
                                           file_paths: List[str],
                                           batch_size: int = 25,
                                           max_workers: int = 4,
                                           output_folder: str = None,
                                           save_per_file: bool = False) -> Dict:
        """
        Simple batched processing. Processes files in batches of `batch_size`.
        - Keeps the method synchronous and minimal.
        - Use save_per_file=True & output_folder to persist each file's filtered CSV immediately.
        """
        if not file_paths:
            return {'raw_records': [], 'filtered_records': [], 'processed_files': [], 'total_raw': 0, 'total_filtered': 0}

        if output_folder and save_per_file:
            os.makedirs(output_folder, exist_ok=True)

        all_raw_records = []
        all_filtered_records = []
        processed_files = []

        total_files = len(file_paths)
        total_batches = math.ceil(total_files / batch_size)

        for batch_idx in range(total_batches):
            start = batch_idx * batch_size
            end = min(start + batch_size, total_files)
            batch = file_paths[start:end]
            logger.info(f"Processing batch {batch_idx+1}/{total_batches}: files {start+1}-{end}")

            with ThreadPoolExecutor(max_workers=min(max_workers, len(batch))) as ex:
                future_to_path = {ex.submit(self.process_document, fp): fp for fp in batch}

                for fut in as_completed(future_to_path):
                    fp = future_to_path[fut]
                    try:
                        result = fut.result()
                    except Exception as e:
                        logger.error(f"Error processing {fp} in batch {batch_idx+1}: {e}")
                        continue

                    if not result:
                        continue

                    raw_rec = result.get('raw_records', [])
                    filt_rec = result.get('filtered_records', [])
                    fname = result.get('file_name', os.path.basename(fp))

                    all_raw_records.extend(raw_rec)
                    all_filtered_records.extend(filt_rec)
                    processed_files.append(fname)

                    if save_per_file and output_folder:
                        out_path = os.path.join(output_folder, f"{fname}.filtered.csv")
                        # One CSV per original PDF; overwrite if exists
                        self.save_csv(filt_rec, out_path, include_metadata=False, append=False)

            logger.info(f"Finished batch {batch_idx+1}/{total_batches}")

        return {
            'raw_records': all_raw_records,
            'filtered_records': all_filtered_records,
            'processed_files': processed_files,
            'total_raw': len(all_raw_records),
            'total_filtered': len(all_filtered_records)
        }
