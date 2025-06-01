#!/bin/bash
set -e

echo "🧪 Testing Infrastructure Setup..."

echo "📦 Testing package installation..."
npm install

echo "🔧 Testing TypeScript compilation..."
npm run type-check

echo "🎨 Testing code formatting..."
npm run format

echo "🔍 Testing linting..."
npm run lint

echo "🏗️  Testing production build..."
npm run build

echo "🧪 Testing Jest framework..."
npm test

echo "✅ All infrastructure tests passed!"