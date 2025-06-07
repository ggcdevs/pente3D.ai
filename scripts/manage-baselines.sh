#!/bin/bash

# Script to manage visual regression test baselines

BASELINE_DIR="tests/e2e/fixtures/baseline-screenshots"
ACTUAL_DIR="tests/e2e/fixtures/actual-screenshots"
DIFF_DIR="tests/e2e/fixtures/diff-screenshots"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function show_help {
    echo "Visual Regression Baseline Management"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  update       Update all baselines from actual screenshots"
    echo "  update-one   Update a specific baseline"
    echo "  clean        Remove actual and diff screenshots"
    echo "  backup       Create backup of current baselines"
    echo "  restore      Restore baselines from backup"
    echo "  list         List all baseline screenshots"
    echo "  diff         Show differences for failed tests"
    echo ""
    echo "Examples:"
    echo "  $0 update                    # Update all baselines"
    echo "  $0 update-one board-empty    # Update specific baseline"
    echo "  $0 clean                     # Clean test artifacts"
    echo "  $0 backup                    # Backup baselines"
}

function update_baselines {
    echo -e "${YELLOW}Updating all baselines...${NC}"
    
    if [ ! -d "$ACTUAL_DIR" ]; then
        echo -e "${RED}No actual screenshots found. Run visual tests first.${NC}"
        exit 1
    fi
    
    # Create baseline directory if it doesn't exist
    mkdir -p "$BASELINE_DIR"
    
    # Copy all actual screenshots to baselines
    count=0
    for file in "$ACTUAL_DIR"/*.png; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "$BASELINE_DIR/$filename"
            echo -e "${GREEN}✓ Updated: $filename${NC}"
            ((count++))
        fi
    done
    
    echo -e "${GREEN}Updated $count baselines${NC}"
}

function update_one_baseline {
    local name=$1
    
    if [ -z "$name" ]; then
        echo -e "${RED}Please specify a baseline name${NC}"
        exit 1
    fi
    
    local actual_file="$ACTUAL_DIR/${name}.png"
    local baseline_file="$BASELINE_DIR/${name}.png"
    
    if [ ! -f "$actual_file" ]; then
        echo -e "${RED}Actual screenshot not found: $actual_file${NC}"
        exit 1
    fi
    
    cp "$actual_file" "$baseline_file"
    echo -e "${GREEN}✓ Updated baseline: $name${NC}"
}

function clean_artifacts {
    echo -e "${YELLOW}Cleaning test artifacts...${NC}"
    
    if [ -d "$ACTUAL_DIR" ]; then
        rm -rf "$ACTUAL_DIR"
        echo -e "${GREEN}✓ Removed actual screenshots${NC}"
    fi
    
    if [ -d "$DIFF_DIR" ]; then
        rm -rf "$DIFF_DIR"
        echo -e "${GREEN}✓ Removed diff screenshots${NC}"
    fi
    
    echo -e "${GREEN}Cleanup complete${NC}"
}

function backup_baselines {
    local backup_dir="${BASELINE_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
    
    if [ ! -d "$BASELINE_DIR" ]; then
        echo -e "${RED}No baselines to backup${NC}"
        exit 1
    fi
    
    cp -r "$BASELINE_DIR" "$backup_dir"
    echo -e "${GREEN}✓ Baselines backed up to: $backup_dir${NC}"
}

function restore_baselines {
    # Find most recent backup
    local latest_backup=$(ls -td ${BASELINE_DIR}.backup.* 2>/dev/null | head -1)
    
    if [ -z "$latest_backup" ]; then
        echo -e "${RED}No backup found${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}Restoring from: $latest_backup${NC}"
    
    # Remove current baselines
    rm -rf "$BASELINE_DIR"
    
    # Restore from backup
    cp -r "$latest_backup" "$BASELINE_DIR"
    
    echo -e "${GREEN}✓ Baselines restored${NC}"
}

function list_baselines {
    echo -e "${YELLOW}Baseline screenshots:${NC}"
    
    if [ ! -d "$BASELINE_DIR" ]; then
        echo -e "${RED}No baselines found${NC}"
        exit 1
    fi
    
    for file in "$BASELINE_DIR"/*.png; do
        if [ -f "$file" ]; then
            filename=$(basename "$file" .png)
            size=$(du -h "$file" | cut -f1)
            echo "  • $filename ($size)"
        fi
    done
}

function show_diffs {
    echo -e "${YELLOW}Visual differences:${NC}"
    
    if [ ! -d "$DIFF_DIR" ]; then
        echo -e "${GREEN}No differences found${NC}"
        exit 0
    fi
    
    for file in "$DIFF_DIR"/*.png; do
        if [ -f "$file" ]; then
            filename=$(basename "$file" .png)
            echo -e "${RED}  ✗ $filename${NC}"
            
            # If ImageMagick is installed, show diff percentage
            if command -v compare &> /dev/null; then
                baseline="$BASELINE_DIR/${filename%.diff}.png"
                actual="$ACTUAL_DIR/${filename%.diff}.png"
                
                if [ -f "$baseline" ] && [ -f "$actual" ]; then
                    diff_percent=$(compare -metric RMSE "$baseline" "$actual" null: 2>&1 | awk '{print $2}' | tr -d '()')
                    echo "    Difference: $diff_percent"
                fi
            fi
        fi
    done
}

# Main script logic
case "$1" in
    update)
        update_baselines
        ;;
    update-one)
        update_one_baseline "$2"
        ;;
    clean)
        clean_artifacts
        ;;
    backup)
        backup_baselines
        ;;
    restore)
        restore_baselines
        ;;
    list)
        list_baselines
        ;;
    diff)
        show_diffs
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        show_help
        exit 1
        ;;
esac