# Chunk 4.2: Settings System - Testing Guide

## Overview
Comprehensive testing for the visual customization system, including color management, themes, real-time preview, and persistence.

## Test Structure

### 1. Unit Tests - Settings Class (35 tests)
**File**: `tests/unit/storage/Settings.test.ts`

#### Color Management Tests (8 tests)
```typescript
describe('Settings - Color Management', () => {
  test('should get default colors for all elements');
  test('should set valid color for specific element');
  test('should reject invalid color format');
  test('should maintain color immutability');
  test('should reset colors to defaults');
  test('should validate hex color formats');
  test('should handle color shortcuts (#fff -> #ffffff)');
  test('should emit change event on color update');
});
```

#### Opacity Management Tests (7 tests)
```typescript
describe('Settings - Opacity Management', () => {
  test('should get default opacity values');
  test('should set opacity within valid range');
  test('should clamp opacity to 0-1 range');
  test('should reject invalid opacity values');
  test('should reset opacity to defaults');
  test('should handle percentage inputs (50% -> 0.5)');
  test('should emit change event on opacity update');
});
```

#### Theme System Tests (12 tests)
```typescript
describe('Settings - Theme System', () => {
  test('should load preset themes correctly');
  test('should apply theme colors and opacity');
  test('should get active theme details');
  test('should create custom theme with unique ID');
  test('should update custom theme properties');
  test('should delete custom theme');
  test('should prevent deletion of preset themes');
  test('should limit custom theme count');
  test('should export theme as JSON string');
  test('should import valid theme data');
  test('should reject invalid theme imports');
  test('should maintain theme immutability');
});
```

#### Preview Mode Tests (8 tests)
```typescript
describe('Settings - Preview Mode', () => {
  test('should enter preview mode');
  test('should update preview settings without affecting actual');
  test('should apply preview changes');
  test('should cancel preview and revert');
  test('should track preview mode state');
  test('should handle nested preview sessions');
  test('should emit preview events');
  test('should clean up on preview exit');
});
```

### 2. Unit Tests - SettingsModal Class (25 tests)
**File**: `tests/unit/ui/SettingsModal.test.ts`

#### UI Structure Tests (8 tests)
```typescript
describe('SettingsModal - UI Structure', () => {
  test('should create tabbed interface');
  test('should render theme selection tab');
  test('should render colors customization tab');
  test('should render opacity controls tab');
  test('should render advanced settings tab');
  test('should highlight active tab');
  test('should include preview area');
  test('should have apply/cancel buttons');
});
```

#### Interaction Tests (10 tests)
```typescript
describe('SettingsModal - Interactions', () => {
  test('should switch tabs on click');
  test('should update color on picker change');
  test('should update opacity on slider change');
  test('should apply theme on selection');
  test('should create custom theme on button click');
  test('should delete custom theme with confirmation');
  test('should reset to defaults with confirmation');
  test('should import theme from file');
  test('should export theme to file');
  test('should update preview in real-time');
});
```

#### Validation Tests (7 tests)
```typescript
describe('SettingsModal - Validation', () => {
  test('should validate color inputs before apply');
  test('should show error for invalid colors');
  test('should validate opacity ranges');
  test('should validate theme names');
  test('should prevent duplicate theme names');
  test('should handle storage quota errors');
  test('should validate imported theme data');
});
```

### 3. Integration Tests - Settings System (20 tests)
**File**: `tests/integration/settings-integration.test.ts`

#### Settings-Renderer Integration (8 tests)
```typescript
describe('Settings-Renderer Integration', () => {
  test('should apply color changes to renderer');
  test('should update material opacity in renderer');
  test('should apply complete theme to scene');
  test('should handle preview mode in renderer');
  test('should batch multiple setting changes');
  test('should maintain performance during updates');
  test('should properly dispose old materials');
  test('should handle renderer errors gracefully');
});
```

#### Settings-Storage Integration (7 tests)
```typescript
describe('Settings-Storage Integration', () => {
  test('should persist color settings');
  test('should persist opacity settings');
  test('should persist active theme');
  test('should save and load custom themes');
  test('should handle storage quota limits');
  test('should migrate old settings format');
  test('should handle corrupted storage data');
});
```

#### Modal-Settings Integration (5 tests)
```typescript
describe('Modal-Settings Integration', () => {
  test('should load current settings on open');
  test('should apply changes on confirm');
  test('should revert changes on cancel');
  test('should update preview during changes');
  test('should handle settings events');
});
```

### 4. Visual Tests - Theme Application (8 tests)
**File**: `tests/visual/settings-visual.test.ts`

```typescript
describe('Visual - Theme Application', () => {
  test('should render default theme correctly');
  test('should render ocean theme correctly');
  test('should render forest theme correctly');
  test('should render sunset theme correctly');
  test('should render neon theme correctly');
  test('should apply custom colors accurately');
  test('should render opacity changes correctly');
  test('should maintain visual quality during preview');
});
```

### 5. Performance Tests - Real-time Updates (7 tests)
**File**: `tests/performance/settings-performance.test.ts`

```typescript
describe('Performance - Settings Updates', () => {
  test('should maintain 60fps during color changes');
  test('should batch rapid setting updates efficiently');
  test('should handle preview mode without lag');
  test('should apply theme instantly (<100ms)');
  test('should not leak memory during updates');
  test('should optimize material updates');
  test('should handle 50+ custom themes efficiently');
});
```

### 6. Accessibility Tests - Settings UI (10 tests)
**File**: `tests/integration/settings-accessibility.test.ts`

```typescript
describe('Accessibility - Settings UI', () => {
  test('should navigate tabs with keyboard');
  test('should control color pickers with keyboard');
  test('should adjust sliders with arrow keys');
  test('should announce changes to screen readers');
  test('should maintain focus management');
  test('should provide sufficient color contrast');
  test('should support high contrast mode');
  test('should have proper ARIA labels');
  test('should handle reduced motion preference');
  test('should provide keyboard shortcuts help');
});
```

### 7. E2E Tests - Complete Settings Flow (5 tests)
**File**: `tests/e2e/settings-e2e.test.ts`

```typescript
describe('E2E - Settings Flow', () => {
  test('should customize colors and see changes in game');
  test('should create and apply custom theme');
  test('should export and import theme successfully');
  test('should persist settings across sessions');
  test('should reset all settings to defaults');
});
```

## Test Data & Fixtures

### Theme Fixtures
```typescript
export const mockThemes = {
  valid: {
    id: 'test-theme',
    name: 'Test Theme',
    description: 'Theme for testing',
    colors: { /* all color values */ },
    opacity: { /* all opacity values */ },
    isCustom: true
  },
  invalid: {
    missing_colors: { /* incomplete theme */ },
    invalid_opacity: { /* opacity > 1 */ },
    malformed_json: '{ invalid json }'
  }
};
```

### Color Fixtures
```typescript
export const colorTestCases = {
  valid: ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff'],
  invalid: ['ffffff', '#gggggg', 'red', '#ff', '123456'],
  edge_cases: ['#FFF', '#fff', '#FFFFFF', 'transparent']
};
```

## Mock Implementations

### Mock Renderer
```typescript
class MockRenderer {
  applyColorSettings = jest.fn();
  applyOpacitySettings = jest.fn();
  updateElementColor = jest.fn();
  updateElementOpacity = jest.fn();
  enterPreviewMode = jest.fn();
  exitPreviewMode = jest.fn();
}
```

### Mock Storage
```typescript
class MockStorageManager {
  saveSettings = jest.fn();
  loadSettings = jest.fn();
  saveCustomThemes = jest.fn();
  loadCustomThemes = jest.fn();
}
```

## Coverage Requirements
- **Unit Tests**: 100% coverage of Settings and SettingsModal classes
- **Integration Tests**: All interaction paths covered
- **Visual Tests**: Each theme and major visual change
- **Performance Tests**: Critical performance paths
- **Overall Target**: >95% coverage for settings system

## Test Execution Strategy

1. **Development Phase**
   - Write tests alongside implementation
   - Use TDD for validation functions
   - Mock external dependencies

2. **Integration Phase**
   - Test with real Renderer instance
   - Verify storage persistence
   - Check event propagation

3. **Visual Validation**
   - Screenshot comparisons
   - Manual theme verification
   - Color accuracy checks

4. **Performance Validation**
   - Profile during setting changes
   - Monitor frame rate
   - Check memory usage

5. **Accessibility Validation**
   - Keyboard navigation testing
   - Screen reader testing
   - WCAG compliance check

## Common Test Scenarios

1. **Rapid Color Changes**
   - User dragging color picker
   - Multiple simultaneous updates
   - Performance impact

2. **Theme Switching**
   - Quick theme changes
   - Custom theme application
   - Preview mode interactions

3. **Storage Limits**
   - Many custom themes
   - Large theme data
   - Quota exceeded handling

4. **Error Recovery**
   - Invalid imports
   - Corrupted storage
   - Network failures

5. **Edge Cases**
   - Empty theme names
   - Duplicate IDs
   - Circular theme references