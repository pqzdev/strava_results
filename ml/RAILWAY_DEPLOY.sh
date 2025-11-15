#!/bin/bash

# Railway Deployment Script for ML API
# Run this manually: ./RAILWAY_DEPLOY.sh

set -e

echo "🚀 Deploying ML API to Railway"
echo ""

# Check if we're in the ml directory
if [ ! -f "inference_api.py" ]; then
    echo "❌ Error: Must run from ml/ directory"
    exit 1
fi

echo "✅ Found inference_api.py"
echo ""

# Check if models exist
if [ ! -f "models/parkrun_classifier_simple.pkl" ]; then
    echo "❌ Error: parkrun_classifier_simple.pkl not found"
    exit 1
fi

if [ ! -f "models/event_predictor.pkl" ]; then
    echo "❌ Error: event_predictor.pkl not found"
    exit 1
fi

echo "✅ Found model files"
echo ""

# Initialize Railway project (interactive)
echo "📦 Initializing Railway project..."
railway init

echo ""
echo "🚀 Deploying to Railway..."
railway up

echo ""
echo "🌐 Getting deployment URL..."
railway domain

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Test your API:"
echo "  curl https://YOUR-URL.railway.app/health"
echo ""
