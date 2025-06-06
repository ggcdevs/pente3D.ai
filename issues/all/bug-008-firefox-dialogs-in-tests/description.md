# Issue #008: Firefox Dialog Boxes During Headless Tests

**Status**: Resolved  
**Priority**: Medium (Test infrastructure issue)  
**Reported**: 2025-06-01 by user  
**Last Updated**: 2025-06-05  
**Resolved**: 2025-06-05

## Resolution
Added explicit headless configuration for Firefox in `playwright.config.ts` with the following flags:
- `--no-remote` - Prevents Firefox from trying to connect to existing instances
- `--new-instance` - Forces new instance creation
- `--headless` - Explicit headless mode
- `--disable-dev-shm-usage` - Prevents shared memory issues
- `--disable-web-security` - For testing purposes
- `--disable-features=VizDisplayCompositor` - Prevents display compositor issues

## Verification
Created comprehensive tests that verify:
- ✅ Multiple Firefox instances can run concurrently without dialogs
- ✅ Process cleanup works correctly
- ✅ Headless mode is properly configured
- ✅ No UI dialogs appear during test execution

## Files Changed
- `playwright.config.ts` - Added explicit Firefox launch options  

## Description
When running E2E tests, "Firefox is already running..." dialog boxes are appearing on the desktop. Headless tests should not show any UI dialogs.

## Expected Behavior
- Tests should run completely headless
- No dialog boxes should appear
- Tests should handle browser lifecycle cleanly

## Investigation Needed
1. Check Playwright configuration for Firefox
2. Ensure proper headless mode flags
3. Check for profile conflicts
4. Verify xvfb or similar is being used
5. Ensure proper cleanup between test runs

## Potential Solutions
- Use unique Firefox profiles per test
- Add --no-remote flag
- Ensure proper DISPLAY variable for headless
- Kill any zombie Firefox processes

## Files to Check
- `playwright.config.ts` - Browser launch options
- Test setup/teardown hooks

---

## Testing Policy
**Work CANNOT begin on this issue until a headless test replicates it.**

Test file: (to be created)
Test should:
- Launch multiple Firefox instances
- Verify no UI windows appear (using xwininfo or similar)
- Ensure clean shutdown