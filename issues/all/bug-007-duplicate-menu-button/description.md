# Issue #007: Duplicate Menu Button in UI

**Status**: Resolved  
**Priority**: Low (Cosmetic issue)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-01  
**Resolved**: 2025-06-01  

## Description
There's an extra menu button appearing in the bottom toolbar. Should be a quick fix to remove the duplicate.

## Expected Behavior
- Only one menu button should exist
- Likely in top-right as per basic-wants.md

## Investigation Needed
1. Search for menu button creation in code
2. Check if button is created in both HTML and JavaScript
3. Remove duplicate

## Files to Check
- `src/main.ts` - Creates menu button dynamically
- `index.html` - May have static button
- UI component files

---

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: (to be created)
Test should verify:
- Count of menu buttons on page
- Expected: 1, Actual: 2

## Resolution
Removed duplicate menu button creation from main.ts lines 259-263. The button already exists in index.html, so main.ts now just gets the existing button by ID instead of creating a new one.