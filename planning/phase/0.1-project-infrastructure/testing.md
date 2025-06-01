# Chunk 0.1: Project Infrastructure - Testing Guide

## Testing Overview
Comprehensive validation of the development environment setup to ensure all tools and configurations work correctly before proceeding with feature development.

## Pre-Testing Setup
Ensure you have completed all steps in `development.md` before running these tests.

## Automated Testing Protocols

### 1. Build System Validation
```bash
# Test 1: Dependency Installation
npm install
# Expected: No errors, all packages installed successfully

# Test 2: TypeScript Compilation
npm run type-check
# Expected: No TypeScript errors, clean compilation

# Test 3: Development Server
npm run dev
# Expected: Server starts on http://localhost:3000, no errors in console

# Test 4: Production Build
npm run build
# Expected: Build completes successfully, dist/ folder created

# Test 5: Build Preview
npm run preview
# Expected: Preview server starts, production build serves correctly
```

### 2. Code Quality Tools
```bash
# Test 6: ESLint Check
npm run lint
# Expected: No linting errors (warnings acceptable for initial setup)

# Test 7: Prettier Format Check
npm run format
# Expected: Code formatting applied successfully

# Test 8: Combined Quality Check
npm run lint && npm run type-check
# Expected: Both commands pass without errors
```

### 3. Testing Framework Validation
```bash
# Test 9: Jest Test Runner
npm test
# Expected: Test suite runs, initial test passes

# Test 10: Test Coverage
npm run test:coverage
# Expected: Coverage report generated, no errors

# Test 11: Watch Mode (manual)
npm run test:watch
# Expected: Tests run in watch mode, re-run on file changes
```

## Manual Testing Procedures

### 4. Browser Functionality
**Test 12: Page Load**
1. Navigate to `http://localhost:3000`
2. Verify page loads without errors
3. Check browser console for JavaScript errors
4. Confirm canvas element is present and sized correctly

**Expected Results:**
- Page displays with black canvas background
- Console shows "Pente3D.ai initialized successfully"
- No 404 errors for assets
- Canvas fills viewport completely

**Test 13: Responsive Design**
1. Resize browser window
2. Verify canvas resizes to match viewport
3. Test on different screen sizes

**Expected Results:**
- Canvas maintains full viewport coverage
- No scrollbars appear
- Resize happens smoothly without errors

### 5. Development Environment
**Test 14: Hot Module Replacement**
1. Start dev server (`npm run dev`)
2. Modify `src/main.ts` (add a console.log)
3. Save the file
4. Check browser updates without refresh

**Expected Results:**
- Changes appear immediately in browser
- Console shows the new log message
- No page refresh required

**Test 15: Path Mapping**
1. Create test file: `src/utils/test.ts`
```typescript
export const testValue = 'path mapping works';
```
2. Import in `src/main.ts`:
```typescript
import { testValue } from '@/utils/test';
console.log(testValue);
```
3. Verify import resolves correctly

**Expected Results:**
- No TypeScript errors about module resolution
- Console shows "path mapping works" message
- Build completes successfully

## Performance Testing

### 6. Build Performance
```bash
# Test 16: Build Time Measurement
time npm run build
# Expected: Build completes in <30 seconds for empty project

# Test 17: Bundle Size Check
npm run build && ls -la dist/
# Expected: Main bundle <100KB for initial setup
```

### 7. Development Performance
**Test 18: Dev Server Startup**
- Measure time from `npm run dev` to server ready
- Expected: <10 seconds on modern hardware

**Test 19: TypeScript Compilation Speed**
- Run `npm run type-check` multiple times
- Expected: Subsequent runs <5 seconds

## Cross-Browser Testing

### 8. Browser Compatibility
Test on the following browsers:
- **Chrome** (latest): Primary development browser
- **Firefox** (latest): Gecko engine compatibility
- **Safari** (latest, if available): WebKit engine compatibility
- **Edge** (latest): Alternative Chromium implementation

**Test Procedure for each browser:**
1. Open `http://localhost:3000`
2. Check console for errors
3. Verify canvas renders correctly
4. Test window resize functionality

**Expected Results:**
- All browsers display the page correctly
- No console errors
- Canvas resizing works uniformly

## Error Simulation Testing

### 9. Network Conditions
**Test 20: Offline Behavior**
1. Start dev server
2. Disconnect internet
3. Reload page

**Expected Results:**
- Page still loads (served from local dev server)
- No network-related errors for local assets

### 10. Invalid Configuration Testing
**Test 21: TypeScript Error Handling**
1. Introduce TypeScript error in `src/main.ts`
2. Run `npm run type-check`
3. Verify error is caught and reported clearly

**Test 22: Build Error Handling**
1. Introduce syntax error in `src/main.ts`
2. Run `npm run build`
3. Verify error is caught and reported clearly

## Test Coverage Requirements

### Minimum Passing Criteria
- [ ] All 22 automated and manual tests pass
- [ ] Build system works without errors
- [ ] Development server starts successfully
- [ ] TypeScript compilation is error-free
- [ ] ESLint passes with no errors
- [ ] Jest test framework runs successfully
- [ ] Canvas displays correctly in target browsers
- [ ] Hot module replacement works
- [ ] Path mapping resolves correctly
- [ ] Production build generates valid output

### Performance Benchmarks
- [ ] Dev server startup: <10 seconds
- [ ] Build time: <30 seconds
- [ ] Bundle size: <100KB initial
- [ ] Type checking: <5 seconds

### Quality Gates
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] No console errors in browser
- [ ] No 404s for assets
- [ ] No accessibility violations (basic check)

## Test Automation Script

Create `scripts/test-infrastructure.sh`:
```bash
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
```

Make executable: `chmod +x scripts/test-infrastructure.sh`

## Troubleshooting Guide

### Common Issues and Solutions

**Issue: `npm install` fails with dependency conflicts**
- Solution: Delete `node_modules` and `package-lock.json`, run `npm install` again
- Alternative: Use `npm ci` for clean install

**Issue: TypeScript path mapping not working**
- Check `tsconfig.json` baseUrl and paths configuration
- Verify `vite.config.ts` alias configuration matches
- Restart TypeScript language server in IDE

**Issue: Jest tests fail with ES module errors**
- Verify `jest.config.js` transform configuration
- Check `preset: 'ts-jest'` is set correctly
- Ensure test files use `.ts` extension

**Issue: Canvas not displaying**
- Check browser console for WebGL errors
- Verify canvas element exists in DOM
- Check CSS styling isn't hiding the canvas

**Issue: Hot reload not working**
- Restart dev server
- Check file watcher permissions
- Verify file is within `src/` directory

## Documentation Requirements

After passing all tests, document:
1. Successful test run timestamps
2. Any warnings encountered (but not errors)
3. Browser compatibility results
4. Performance benchmark results
5. Any deviations from expected behavior

This comprehensive testing ensures a rock-solid foundation for all subsequent development phases.