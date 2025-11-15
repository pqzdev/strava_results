#!/bin/bash

# Simple Railway deployment - run this in a regular terminal
# (not from within Claude Code)

echo "🚀 Railway ML API Deployment"
echo ""
echo "This will:"
echo "  1. Create a new Railway project: strava-ml-api"
echo "  2. Deploy the FastAPI inference service"
echo "  3. Generate a public URL"
echo ""
echo "Press ENTER to continue, or Ctrl+C to cancel..."
read

cd "$(dirname "$0")"

# Initialize Railway project
echo ""
echo "📦 Step 1: Initializing Railway project..."
echo "  → Select: kalvinoz's Projects"
echo "  → Create new: Yes"
echo "  → Name: strava-ml-api"
echo ""
railway init

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Failed to initialize Railway project"
    echo ""
    echo "Try these alternatives:"
    echo "  1. Web UI: open https://railway.app/new"
    echo "  2. Re-login: railway logout && railway login"
    exit 1
fi

# Deploy
echo ""
echo "🚀 Step 2: Deploying to Railway..."
echo ""
railway up

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Deployment failed"
    echo "Check logs: railway logs"
    exit 1
fi

# Get domain
echo ""
echo "🌐 Step 3: Setting up domain..."
echo ""
railway domain

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Your ML API is live!"
echo ""
echo "Test it:"
echo "  curl \$(railway domain 2>&1 | grep -o 'https://[^ ]*')/health"
echo ""
echo "View logs:"
echo "  railway logs"
echo ""
echo "Open in browser:"
echo "  railway open"
echo ""
