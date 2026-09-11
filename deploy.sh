#!/bin/bash
set -e

# Increase Node memory allocation for low-RAM VPS servers (2GB RAM)
export NODE_OPTIONS="--max-old-space-size=1536"

echo "========================================================="
echo " Starting inkCRM Production Deployment Automation"
echo " Time: $(date)"
echo " Memory Limit: $NODE_OPTIONS"
echo "========================================================="

# 1. Pull latest code
echo "Checking git status..."
git status

# 2. Verify environment files exist
if [ ! -f "backend/.env" ]; then
  echo "❌ Error: backend/.env is missing! Deployment aborted."
  echo "Please configure your environment variables based on backend/.env.example."
  exit 1
fi

if [ ! -f "frontend/.env" ]; then
  echo "⚠️ Warning: frontend/.env is missing! Creating default frontend/.env..."
  echo "VITE_API_URL=/api/v1" > frontend/.env
  echo "VITE_FILE_BASE_URL=" >> frontend/.env
fi

# Clean old build artifacts to force fresh compilation
echo "Cleaning old build artifacts..."
rm -rf backend/dist frontend/dist

# 3. Install backend dependencies and build
echo "Installing backend dependencies..."
cd backend
npm install
chmod +x node_modules/.bin/* 2>/dev/null || true
echo "Compiling TypeScript backend..."
npx tsc
cd ..

# 4. Install frontend dependencies and build
echo "Installing frontend dependencies..."
cd frontend
npm install
chmod +x node_modules/.bin/* 2>/dev/null || true
echo "Building React frontend production package..."
npx vite build
cd ..

# 5. Verify build success and run pre-deployment checks
echo "Running Pre-deployment Validation Checks..."
node predeploy.js

# 6. Restore MongoDB from repository database-dump (if database is empty or needs restore)
echo "Restoring database from database-dump..."
node database-dump/restore.js || true

# 7. PM2 worker configurations & startup
echo "Configuring and reloading PM2 cluster processes..."
pm2 reload ecosystem.config.cjs --env production || pm2 start ecosystem.config.cjs --env production

# Save PM2 process list to persist across OS reboots
pm2 save

echo "========================================================="
echo " inkCRM Production Deployment Completed Successfully! 🎉"
echo "========================================================="
