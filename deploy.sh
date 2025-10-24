#!/bin/bash

# PDF2CSV GCP Deployment Script
set -e

# Configuration
PROJECT_ID="pdf2csv-475708"
REGION="us-central1"
SERVICE_ACCOUNT="805037964827-compute@developer.gserviceaccount.com"

echo "🚀 Starting PDF2CSV deployment to GCP..."

# 1. Enable required APIs
echo "📋 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable documentai.googleapis.com

# 2. Set project
gcloud config set project $PROJECT_ID

# 3. Build and push backend Docker image
echo "🐳 Building backend Docker image..."
cd server
gcloud builds submit --tag gcr.io/$PROJECT_ID/pdf2csv-backend:latest .

# 4. Build and push frontend Docker image
echo "🐳 Building frontend Docker image..."
cd ../client
gcloud builds submit --tag gcr.io/$PROJECT_ID/pdf2csv-frontend:latest .

# 5. Deploy backend to Cloud Run
echo "🚀 Deploying backend to Cloud Run..."
cd ../server
gcloud run deploy pdf2csv-backend \
  --image gcr.io/$PROJECT_ID/pdf2csv-backend:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --service-account $SERVICE_ACCOUNT \
  --set-env-vars="NODE_ENV=production,PROJECT_ID=$PROJECT_ID,LOCATION=us,PROCESSOR_ID=9f82bf3d2a02e2ab,INPUT_BUCKET=pdf-data-extraction-input-bucket,OUTPUT_BUCKET=pdf-data-extraction-output-bucket,STORAGE_LOCATION=us,DB_HOST=/cloudsql/pdf2csv-475708:us-central1:pdf2csv-instance,DB_PORT=5432,DB_NAME=pdf2csv_db,DB_USER=805037964827-compute@developer,DB_SSL=true" \
  --set-cloudsql-instances="pdf2csv-475708:us-central1:pdf2csv-instance" \
  --memory=4Gi \
  --cpu=2 \
  --timeout=300

# 6. Get backend URL
BACKEND_URL=$(gcloud run services describe pdf2csv-backend --platform managed --region $REGION --format 'value(status.url)')
echo "✅ Backend deployed at: $BACKEND_URL"

# 7. Deploy frontend to Cloud Run
echo "🚀 Deploying frontend to Cloud Run..."
cd ../client
gcloud run deploy pdf2csv-frontend \
  --image gcr.io/$PROJECT_ID/pdf2csv-frontend:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars="REACT_APP_API_URL=$BACKEND_URL" \
  --memory=1Gi \
  --cpu=1

# 8. Get frontend URL
FRONTEND_URL=$(gcloud run services describe pdf2csv-frontend --platform managed --region $REGION --format 'value(status.url)')
echo "✅ Frontend deployed at: $FRONTEND_URL"

echo "🎉 Deployment completed successfully!"
echo "Frontend URL: $FRONTEND_URL"
echo "Backend URL: $BACKEND_URL"
