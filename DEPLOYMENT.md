# PDF2CSV GCP Deployment Guide

## Prerequisites

1. **Google Cloud SDK** installed and authenticated
2. **Docker** installed locally
3. **Node.js 18+** installed
4. **PostgreSQL** (for local testing)

## Quick Deployment

### 1. Setup GCP Infrastructure
```bash
# Make scripts executable
chmod +x setup-gcp.sh deploy.sh

# Run infrastructure setup
./setup-gcp.sh
```

### 2. Deploy Application
```bash
# Deploy to Cloud Run
./deploy.sh
```

## Manual Deployment Steps

### 1. Enable Required APIs
```bash
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable documentai.googleapis.com
```

### 2. Create Cloud SQL Instance
```bash
gcloud sql instances create pdf2csv-instance \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-type=SSD \
  --storage-size=10GB \
  --storage-auto-increase
```

### 3. Create Database
```bash
gcloud sql databases create pdf2csv_db --instance=pdf2csv-instance
```

### 4. Set Database Password
```bash
gcloud sql users set-password postgres \
  --instance=pdf2csv-instance \
  --password=postgres
```

### 5. Create Service Account
```bash
gcloud iam service-accounts create pdf2csv-service \
  --display-name="PDF2CSV Service Account"

# Grant permissions
gcloud projects add-iam-policy-binding pdf2csv-475708 \
  --member="serviceAccount:pdf2csv-service@pdf2csv-475708.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding pdf2csv-475708 \
  --member="serviceAccount:pdf2csv-service@pdf2csv-475708.iam.gserviceaccount.com" \
  --role="roles/storage.admin"
```

### 6. Build and Deploy Backend
```bash
cd server
gcloud builds submit --tag gcr.io/pdf2csv-475708/pdf2csv-backend:latest .
gcloud run deploy pdf2csv-backend \
  --image gcr.io/pdf2csv-475708/pdf2csv-backend:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --service-account pdf2csv-service@pdf2csv-475708.iam.gserviceaccount.com \
  --set-cloudsql-instances="pdf2csv-475708:us-central1:pdf2csv-instance" \
  --memory=4Gi \
  --cpu=2
```

### 7. Build and Deploy Frontend
```bash
cd ../client
gcloud builds submit --tag gcr.io/pdf2csv-475708/pdf2csv-frontend:latest .
gcloud run deploy pdf2csv-frontend \
  --image gcr.io/pdf2csv-475708/pdf2csv-frontend:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1
```

## Environment Variables

### Backend (Cloud Run)
- `NODE_ENV=production`
- `PORT=5000`
- `PROJECT_ID=pdf2csv-475708`
- `LOCATION=us`
- `PROCESSOR_ID=9f82bf3d2a02e2ab`
- `DB_HOST=/cloudsql/pdf2csv-475708:us-central1:pdf2csv-instance`
- `DB_PORT=5432`
- `DB_NAME=pdf2csv_db`
- `DB_USER=postgres`
- `DB_PASSWORD=postgres` (from secret)
- `DB_SSL=true`
- `INPUT_BUCKET=pdf-data-extraction-input-bucket`
- `OUTPUT_BUCKET=pdf-data-extraction-output-bucket`

### Frontend (Cloud Run)
- `REACT_APP_API_URL=https://pdf2csv-backend-xxxxx-uc.a.run.app`

## Database Schema

The application will automatically create the following tables:
- `collections` - Collection management
- `pre_process_records` - Raw extracted data
- `post_process_records` - Processed/cleaned data
- `file_metadata` - File upload tracking

## Cloud Storage

Files are stored in two buckets:
- `pdf-data-extraction-input-bucket` - Input PDFs
- `pdf-data-extraction-output-bucket` - Processed CSVs/Excel files

## Monitoring

- **Cloud Run Logs**: View in GCP Console > Cloud Run > Logs
- **Cloud SQL**: Monitor in GCP Console > SQL
- **Cloud Storage**: View in GCP Console > Storage

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check Cloud SQL instance is running
   - Verify connection name format
   - Check service account permissions

2. **File Upload Failed**
   - Verify Cloud Storage bucket exists
   - Check service account has storage permissions
   - Verify bucket names in environment variables

3. **Document AI Processing Failed**
   - Check Document AI processor is active
   - Verify processor ID is correct
   - Check service account has Document AI permissions

### Logs
```bash
# View backend logs
gcloud logs read --service=pdf2csv-backend --limit=50

# View frontend logs
gcloud logs read --service=pdf2csv-frontend --limit=50
```

## Cost Optimization

- **Cloud SQL**: Use `db-f1-micro` for development
- **Cloud Run**: Set minimum instances to 0
- **Cloud Storage**: Use Nearline storage for archived files
- **Document AI**: Monitor usage and set quotas

## Security

- Service account has minimal required permissions
- Database password stored in Secret Manager
- Cloud SQL uses private IP (when VPC connector is configured)
- All traffic uses HTTPS
