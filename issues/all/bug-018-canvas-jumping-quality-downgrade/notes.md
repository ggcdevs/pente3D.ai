# Notes for Issue #018

## Investigation Progress - COMPLETED ✅

### 🎯 ROOT CAUSE IDENTIFIED:
- QualityManager calls `renderer.setPixelRatio()` during quality changes
- `setPixelRatio()` changes canvas buffer size without updating display dimensions
- This caused canvas to appear smaller and jump position
- Similar to issue #004 but triggered by performance monitoring instead of focus events

### 🔧 SOLUTION IMPLEMENTED:
1. **Fixed `applyQualitySettings()` method** (line 1427-1433):
   - Added `setSize()` call after `setPixelRatio()` to maintain display dimensions
   - Used `getBoundingClientRect()` to get current display size
   - Prevents canvas jumping during pixel ratio changes

2. **Fixed `recreateRenderer()` method** (line 1469-1471):
   - Changed from using `canvas.width/height` (buffer dimensions)
   - Now uses `getBoundingClientRect()` (display dimensions)
   - Ensures consistent canvas size during antialias changes

### 🧪 TEST RESULTS:
- ✅ Created comprehensive test suite (`018-canvas-jumping-quality.spec.ts`)
- ✅ Tests pass: Canvas position remains stable during quality changes
- ✅ Console shows quality change messages but no position jumping
- ✅ Both manual and automatic quality degradation scenarios work correctly

### 💡 KEY TECHNICAL INSIGHTS:
- Canvas has two size concepts: buffer size vs display size
- `setPixelRatio()` affects buffer size, `setSize()` sets both
- Must use display dimensions (`getBoundingClientRect()`) not buffer dimensions
- Quality changes should only affect rendering settings, not layout

### 📊 VERIFICATION:
- Position change: { left: 0, top: 0, width: 0, height: 0 } ✅
- Quality message appears: "Quality changed to low: FPS below threshold (0.0 < 35)" ✅
- No visual displacement or canvas jumping ✅

**Status**: RESOLVED - Canvas remains stable during all quality changes
**Files Modified**: 
- `src/rendering/Renderer.ts` (lines 1427-1433, 1469-1471)
- Created test: `tests/e2e/issues/018-canvas-jumping-quality.spec.ts`