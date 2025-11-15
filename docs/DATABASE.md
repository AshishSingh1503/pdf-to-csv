# Database Guide

This document describes the PostgreSQL database used by pdf-to-csv: setup instructions, schema reference, migrations, and reference SQL scripts.

## 1. Overview

The application uses PostgreSQL to store collections, file metadata, pre-processed records, post-processed records, and auxiliary lookup tables. Key concepts:
- `customers` — tenant or account owner
- `collections` — logical grouping of files belonging to a customer
- `file_metadata` — per-file tracking and processing status
- `pre_process_records` / `post_process_records` — extracted raw and validated records

## 2. Database Setup

Prerequisites: PostgreSQL 12+ installed (or Cloud SQL for production). Create a role/user for the application (example: `pdf2csv_app_user`).

Run the canonical setup script to create schema and initial data:

```powershell
psql -U pdf2csv_user -d pdf2csv_db -f setup_new_db.sql
```

For detailed database documentation including schema reference, migrations, and maintenance, see [docs/DATABASE.md](docs/DATABASE.md).

If you need to reset a local development database, manually drop the tables and re-run the setup script:

```sql
-- Run inside psql or via a script
DROP TABLE IF EXISTS file_metadata, post_process_records, pre_process_records, collections, customers CASCADE;
\i setup_new_db.sql
```

Note: An archived recreation script exists at `archive/recreate_db.sql` for historical reference.

## 3. Schema Reference

Below are the primary tables used by the application.

- customers

  | Column | Type | Notes |
  |---|---|---|
  | id | SERIAL PRIMARY KEY | |
  | name | VARCHAR(255) | |
  | email | VARCHAR(255) | |
  | phone | VARCHAR(20) | |
  | created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

- collections

  | Column | Type | Notes |
  |---|---|---|
  | id | SERIAL PRIMARY KEY | |
  | customer_id | INTEGER | FK -> customers(id) ON DELETE CASCADE |
  | name | VARCHAR(255) | UNIQUE |
  | description | TEXT | |
  | status | VARCHAR(20) | DEFAULT 'active' |
  | created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

- pre_process_records

  | Column | Type | Notes |
  |---|---|---|
  | id | SERIAL PRIMARY KEY | |
  | collection_id | INTEGER | FK -> collections(id) |
  | full_name | VARCHAR(255) | raw extracted name |
  | mobile | VARCHAR(20) | |
  | email | VARCHAR(255) | |
  | address | TEXT | |
  | dateofbirth | VARCHAR(50) | raw date string |
  | landline | VARCHAR(20) | |
  | lastseen | VARCHAR(50) | |
  | file_name | VARCHAR(255) | source file name |
  | processing_timestamp | TIMESTAMP | when it was extracted |
  | created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

- post_process_records

  | Column | Type | Notes |
  |---|---|---|
  | id | SERIAL PRIMARY KEY | |
  | collection_id | INTEGER | FK -> collections(id) |
  | first_name | VARCHAR(255) | normalized |
  | last_name | VARCHAR(255) | normalized |
  | mobile | VARCHAR(20) | normalized digits |
  | email | VARCHAR(255) | |
  | address | TEXT | normalized |
  | dateofbirth | VARCHAR(50) | normalized ISO yyyy-mm-dd |
  | landline | VARCHAR(20) | |
  | lastseen | VARCHAR(50) | |
  | file_name | VARCHAR(255) | |
  | processing_timestamp | TIMESTAMP | when validation completed |
  | created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

- file_metadata

  | Column | Type | Notes |
  |---|---|---|
  | id | SERIAL PRIMARY KEY | |
  | collection_id | INTEGER | FK -> collections(id) |
  | original_filename | VARCHAR(255) | |
  | cloud_storage_path | VARCHAR(500) | |
  | file_size | BIGINT | bytes |
  | processing_status | VARCHAR(20) | 'processing' | 'completed' | 'failed' |
  | upload_progress | INTEGER | 0-100 |
  | batch_id | VARCHAR(50) | identifier for batch grouping (indexed) |
  | created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

Index: `idx_file_metadata_batch_id` exists on `file_metadata(batch_id)` to speed batch queries.

## 4. Migrations

Migrations are stored in the `migrations/` folder. The current migration adds `batch_id` to `file_metadata`:

- `migrations/add_batch_id_to_file_metadata.sql`

Apply migrations manually by executing the SQL files against your database in order. The project does not currently include an automated migration runner.

## 5. SQL Scripts Reference

- `setup_new_db.sql` (root) — canonical database setup script (creates tables, roles, permissions, initial data)
- `docs/sql/insert_test_data.sql` — convenience script to insert additional test data during development
- `docs/sql/database_validation_queries.sql` — diagnostic queries for batch processing validation and debugging
- `archive/recreate_db.sql` — archived reset script (historical reference)
- `server/db/schema.sql` — legacy/incomplete schema (not used)

## 6. Validation and Debugging

Use the diagnostic queries in `docs/sql/database_validation_queries.sql` for health checks and troubleshooting (stuck files, missing batch_ids, batch stats). Refer to `docs/DEBUGGING.md` for batch-level troubleshooting steps.

## 7. Maintenance

- Backups: schedule regular logical backups (pg_dump) or use Cloud SQL automated backups.
- Indexes: monitor usage and rebuild if necessary.
- Connection pool: tune DB_POOL_MAX and use PgBouncer for high-concurrency workloads.

## 8. Local Development

Use Docker for a local Postgres instance during development. Example:

```powershell
docker run --name pdf2csv-db -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=pdf2csv -p 5432:5432 -d postgres:15
```

Run `setup_new_db.sql` after the container is ready.
