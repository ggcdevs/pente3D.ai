# E2E Test Migration Status

This document tracks the migration status of E2E tests to use the new helper frameworks.

## Migration Progress: 6/46 (13%)

### ✅ Migrated Tests (6)

1. `smoke/app-loads.spec.ts` - Basic smoke tests
2. `interactions/piece-placement.spec.ts` - Piece placement interactions  
3. `interactions/basic-interaction.spec.ts` - Basic board interactions
4. `interactions/board-controls.spec.ts` - Camera controls (rotation, pan, zoom)
5. `game-helpers-comprehensive.spec.ts` - Comprehensive game functionality
6. `visual-regression.spec.ts` - Created new, uses helpers by design

### 🔄 Partially Migrated (1)

1. `smoke/app-loads.spec.ts` - Started but reverted some changes due to import issues

### ⏳ Pending Migration (39)

#### Debug Tests (11)
- `debug-click-helper.spec.ts`
- `debug-highlight.spec.ts`
- `debug-initial-state.spec.ts`
- `debug-node-finding.spec.ts`
- `debug-placement.spec.ts`
- `debug-undo.spec.ts`
- `debug-visible-pieces.spec.ts`
- `debug/console-check.spec.ts`
- `debug/console-errors.spec.ts`
- `debug/network-detailed.spec.ts`
- `debug/network-full.spec.ts`
- `debug/websocket-error.spec.ts`

#### Issue-Specific Tests (28)
- `issues/005-*.spec.ts` (9 files) - Click and piece placement issues
- `issues/006-*.spec.ts` (2 files) - Zoom limit issues
- `issues/008-*.spec.ts` (2 files) - Firefox dialog issues
- `issues/009-*.spec.ts` (1 file) - Performance FPS test
- `issues/010-*.spec.ts` (1 file) - Piece colors
- `issues/011-*.spec.ts` (1 file) - Temporary pieces
- `issues/012-*.spec.ts` (1 file) - Temporary piece click
- `issues/018-*.spec.ts` (1 file) - Canvas jumping quality
- `issues/019-*.spec.ts` (8 files) - Various temporary piece issues

#### Other Tests (1)
- `test-helpers-individual.spec.ts` - Tests for the helpers themselves

## Migration Guidelines

### Priority Order
1. **High Priority**: Main interaction tests (already done)
2. **Medium Priority**: Debug tests that validate core functionality
3. **Low Priority**: Issue-specific tests (may be obsolete after fixes)

### Migration Patterns

#### Before
```typescript
import { GamePage } from '../pages/GamePage';
const gamePage = new GamePage(page);
await gamePage.goto();
await gamePage.waitForThreeJSLoad();
```

#### After
```typescript
import { setupTest } from '../helpers/e2e';
await setupTest(page);
```

### Notes
- Many issue-specific tests may no longer be needed after bugs are fixed
- Debug tests could potentially be consolidated
- Some tests may need significant rewriting to use new patterns
- Consider creating test suites for related functionality

## Next Steps
1. Migrate debug tests that are still relevant
2. Review issue-specific tests to determine which are still needed
3. Consolidate similar tests where possible
4. Update CI configuration to use new test structure