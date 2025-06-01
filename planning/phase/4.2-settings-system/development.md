# Chunk 4.2: Settings System - Development Guide

## Overview
This chunk implements a comprehensive visual customization system that allows players to personalize their game experience. The system includes color customization, transparency controls, preset themes, and real-time preview capabilities.

## Key Features
1. **Color Customization**: All visual elements can be customized
2. **Transparency Controls**: Opacity settings for better visibility
3. **Theme System**: Preset themes and custom theme creation
4. **Real-time Preview**: Changes appear immediately in the game
5. **Settings Organization**: Categorized settings for easy navigation
6. **Reset Functionality**: Quick return to default settings
7. **Validation**: Bounds checking and error handling

## Classes to Implement

### 1. Enhanced Settings Class
**File**: `src/storage/Settings.ts` (enhance existing)

```typescript
interface ColorSettings {
  boardGrid: string;
  nodeSpheres: string;
  blackPieces: string;
  whitePieces: string;
  temporaryPieces: string;
  highlightedNodes: string;
  highlightedLines: string;
  capturedPieces: string;
  winningLine: string;
  background: string;
  ambientLight: string;
  directionalLight: string;
}

interface OpacitySettings {
  boardGrid: number;
  nodeSpheres: number;
  pieces: number;
  temporaryPieces: number;
  highlights: number;
}

interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ColorSettings;
  opacity: OpacitySettings;
  isCustom: boolean;
}

class Settings {
  // Existing properties...
  
  // New properties
  private colors: ColorSettings;
  private opacity: OpacitySettings;
  private activeTheme: string;
  private customThemes: ThemePreset[];
  private previewMode: boolean;
  private previewSettings: Partial<Settings>;
  
  // Theme presets
  static readonly PRESET_THEMES: ThemePreset[] = [
    {
      id: 'default',
      name: 'Classic',
      description: 'Traditional black and white pieces',
      colors: {
        boardGrid: '#666666',
        nodeSpheres: '#888888',
        blackPieces: '#000000',
        whitePieces: '#ffffff',
        temporaryPieces: '#ffff00',
        highlightedNodes: '#00ff00',
        highlightedLines: '#00ffff',
        capturedPieces: '#ff0000',
        winningLine: '#ffd700',
        background: '#1a1a1a',
        ambientLight: '#ffffff',
        directionalLight: '#ffffff'
      },
      opacity: {
        boardGrid: 0.3,
        nodeSpheres: 0.5,
        pieces: 1.0,
        temporaryPieces: 0.7,
        highlights: 0.8
      },
      isCustom: false
    },
    {
      id: 'ocean',
      name: 'Ocean',
      description: 'Cool blues and aqua tones',
      colors: {
        boardGrid: '#4a90e2',
        nodeSpheres: '#6bb6ff',
        blackPieces: '#1a5490',
        whitePieces: '#e6f3ff',
        temporaryPieces: '#00e5ff',
        highlightedNodes: '#00ff88',
        highlightedLines: '#00ffff',
        capturedPieces: '#ff6b6b',
        winningLine: '#ffd93d',
        background: '#0d1b2a',
        ambientLight: '#e6f3ff',
        directionalLight: '#ffffff'
      },
      opacity: {
        boardGrid: 0.4,
        nodeSpheres: 0.6,
        pieces: 1.0,
        temporaryPieces: 0.8,
        highlights: 0.9
      },
      isCustom: false
    },
    {
      id: 'forest',
      name: 'Forest',
      description: 'Natural greens and earth tones',
      colors: {
        boardGrid: '#4a7c59',
        nodeSpheres: '#6b8e5a',
        blackPieces: '#2d3a2d',
        whitePieces: '#f4e8c1',
        temporaryPieces: '#a0c334',
        highlightedNodes: '#76ff03',
        highlightedLines: '#64dd17',
        capturedPieces: '#d32f2f',
        winningLine: '#ffc107',
        background: '#1b1f1b',
        ambientLight: '#f4e8c1',
        directionalLight: '#ffffff'
      },
      opacity: {
        boardGrid: 0.35,
        nodeSpheres: 0.55,
        pieces: 1.0,
        temporaryPieces: 0.75,
        highlights: 0.85
      },
      isCustom: false
    },
    {
      id: 'sunset',
      name: 'Sunset',
      description: 'Warm oranges and purples',
      colors: {
        boardGrid: '#ff6b6b',
        nodeSpheres: '#ff8787',
        blackPieces: '#4a0e4e',
        whitePieces: '#ffe5b4',
        temporaryPieces: '#ffa726',
        highlightedNodes: '#ff5722',
        highlightedLines: '#ff7043',
        capturedPieces: '#e91e63',
        winningLine: '#ffeb3b',
        background: '#1a0033',
        ambientLight: '#ffe5b4',
        directionalLight: '#ffd54f'
      },
      opacity: {
        boardGrid: 0.4,
        nodeSpheres: 0.6,
        pieces: 1.0,
        temporaryPieces: 0.8,
        highlights: 0.9
      },
      isCustom: false
    },
    {
      id: 'neon',
      name: 'Neon',
      description: 'Bright cyberpunk colors',
      colors: {
        boardGrid: '#ff00ff',
        nodeSpheres: '#00ffff',
        blackPieces: '#0a0a0a',
        whitePieces: '#f0f0f0',
        temporaryPieces: '#ffff00',
        highlightedNodes: '#00ff00',
        highlightedLines: '#ff00ff',
        capturedPieces: '#ff0066',
        winningLine: '#00ffff',
        background: '#000000',
        ambientLight: '#666666',
        directionalLight: '#ffffff'
      },
      opacity: {
        boardGrid: 0.6,
        nodeSpheres: 0.8,
        pieces: 1.0,
        temporaryPieces: 0.9,
        highlights: 1.0
      },
      isCustom: false
    }
  ];
  
  // Methods
  getColor(element: keyof ColorSettings): string;
  setColor(element: keyof ColorSettings, color: string): void;
  
  getOpacity(element: keyof OpacitySettings): number;
  setOpacity(element: keyof OpacitySettings, value: number): void;
  
  getActiveTheme(): ThemePreset | undefined;
  setActiveTheme(themeId: string): void;
  applyTheme(theme: ThemePreset): void;
  
  createCustomTheme(name: string, description: string): ThemePreset;
  updateCustomTheme(themeId: string, updates: Partial<ThemePreset>): void;
  deleteCustomTheme(themeId: string): void;
  getCustomThemes(): ThemePreset[];
  
  // Preview mode
  startPreview(): void;
  updatePreview(changes: Partial<Settings>): void;
  applyPreview(): void;
  cancelPreview(): void;
  isInPreviewMode(): boolean;
  
  // Validation
  validateColor(color: string): boolean;
  validateOpacity(value: number): boolean;
  
  // Reset
  resetToDefaults(): void;
  resetColors(): void;
  resetOpacity(): void;
  
  // Import/Export themes
  exportTheme(themeId: string): string;
  importTheme(themeData: string): ThemePreset;
  
  // Serialization (extend existing)
  toJSON(): any;
  static fromJSON(data: any): Settings;
}
```

### 2. Enhanced SettingsModal Class
**File**: `src/ui/SettingsModal.ts` (enhance existing)

```typescript
class SettingsModal extends Modal {
  private settings: Settings;
  private renderer: Renderer;
  private previewContainer: HTMLElement;
  private colorPickers: Map<string, HTMLInputElement>;
  private opacitySliders: Map<string, HTMLInputElement>;
  private themeSelector: HTMLSelectElement;
  private categoryTabs: HTMLElement[];
  private activeCategory: string;
  
  constructor(settings: Settings, renderer: Renderer) {
    super('settings-modal', 'Settings');
    // Initialize components
  }
  
  // UI Creation
  private createContent(): HTMLElement {
    // Create tabbed interface
    // Categories: Themes, Colors, Opacity, Advanced
  }
  
  private createThemeTab(): HTMLElement {
    // Theme selector
    // Theme preview cards
    // Custom theme management
  }
  
  private createColorsTab(): HTMLElement {
    // Color pickers for each element
    // Grouped by category (Board, Pieces, Highlights, Lighting)
    // Live preview
  }
  
  private createOpacityTab(): HTMLElement {
    // Opacity sliders
    // Visual preview of opacity changes
  }
  
  private createAdvancedTab(): HTMLElement {
    // Import/Export themes
    // Reset options
    // Performance settings
  }
  
  // Event Handlers
  private handleColorChange(element: string, color: string): void;
  private handleOpacityChange(element: string, value: number): void;
  private handleThemeChange(themeId: string): void;
  private handleCreateCustomTheme(): void;
  private handleDeleteTheme(themeId: string): void;
  private handleResetToDefaults(): void;
  private handleImportTheme(): void;
  private handleExportTheme(themeId: string): void;
  
  // Preview
  private updatePreview(): void;
  private renderMiniPreview(): void;
  
  // Validation
  private validateInputs(): boolean;
  private showValidationError(message: string): void;
  
  // Apply/Cancel
  protected onConfirm(): void;
  protected onCancel(): void;
}
```

### 3. Enhanced Renderer Class Integration
**File**: `src/rendering/Renderer.ts` (enhance existing)

```typescript
class Renderer {
  // Add methods to apply settings
  applyColorSettings(colors: ColorSettings): void {
    // Update material colors
    // Update light colors
    // Update background
  }
  
  applyOpacitySettings(opacity: OpacitySettings): void {
    // Update material opacity
    // Update transparency
  }
  
  // Real-time updates
  updateElementColor(element: string, color: string): void;
  updateElementOpacity(element: string, opacity: number): void;
  
  // Preview mode
  enterPreviewMode(): void;
  exitPreviewMode(): void;
  applyPreviewSettings(settings: Partial<Settings>): void;
}
```

### 4. Enhanced StorageManager Integration
**File**: `src/storage/StorageManager.ts` (enhance existing)

```typescript
class StorageManager {
  // Add theme storage
  private static readonly CUSTOM_THEMES_KEY = 'pente3d_custom_themes';
  
  saveCustomThemes(themes: ThemePreset[]): void;
  loadCustomThemes(): ThemePreset[];
  
  // Extend settings save/load to include new properties
}
```

## Implementation Steps

1. **Enhance Settings Class**
   - Add color and opacity properties
   - Implement theme preset system
   - Add preview mode functionality
   - Implement validation methods
   - Add theme import/export

2. **Enhance SettingsModal**
   - Create tabbed interface
   - Implement color pickers
   - Add opacity sliders
   - Create theme management UI
   - Add real-time preview

3. **Update Renderer**
   - Add methods to apply color settings
   - Implement opacity updates
   - Add preview mode support
   - Ensure performance during updates

4. **Integrate StorageManager**
   - Extend to save custom themes
   - Update settings persistence
   - Handle migration for existing saves

5. **Wire Everything Together**
   - Connect settings changes to renderer
   - Implement real-time preview
   - Add event listeners
   - Update main.ts integration

## UI/UX Considerations

1. **Tabbed Interface**
   - Clear category separation
   - Visual indicators for active tab
   - Smooth transitions between tabs

2. **Color Pickers**
   - Native HTML5 color inputs
   - Hex value display
   - Copy/paste support
   - Eyedropper tool hint

3. **Opacity Sliders**
   - Range: 0-100%
   - Live value display
   - Visual preview bar

4. **Theme Cards**
   - Visual preview of theme
   - Name and description
   - Apply/Edit/Delete buttons
   - Custom theme indicator

5. **Preview Area**
   - Mini 3D scene showing changes
   - Before/after comparison
   - Real-time updates

## Performance Optimizations

1. **Debounced Updates**
   - Throttle color picker events
   - Batch renderer updates
   - Optimize material updates

2. **Preview Optimization**
   - Use simplified scene for preview
   - Cache material instances
   - Minimize re-renders

3. **Memory Management**
   - Dispose old materials properly
   - Limit custom theme count
   - Clean up event listeners

## Error Handling

1. **Validation**
   - Valid hex color format
   - Opacity within 0-1 range
   - Theme name uniqueness
   - Storage quota checks

2. **User Feedback**
   - Clear error messages
   - Visual validation indicators
   - Success confirmations
   - Undo notifications

## Accessibility

1. **Keyboard Navigation**
   - Tab through all controls
   - Arrow keys for sliders
   - Enter to apply changes
   - Escape to cancel

2. **Screen Reader Support**
   - Proper ARIA labels
   - Role attributes
   - Live regions for updates
   - Descriptive text

3. **Visual Accessibility**
   - High contrast mode
   - Color blind friendly defaults
   - Clear focus indicators
   - Sufficient color contrast

## Testing Considerations

1. **Unit Tests**
   - Settings class methods
   - Theme management
   - Validation functions
   - Serialization

2. **Integration Tests**
   - Settings to renderer updates
   - Preview mode functionality
   - Storage persistence
   - Theme import/export

3. **Visual Tests**
   - Theme application
   - Color accuracy
   - Opacity rendering
   - UI appearance

4. **Performance Tests**
   - Real-time preview frame rate
   - Update batching efficiency
   - Memory usage
   - Large theme collections