# Test Migration Examples

This document provides concrete examples of migrating tests to use the new helper frameworks.

## E2E Test Migration Examples

### Example 1: Basic Smoke Test

**Before:**
```typescript
// tests/e2e/smoke/app-loads.spec.ts
import { test, expect } from '@playwright/test';
import { waitForSceneReady, checkWebGLSupport } from '../utils/threejs-helpers';

test('should load without errors', async ({ page }) => {
  await page.goto('/');
  await waitForSceneReady(page);
  
  const hasWebGL = await checkWebGLSupport(page);
  expect(hasWebGL).toBe(true);
});
```

**After:**
```typescript
import { test, expect, setupTest } from '@/tests/helpers/e2e';

test('should load without errors', async ({ page, testEnv, browser }) => {
  await testEnv.skipIfNoWebGL();
  await setupTest(page);
  
  const caps = await browser.checkCapabilities();
  expect(caps.webgl).toBe(true);
});
```

**Benefits:**
- Automatic WebGL check with skip capability
- Unified setup function
- Better browser capability detection

### Example 2: Piece Placement Test

**Before:**
```typescript
// Manual coordinate calculation and clicking
const nodeScreenPos = await page.evaluate(() => {
  const renderer = (window as any).renderer;
  const camera = renderer.getCamera();
  // ... 20+ lines of coordinate projection code
});
await page.mouse.click(nodeScreenPos.x, nodeScreenPos.y);
```

**After:**
```typescript
const position = new Vector3Builder().withCoords(3, 3, 3).build();
await game.placePiece(position);
```

**Benefits:**
- No manual coordinate math
- Type-safe position creation
- Cleaner, more readable code

### Example 3: Visual Regression Test

**Before:**
```typescript
const screenshot = await page.screenshot({ path: 'actual.png' });
const baseline = fs.readFileSync('baseline.png');
const diff = await compareImages(screenshot, baseline);
expect(diff.percentage).toBeLessThan(0.1);
```

**After:**
```typescript
await visual.waitForVisualStability();
const screenshot = await visual.takeScreenshot({
  animations: 'disabled',
  maskRegions: [{ x: 0, y: 0, width: 200, height: 50 }]
});
const result = await visual.compareWithBaseline(screenshot, 'test-name');
expect(result.match).toBe(true);
```

**Benefits:**
- Automatic stability waiting
- Built-in masking for dynamic regions
- Better error reporting with debug info

## Unit Test Migration Examples

### Example 1: Board Construction

**Before:**
```typescript
const player = Player.createLocal('test', 'black');
const pieces = [
  Piece.createNormal(new Vector3(0, 0, 0), player),
  Piece.createNormal(new Vector3(1, 1, 1), player)
];
const board = Board.fromPieces(pieces);
```

**After:**
```typescript
const board = new BoardBuilder()
  .withPiece(0, 0, 0, new PlayerBuilder().withColor('black').build())
  .withPiece(1, 1, 1)  // Uses same player by default
  .build();
```

**Benefits:**
- Fluent API
- Less boilerplate
- Auto-generates test data

### Example 2: Complex Board Patterns

**Before:**
```typescript
// Manually place 20+ pieces to create a test scenario
const board = new Board(7);
const black = new Player('p1', 'black');
const white = new Player('p2', 'white');
board = board.placePiece(Piece.createNormal(new Vector3(0, 0, 0), black));
board = board.placePiece(Piece.createNormal(new Vector3(1, 0, 0), white));
// ... many more lines
```

**After:**
```typescript
const board = new BoardBuilder()
  .withPattern([
    '1.2.1',
    '.2.2.',
    '1.1.1'
  ])
  .build();

// Or use pre-built scenarios
const scenario = GameScenarios.nearWin('black');
const board = scenario.board;
```

**Benefits:**
- Visual representation of board state
- Reusable scenarios
- Much less code

### Example 3: Performance Testing

**Before:**
```typescript
const start = Date.now();
for (let i = 0; i < 1000; i++) {
  board.getAllLines();
}
const elapsed = Date.now() - start;
expect(elapsed).toBeLessThan(100);
```

**After:**
```typescript
const benchmark = new Benchmark('getAllLines');
const result = await benchmark.run(() => board.getAllLines(), {
  iterations: 1000
});

expect(result.stats.mean).toBeLessThan(0.1); // 0.1ms per operation
expect(result.stats.p95).toBeLessThan(0.2);  // 95th percentile
```

**Benefits:**
- Statistical analysis
- Memory profiling
- Better performance insights

## Integration Test Migration Examples

### Example 1: Network Testing

**Before:**
```typescript
const mockPeer = {
  on: jest.fn(),
  send: jest.fn(),
  destroy: jest.fn()
};
jest.mock('peerjs', () => ({ Peer: () => mockPeer }));
```

**After:**
```typescript
const network = new StatefulNetworkManagerMock();
await network.hostGame(); // Returns 'ABC123', tracks state
expect(network.isHost).toBe(true);
expect(network.connectionState).toBe('connected');
```

**Benefits:**
- Stateful mocks simulate real behavior
- No manual mock setup
- Better test coverage

### Example 2: Settings Integration

**Before:**
```typescript
localStorage.setItem('pente3d-settings', JSON.stringify({
  boardSize: 9,
  theme: 'dark'
}));
const settings = new Settings();
```

**After:**
```typescript
const settings = new SettingsBuilder()
  .withBoardSize(9)
  .withTheme('dark')
  .build();

// Or use scenarios
const settings = SettingsScenarios.highContrast();
```

**Benefits:**
- Type-safe settings creation
- Pre-built scenarios
- No localStorage manipulation

## Migration Patterns Summary

### 1. Replace Manual Setup with Fixtures
- Use `setupTest()` for consistent initialization
- Use test fixtures for dependency injection
- Use `testEnv.isolateTest()` for test isolation

### 2. Replace Direct DOM/Canvas Manipulation
- Use `game.placePiece()` instead of manual clicks
- Use `game.rotateBoard()` instead of mouse drags
- Use `visual.takeScreenshot()` instead of page screenshots

### 3. Replace Manual Test Data Creation
- Use builders for all entities
- Use scenarios for complex setups
- Use `buildMany()` for multiple instances

### 4. Replace Basic Assertions with Rich Helpers
- Use `visual.compareWithBaseline()` for screenshots
- Use performance assertions for timing
- Use game state helpers for validation

### 5. Replace Console-Based Debugging
- Use `visual.saveDebugInfo()` for visual tests
- Use `game.getConsoleErrors()` for error tracking
- Use structured logging in tests

## Common Pitfalls to Avoid

1. **Don't mix old and new patterns** - Fully migrate each test file
2. **Don't skip test isolation** - Always use `testEnv.isolateTest()`
3. **Don't hardcode coordinates** - Use Vector3Builder
4. **Don't use arbitrary waits** - Use `waitForVisualStability()`
5. **Don't create mocks manually** - Use mock factories

## Next Steps After Migration

1. Delete old helper files that are no longer needed
2. Update CI configuration for visual regression baselines
3. Set up performance baseline tracking
4. Document any custom patterns your team develops