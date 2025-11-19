#!/bin/bash

# Quick deployment script for Railway
# This will guide you through the Railway deployment

echo "🚀 Deploying ML Inference API to Railway"
echo ""
echo "When prompted:"
echo "  1. Select workspace: pqzdev's Projects"
echo "  2. Create new project: strava-ml-api (or similar name)"
echo "  3. Wait for deployment to complete"
echo ""
echo "Press ENTER to continue..."
read

cd "$(dirname "$0")"

# Check we're in the right place
if [ ! -f "inference_api.py" ]; then
    echo "❌ Error: Must be in ml/ directory"
    exit 1
fi

# Initialize Railway (interactive)
echo "📦 Step 1: Initializing Railway project..."
railway init || {
    echo "❌ Railway init failed. Make sure you're logged in: railway login"
    exit 1
}

echo ""
echo "✅ Railway project initialized!"
echo ""
echo "📤 Step 2: Deploying to Railway..."
railway up || {
    echo "❌ Deployment failed"
    exit 1
}

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Step 3: Getting your API URL..."
railway domain || railway domain create

echo ""
echo "✅ All done!"
echo ""
echo "Test your API:"
echo "  curl https://YOUR-URL.railway.app/health"
echo ""
