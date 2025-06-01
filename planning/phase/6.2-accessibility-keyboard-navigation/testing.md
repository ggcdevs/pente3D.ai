# Chunk 6.2: Accessibility & Keyboard Navigation - Testing Guide

## Overview
Comprehensive testing for accessibility features including keyboard navigation, screen reader support, visual accessibility options, and WCAG 2.1 AA compliance.

## Test Categories

### 1. AccessibilityManager Unit Tests
**File**: `tests/unit/utils/AccessibilityManager.test.ts`

#### Constructor and Options (5 tests)
```typescript
describe('AccessibilityManager - Constructor', () => {
  test('should initialize with default options');
  test('should accept custom options');
  test('should connect to game events');
  test('should create announcement container');
  test('should handle missing game gracefully');
});
```

#### Game Event Announcements (8 tests)
```typescript
describe('AccessibilityManager - Announcements', () => {
  test('should announce move placement');
  test('should announce captures');
  test('should announce turn changes');
  test('should announce game win');
  test('should announce undo/redo actions');
  test('should queue multiple announcements');
  test('should clear old announcements');
  test('should respect announcement settings');
});
```

#### Keyboard Focus Management (10 tests)
```typescript
describe('AccessibilityManager - Focus', () => {
  test('should move focus up/down (Y axis)');
  test('should move focus left/right (X axis)');
  test('should move focus forward/backward (Z axis)');
  test('should wrap focus at board edges');
  test('should handle fast navigation with Shift');
  test('should track current focus position');
  test('should emit focus change events');
  test('should validate focus boundaries');
  test('should restore focus after modal close');
  test('should handle null focus state');
});
```

#### Screen Reader Support (6 tests)
```typescript
describe('AccessibilityManager - Screen Reader', () => {
  test('should convert position to readable text');
  test('should announce current position');
  test('should announce board state summary');
  test('should announce game status');
  test('should announce available moves count');
  test('should use appropriate ARIA live regions');
});
```

#### Visual Accessibility (4 tests)
```typescript
describe('AccessibilityManager - Visual', () => {
  test('should toggle high contrast mode');
  test('should toggle reduced motion');
  test('should emit mode change events');
  test('should persist preferences');
});
```

### 2. Enhanced InputHandler Tests
**File**: `tests/unit/ui/InputHandler.accessibility.test.ts`

#### Keyboard Navigation (12 tests)
```typescript
describe('InputHandler - Keyboard Navigation', () => {
  test('should handle arrow keys for X-Y navigation');
  test('should handle Page Up/Down for Z navigation');
  test('should handle Space/Enter for piece placement');
  test('should handle Tab for UI element cycling');
  test('should handle Escape for cancel/close');
  test('should handle H for help overlay');
  test('should handle A for announcements');
  test('should handle Shift+arrows for fast navigation');
  test('should prevent default browser behaviors');
  test('should respect disabled state');
  test('should handle simultaneous key presses');
  test('should update focus indicator on navigation');
});
```

#### Focus Indicator Rendering (5 tests)
```typescript
describe('InputHandler - Focus Indicator', () => {
  test('should create focus indicator mesh');
  test('should update indicator position');
  test('should show/hide indicator appropriately');
  test('should use high contrast colors when enabled');
  test('should animate focus changes smoothly');
});
```

### 3. Modal Accessibility Tests
**File**: `tests/unit/ui/Modal.accessibility.test.ts`

#### ARIA Attributes (6 tests)
```typescript
describe('Modal - ARIA', () => {
  test('should have role="dialog"');
  test('should have aria-modal="true"');
  test('should have aria-labelledby pointing to title');
  test('should have aria-describedby for content');
  test('should announce modal opening');
  test('should maintain proper heading hierarchy');
});
```

#### Focus Management (8 tests)
```typescript
describe('Modal - Focus Management', () => {
  test('should focus first focusable element on open');
  test('should trap focus within modal');
  test('should handle Tab cycling');
  test('should handle Shift+Tab reverse cycling');
  test('should restore focus on close');
  test('should handle no focusable elements');
  test('should skip disabled elements');
  test('should handle dynamic content changes');
});
```

### 4. KeyboardHelpModal Tests
**File**: `tests/unit/ui/KeyboardHelpModal.test.ts`

#### Content and Structure (5 tests)
```typescript
describe('KeyboardHelpModal', () => {
  test('should display all keyboard shortcuts');
  test('should organize shortcuts by category');
  test('should use accessible table structure');
  test('should include search functionality');
  test('should be dismissible with Escape');
});
```

### 5. High Contrast Mode Tests
**File**: `tests/visual/high-contrast.test.ts`

#### Visual Tests (8 tests)
```typescript
describe('High Contrast Mode', () => {
  test('should apply high contrast colors to UI');
  test('should maintain 7:1 contrast ratio for text');
  test('should add visible borders to elements');
  test('should enhance focus indicators');
  test('should work with dark theme');
  test('should work with light theme');
  test('should update Three.js materials');
  test('should persist across page reload');
});
```

### 6. Screen Reader Integration Tests
**File**: `tests/integration/screen-reader.test.ts`

#### Announcement Flow (10 tests)
```typescript
describe('Screen Reader Integration', () => {
  test('should announce game start');
  test('should announce each move with details');
  test('should announce captures clearly');
  test('should announce turn changes');
  test('should announce invalid move attempts');
  test('should announce undo/redo actions');
  test('should announce game end with winner');
  test('should not overwhelm with rapid announcements');
  test('should provide position context');
  test('should work with popular screen readers');
});
```

### 7. Keyboard Navigation Integration Tests
**File**: `tests/integration/keyboard-navigation.test.ts`

#### Complete Navigation Flow (12 tests)
```typescript
describe('Keyboard Navigation Flow', () => {
  test('should navigate entire board with keyboard');
  test('should place pieces with keyboard');
  test('should open/close modals with keyboard');
  test('should navigate menus with keyboard');
  test('should handle game flow entirely via keyboard');
  test('should show clear focus indicators');
  test('should handle rapid key presses');
  test('should work with sticky keys');
  test('should handle international keyboards');
  test('should provide skip links');
  test('should handle browser shortcuts gracefully');
  test('should work without mouse events');
});
```

### 8. WCAG Compliance Tests
**File**: `tests/integration/wcag-compliance.test.ts`

#### Accessibility Standards (15 tests)
```typescript
describe('WCAG 2.1 AA Compliance', () => {
  test('should have proper heading hierarchy');
  test('should have sufficient color contrast (4.5:1)');
  test('should have large text contrast (3:1)');
  test('should provide text alternatives');
  test('should have keyboard accessibility');
  test('should have clear focus indicators');
  test('should have proper link text');
  test('should have form labels');
  test('should handle errors accessibly');
  test('should have consistent navigation');
  test('should identify page language');
  test('should parse correctly (valid HTML)');
  test('should have descriptive page title');
  test('should avoid seizure triggers');
  test('should provide multiple ways to find content');
});
```

### 9. Reduced Motion Tests
**File**: `tests/integration/reduced-motion.test.ts`

#### Animation Control (6 tests)
```typescript
describe('Reduced Motion Support', () => {
  test('should detect prefers-reduced-motion');
  test('should disable animations when requested');
  test('should maintain functionality without animations');
  test('should apply to all UI components');
  test('should apply to Three.js animations');
  test('should update when preference changes');
});
```

### 10. Performance Tests
**File**: `tests/performance/accessibility-performance.test.ts`

#### Performance Impact (8 tests)
```typescript
describe('Accessibility Performance', () => {
  test('should not impact frame rate significantly');
  test('should handle rapid focus changes efficiently');
  test('should queue announcements without blocking');
  test('should render focus indicators efficiently');
  test('should handle keyboard events without lag');
  test('should maintain 60fps with accessibility enabled');
  test('should not increase memory usage significantly');
  test('should lazy-load accessibility features');
});
```

### 11. Mobile Accessibility Tests
**File**: `tests/integration/mobile-accessibility.test.ts`

#### Touch and Mobile (5 tests)
```typescript
describe('Mobile Accessibility', () => {
  test('should provide touch-friendly tap targets');
  test('should work with screen reader gestures');
  test('should handle virtual keyboard');
  test('should support pinch zoom');
  test('should work in landscape and portrait');
});
```

### 12. Browser Compatibility Tests
**File**: `tests/integration/browser-compatibility.test.ts`

#### Cross-Browser (6 tests)
```typescript
describe('Browser Compatibility', () => {
  test('should work with Chrome + ChromeVox');
  test('should work with Firefox + NVDA');
  test('should work with Safari + VoiceOver');
  test('should work with Edge + Narrator');
  test('should handle browser-specific shortcuts');
  test('should work with browser extensions');
});
```

## Test Data and Fixtures

### Accessibility Test Helpers
```typescript
// tests/helpers/accessibility.ts
export const a11yAudit = async (container: HTMLElement) => {
  // Run automated accessibility audit
};

export const simulateScreenReader = () => {
  // Mock screen reader behavior
};

export const getAnnouncements = () => {
  // Get all live region announcements
};

export const tabThrough = async (container: HTMLElement) => {
  // Tab through all focusable elements
};
```

## Manual Testing Checklist

### Screen Reader Testing
- [ ] Test with NVDA on Windows
- [ ] Test with JAWS on Windows
- [ ] Test with VoiceOver on macOS
- [ ] Test with TalkBack on Android
- [ ] Test with VoiceOver on iOS

### Keyboard Testing
- [ ] Complete game using only keyboard
- [ ] Test all keyboard shortcuts
- [ ] Test with sticky keys enabled
- [ ] Test with different keyboard layouts
- [ ] Test focus indicators visibility

### Visual Testing
- [ ] High contrast mode in Windows
- [ ] Zoom to 200% without horizontal scroll
- [ ] Color blind simulator testing
- [ ] Test with Windows Magnifier
- [ ] Test reduced motion preferences

### Cognitive Accessibility
- [ ] Clear error messages
- [ ] Consistent navigation
- [ ] No time limits
- [ ] Clear instructions
- [ ] Predictable behavior

## Performance Benchmarks

- Focus change: <16ms (one frame)
- Announcement processing: <50ms
- High contrast toggle: <100ms
- Keyboard event handling: <8ms
- No frame drops with all features enabled

## Coverage Requirements

- Unit test coverage: >95%
- Integration test coverage: >90%
- WCAG automated tests: 100% pass
- Manual screen reader testing: All flows
- Browser compatibility: 4 major browsers

Total tests for this chunk: **140+ tests**