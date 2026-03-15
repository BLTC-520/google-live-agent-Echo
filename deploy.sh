#!/usr/bin/env bash
set -euo pipefail

# ── Config — update these for your own GCP project ───────────────────────────
# Replace PROJECT_ID with your GCP project ID (gcloud config get-value project)
# Replace CLOUD_RUN_URL with the URL Cloud Run assigns after first deploy
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-savvy-pagoda-489720-v9}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
SERVICE_NAME="echo"
GCS_BUCKET="${GCS_BUCKET:-${PROJECT_ID}-echo-media}"
CLOUD_RUN_URL="${CLOUD_RUN_URL:-https://echo-535359416008.us-central1.run.app}"

# Load secrets from .env (never committed)
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "❌  GEMINI_API_KEY is not set. Add it to .env"
  exit 1
fi
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "❌  TELEGRAM_BOT_TOKEN is not set. Add it to .env"
  exit 1
fi

echo "🚀  Deploying ${SERVICE_NAME} to Cloud Run (${REGION})..."

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --platform managed \
  --allow-unauthenticated \
  --session-affinity \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 20 \
  --timeout 3600 \
  --concurrency 80 \
  --set-env-vars "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN},TELEGRAM_BOT_USERNAME=${TELEGRAM_BOT_USERNAME:-GoogleEchoAI_bot},GEMINI_API_KEY=${GEMINI_API_KEY},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_REGION=${REGION},GCS_BUCKET=${GCS_BUCKET},CLOUD_RUN_URL=${CLOUD_RUN_URL}"

echo ""
echo "✅  Deploy complete!"
echo "🌐  URL: ${CLOUD_RUN_URL}"
echo "💬  Live session: ${CLOUD_RUN_URL}/live"
