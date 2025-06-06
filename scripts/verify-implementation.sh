#!/bin/bash
# verify-implementation.sh
# Automated verification script for ensuring implementation completeness

echo "🔍 Running implementation verification..."
echo "========================================"

# Track overall status
FAILED=0

# 1. Run tests
echo ""
echo "📋 Running tests..."
if npm test; then
    echo "✅ All tests passed"
else
    echo "❌ Tests failed"
    FAILED=1
fi

# 2. Run lint
echo ""
echo "🔍 Running lint..."
if npm run lint; then
    echo "✅ Lint passed"
else
    echo "❌ Lint failed"
    FAILED=1
fi

# 3. Run type check
echo ""
echo "📐 Running type check..."
if npm run type-check; then
    echo "✅ Type check passed"
else
    echo "❌ Type check failed"  
    FAILED=1
fi

# 4. Check for TODO comments in implementation files
echo ""
echo "📝 Checking for TODO comments..."
TODO_COUNT=$(grep -r "TODO" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | wc -l)
if [ "$TODO_COUNT" -gt 0 ]; then
    echo "⚠️  Found $TODO_COUNT TODO comments:"
    grep -r "TODO" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | head -5
    if [ "$TODO_COUNT" -gt 5 ]; then
        echo "    ... and $((TODO_COUNT - 5)) more"
    fi
fi

# 5. Summary
echo ""
echo "========================================"
if [ $FAILED -eq 0 ]; then
    echo "✅ Implementation verified successfully!"
    exit 0
else
    echo "❌ Implementation verification failed!"
    echo ""
    echo "Next steps:"
    echo "1. Fix failing tests"
    echo "2. Address lint errors" 
    echo "3. Resolve type errors"
    echo "4. Re-run this script"
    exit 1
fi