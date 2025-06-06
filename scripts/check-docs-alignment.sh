#!/bin/bash
# check-docs-alignment.sh
# Verify documentation is aligned with implementation

echo "📚 Checking documentation alignment..."
echo "========================================"

WARNINGS=0

# 1. Check for undocumented exports
echo ""
echo "🔍 Checking for undocumented public exports..."
UNDOCUMENTED=$(grep -r "export" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | \
    grep -E "(class|function|interface|const)" | \
    grep -v "test" | \
    while read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        line_num=$(grep -n "$line" "$file" 2>/dev/null | cut -d: -f1)
        if [ ! -z "$line_num" ] && [ "$line_num" -gt 1 ]; then
            # Check if previous lines contain doc comment
            prev_line=$((line_num - 1))
            if ! sed -n "${prev_line}p" "$file" 2>/dev/null | grep -q "*/"; then
                echo "$file:$line_num - Missing documentation"
            fi
        fi
    done)

if [ ! -z "$UNDOCUMENTED" ]; then
    echo "⚠️  Found undocumented exports:"
    echo "$UNDOCUMENTED" | head -5
    WARNINGS=$((WARNINGS + 1))
else
    echo "✅ All exports appear documented"
fi

# 2. Check for outdated TODOs in documentation
echo ""
echo "📝 Checking for TODOs in documentation..."
TODO_DOCS=$(grep -r "TODO" . --include="*.md" 2>/dev/null | grep -v -E "(node_modules|coverage|dist|test-results|playwright-report)")

if [ ! -z "$TODO_DOCS" ]; then
    TODO_COUNT=$(echo "$TODO_DOCS" | wc -l)
    echo "⚠️  Found $TODO_COUNT TODOs in documentation:"
    echo "$TODO_DOCS" | head -5
    if [ "$TODO_COUNT" -gt 5 ]; then
        echo "    ... and $((TODO_COUNT - 5)) more"
    fi
    WARNINGS=$((WARNINGS + 1))
else
    echo "✅ No TODOs in documentation"
fi

# 3. Check active issues have proper documentation
echo ""
echo "📋 Checking active issues documentation..."
MISSING_NOTES=0
if [ -d "issues/active" ]; then
    for issue in issues/active/*; do
        if [ -d "$issue" ]; then
            issue_name=$(basename "$issue")
            if [ ! -f "$issue/notes.md" ]; then
                echo "⚠️  $issue_name: missing notes.md"
                MISSING_NOTES=$((MISSING_NOTES + 1))
            elif [ ! -f "$issue/description.md" ]; then
                echo "⚠️  $issue_name: missing description.md"
                MISSING_NOTES=$((MISSING_NOTES + 1))
            else
                # Check if notes.md has been updated recently (not empty)
                if [ $(wc -l < "$issue/notes.md" 2>/dev/null || echo 0) -lt 10 ]; then
                    echo "⚠️  $issue_name: notes.md appears incomplete (<10 lines)"
                    MISSING_NOTES=$((MISSING_NOTES + 1))
                fi
            fi
        fi
    done
    
    if [ $MISSING_NOTES -eq 0 ]; then
        echo "✅ All active issues properly documented"
    else
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "ℹ️  No active issues found"
fi

# 4. Check for test file documentation
echo ""
echo "🧪 Checking test documentation..."
TEST_FILES=$(find tests/ -name "*.test.ts" -o -name "*.spec.ts" 2>/dev/null)
UNDOC_TESTS=0

for test_file in $TEST_FILES; do
    # Check if test file has a describe block with description
    if ! grep -q "describe(" "$test_file" 2>/dev/null; then
        echo "⚠️  $test_file: No describe block found"
        UNDOC_TESTS=$((UNDOC_TESTS + 1))
    fi
done

if [ $UNDOC_TESTS -eq 0 ]; then
    echo "✅ All test files have describe blocks"
else
    WARNINGS=$((WARNINGS + 1))
fi

# 5. Check README.md is up to date
echo ""
echo "📖 Checking README.md..."
if [ -f "README.md" ]; then
    # Check if README mentions all major features
    EXPECTED_FEATURES=("3D board" "multiplayer" "AI opponent" "captures" "undo/redo")
    MISSING_FEATURES=0
    
    for feature in "${EXPECTED_FEATURES[@]}"; do
        if ! grep -qi "$feature" README.md; then
            echo "⚠️  README.md missing mention of: $feature"
            MISSING_FEATURES=$((MISSING_FEATURES + 1))
        fi
    done
    
    if [ $MISSING_FEATURES -eq 0 ]; then
        echo "✅ README.md appears complete"
    else
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "❌ README.md not found!"
    WARNINGS=$((WARNINGS + 1))
fi

# 6. Check for consistency between docs and code
echo ""
echo "🔄 Checking documentation consistency..."

# Check if Settings.ts features match documentation
if [ -f "src/storage/Settings.ts" ]; then
    SETTINGS_METHODS=$(grep -E "get[A-Z]|set[A-Z]" src/storage/Settings.ts | grep -oE "get[A-Za-z]+|set[A-Za-z]+" | sort -u)
    # This is a simplified check - could be expanded
    echo "ℹ️  Found $(echo "$SETTINGS_METHODS" | wc -l) settings methods"
fi

# 7. Summary
echo ""
echo "========================================"
if [ $WARNINGS -eq 0 ]; then
    echo "✅ Documentation appears well-aligned!"
else
    echo "⚠️  Found $WARNINGS documentation issues"
    echo ""
    echo "Recommendations:"
    echo "1. Document all public exports with JSDoc/TSDoc"
    echo "2. Resolve or remove TODO items from docs"
    echo "3. Keep issue notes.md files updated"
    echo "4. Ensure test files have clear descriptions"
    echo "5. Keep README.md in sync with features"
fi

exit $WARNINGS