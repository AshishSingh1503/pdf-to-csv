#!/bin/bash

# GCP Infrastructure Setup Script
set -e

PROJECT_ID="pdf2csv-475708"
REGION="us-central1"
ZONE="us-central1-a"
INSTANCE_NAME="pdf2csv-instance"
DATABASE_NAME="pdf2csv_db"
SERVICE_ACCOUNT="pdf2csv-service@pdf2csv-475708.iam.gserviceaccount.com"

# NOTE: This script creates a db-f1-micro instance for development/testing.
# For production high-performance workloads (8 vGPU/64GB backend), consider:
# - Upgrading to db-custom-4-15360 or higher (4 vCPUs, 15GB RAM)
# - Enabling high availability (--availability-type=REGIONAL)
# - Increasing storage size based on data volume
# - Configuring connection pooling (PgBouncer) for 500+ connections
# See: https://cloud.google.com/sql/docs/postgres/instance-settings

echo "🏗️ Setting up GCP infrastructure for PDF2CSV..."

# 1. Set project
gcloud config set project $PROJECT_ID

# 2. Enable required APIs
echo "📋 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable documentai.googleapis.com
gcloud services enable iam.googleapis.com

# 3. Create Cloud SQL instance
echo "🗄️ Creating Cloud SQL instance..."
gcloud sql instances create $INSTANCE_NAME \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=$REGION \
  --storage-type=SSD \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=03:00 \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=03 \
  --maintenance-release-channel=production

echo "⚠️  Note: Created db-f1-micro instance for development."
echo "    For production high-performance workloads, upgrade the instance tier:" 
echo "    gcloud sql instances patch $INSTANCE_NAME --tier=db-custom-4-15360"
echo ""

# 4. Create database
echo "📊 Creating database..."
gcloud sql databases create $DATABASE_NAME --instance=$INSTANCE_NAME

# 5. Set root password
echo "🔐 Setting database password..."
gcloud sql users set-password postgres \
  --instance=$INSTANCE_NAME \
  --password=postgres

# 6. Create service account
echo "👤 Creating service account..."
gcloud iam service-accounts create pdf2csv-service \
  --display-name="PDF2CSV Service Account" \
  --description="Service account for PDF2CSV application"

# 7. Grant necessary permissions
echo "🔑 Granting permissions..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/documentai.apiUser"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/cloudbuild.builds.builder"

# 8. Create secret for database password
echo "🔐 Creating secret for database password..."
echo -n "postgres" | gcloud secrets create db-password --data-file=-

# 9. Grant Cloud Run access to secret
gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"

# 10. Get Cloud SQL connection name
CONNECTION_NAME=$(gcloud sql instances describe $INSTANCE_NAME --format="value(connectionName)")
echo "✅ Cloud SQL connection name: $CONNECTION_NAME"

# 11. Create VPC connector for Cloud Run to Cloud SQL
echo "🌐 Creating VPC connector..."
gcloud compute networks vpc-access connectors create pdf2csv-connector \
  --region=$REGION \
  --subnet=default \
  --subnet-project=$PROJECT_ID \
  --min-instances=2 \
  --max-instances=3

echo "🎉 GCP infrastructure setup completed!"
echo "Cloud SQL instance: $INSTANCE_NAME"
echo "Database: $DATABASE_NAME"
echo "Connection name: $CONNECTION_NAME"
echo "Service account: $SERVICE_ACCOUNT"
