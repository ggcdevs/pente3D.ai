import { SettingsData } from './StorageManager';

export interface SettingsChangeListener {
  (settings: Settings): void;
}

export interface ColorSettings {
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

export interface OpacitySettings {
  boardGrid: number;
  nodeSpheres: number;
  pieces: number;
  temporaryPieces: number;
  highlights: number;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ColorSettings;
  opacity: OpacitySettings;
  isCustom: boolean;
}

export class Settings {
  private gridDiagonals: boolean;
  private playerColors: {
    player1: string;
    player2: string;
  };
  private cameraPosition?: {
    x: number;
    y: number;
    z: number;
  };
  private soundEnabled: boolean;
  private animationSpeed: number;
  private listeners: SettingsChangeListener[] = [];

  // New properties for theme system
  private colors: ColorSettings;
  private opacity: OpacitySettings;
  private activeTheme: string;
  private customThemes: ThemePreset[];
  private previewMode: boolean = false;
  private previewSettings?: Partial<{
    colors: ColorSettings;
    opacity: OpacitySettings;
    activeTheme: string;
  }>;

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
        directionalLight: '#ffffff',
      },
      opacity: {
        boardGrid: 0.3,
        nodeSpheres: 0.5,
        pieces: 1.0,
        temporaryPieces: 0.7,
        highlights: 0.8,
      },
      isCustom: false,
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
        directionalLight: '#ffffff',
      },
      opacity: {
        boardGrid: 0.4,
        nodeSpheres: 0.6,
        pieces: 1.0,
        temporaryPieces: 0.8,
        highlights: 0.9,
      },
      isCustom: false,
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
        directionalLight: '#ffffff',
      },
      opacity: {
        boardGrid: 0.35,
        nodeSpheres: 0.55,
        pieces: 1.0,
        temporaryPieces: 0.75,
        highlights: 0.85,
      },
      isCustom: false,
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
        directionalLight: '#ffd54f',
      },
      opacity: {
        boardGrid: 0.4,
        nodeSpheres: 0.6,
        pieces: 1.0,
        temporaryPieces: 0.8,
        highlights: 0.9,
      },
      isCustom: false,
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
        directionalLight: '#ffffff',
      },
      opacity: {
        boardGrid: 0.6,
        nodeSpheres: 0.8,
        pieces: 1.0,
        temporaryPieces: 0.9,
        highlights: 1.0,
      },
      isCustom: false,
    },
  ];

  constructor(data?: Partial<SettingsData>) {
    this.gridDiagonals = data?.gridDiagonals ?? false;
    this.playerColors = data?.playerColors ?? {
      player1: '#000000',
      player2: '#FFFFFF',
    };
    this.cameraPosition = data?.cameraPosition;
    this.soundEnabled = data?.soundEnabled ?? true;
    this.animationSpeed = data?.animationSpeed ?? 1.0;

    // Initialize theme system with defaults
    const defaultTheme = Settings.PRESET_THEMES[0];
    this.colors = (data as any)?.colors ?? { ...defaultTheme.colors };
    this.opacity = (data as any)?.opacity ?? { ...defaultTheme.opacity };
    this.activeTheme = (data as any)?.activeTheme ?? 'default';

    // Load custom themes from storage or data
    if ((data as any)?.customThemes) {
      this.customThemes = (data as any).customThemes;
    } else {
      // Try to load from separate storage
      try {
        const StorageManager = require('./StorageManager').StorageManager;
        this.customThemes = StorageManager.loadCustomThemes();
      } catch {
        this.customThemes = [];
      }
    }

    // Update player colors from theme
    if (!data?.playerColors) {
      this.playerColors.player1 = this.colors.blackPieces;
      this.playerColors.player2 = this.colors.whitePieces;
    }
  }

  getGridDiagonals(): boolean {
    return this.gridDiagonals;
  }

  setGridDiagonals(enabled: boolean): void {
    if (this.gridDiagonals !== enabled) {
      this.gridDiagonals = enabled;
      this.notifyListeners();
    }
  }

  getPlayerColor(player: 1 | 2): string {
    return player === 1 ? this.playerColors.player1 : this.playerColors.player2;
  }

  setPlayerColor(player: 1 | 2, color: string): void {
    const key = player === 1 ? 'player1' : 'player2';
    if (this.playerColors[key] !== color) {
      this.playerColors[key] = color;
      this.notifyListeners();
    }
  }

  getCameraPosition(): { x: number; y: number; z: number } | undefined {
    return this.cameraPosition ? { ...this.cameraPosition } : undefined;
  }

  setCameraPosition(position: { x: number; y: number; z: number } | undefined): void {
    this.cameraPosition = position ? { ...position } : undefined;
    this.notifyListeners();
  }

  getSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  setSoundEnabled(enabled: boolean): void {
    if (this.soundEnabled !== enabled) {
      this.soundEnabled = enabled;
      this.notifyListeners();
    }
  }

  getAnimationSpeed(): number {
    return this.animationSpeed;
  }

  setAnimationSpeed(speed: number): void {
    const clampedSpeed = Math.max(0.1, Math.min(5.0, speed));
    if (this.animationSpeed !== clampedSpeed) {
      this.animationSpeed = clampedSpeed;
      this.notifyListeners();
    }
  }

  reset(): void {
    this.resetToDefaults();
  }

  addChangeListener(listener: SettingsChangeListener): void {
    this.listeners.push(listener);
  }

  removeChangeListener(listener: SettingsChangeListener): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  toJSON(): any {
    return {
      gridDiagonals: this.gridDiagonals,
      playerColors: { ...this.playerColors },
      cameraPosition: this.cameraPosition ? { ...this.cameraPosition } : undefined,
      soundEnabled: this.soundEnabled,
      animationSpeed: this.animationSpeed,
      colors: { ...this.colors },
      opacity: { ...this.opacity },
      activeTheme: this.activeTheme,
      customThemes: this.customThemes.map((theme) => ({
        ...theme,
        colors: { ...theme.colors },
        opacity: { ...theme.opacity },
      })),
    };
  }

  static fromJSON(data: any): Settings {
    return new Settings(data);
  }

  clone(): Settings {
    return new Settings(this.toJSON());
  }

  equals(other: Settings): boolean {
    return (
      this.gridDiagonals === other.gridDiagonals &&
      this.playerColors.player1 === other.playerColors.player1 &&
      this.playerColors.player2 === other.playerColors.player2 &&
      this.soundEnabled === other.soundEnabled &&
      this.animationSpeed === other.animationSpeed &&
      this.cameraPositionsEqual(this.cameraPosition, other.cameraPosition) &&
      this.activeTheme === other.activeTheme &&
      JSON.stringify(this.colors) === JSON.stringify(other.colors) &&
      JSON.stringify(this.opacity) === JSON.stringify(other.opacity) &&
      JSON.stringify(this.customThemes) === JSON.stringify(other.customThemes)
    );
  }

  private cameraPositionsEqual(
    a: { x: number; y: number; z: number } | undefined,
    b: { x: number; y: number; z: number } | undefined
  ): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this));

    // Auto-save custom themes when they change
    try {
      const StorageManager = require('./StorageManager').StorageManager;
      StorageManager.saveCustomThemes(this.customThemes);
    } catch {
      // Ignore errors during auto-save
    }
  }

  // Color management methods
  getColor(element: keyof ColorSettings): string {
    const settings =
      this.previewMode && this.previewSettings?.colors
        ? { ...this.colors, ...this.previewSettings.colors }
        : this.colors;
    return settings[element];
  }

  setColor(element: keyof ColorSettings, color: string): void {
    if (!this.validateColor(color)) {
      throw new Error(`Invalid color format: ${color}`);
    }

    const normalizedColor = this.normalizeColor(color);

    if (this.previewMode && this.previewSettings) {
      if (!this.previewSettings.colors) {
        this.previewSettings.colors = { ...this.colors };
      }
      this.previewSettings.colors[element] = normalizedColor;
    } else {
      if (this.colors[element] !== normalizedColor) {
        this.colors[element] = normalizedColor;

        // Update player colors if piece colors changed
        if (element === 'blackPieces') {
          this.playerColors.player1 = normalizedColor;
        } else if (element === 'whitePieces') {
          this.playerColors.player2 = normalizedColor;
        }

        this.notifyListeners();
      }
    }
  }

  getColors(): ColorSettings {
    if (this.previewMode && this.previewSettings?.colors) {
      return { ...this.colors, ...this.previewSettings.colors };
    }
    return { ...this.colors };
  }

  // Opacity management methods
  getOpacity(element: keyof OpacitySettings): number {
    const settings =
      this.previewMode && this.previewSettings?.opacity
        ? { ...this.opacity, ...this.previewSettings.opacity }
        : this.opacity;
    return settings[element];
  }

  setOpacity(element: keyof OpacitySettings, value: number): void {
    const clampedValue = Math.max(0, Math.min(1, value));

    if (this.previewMode && this.previewSettings) {
      if (!this.previewSettings.opacity) {
        this.previewSettings.opacity = { ...this.opacity };
      }
      this.previewSettings.opacity[element] = clampedValue;
    } else {
      if (this.opacity[element] !== clampedValue) {
        this.opacity[element] = clampedValue;
        this.notifyListeners();
      }
    }
  }

  getOpacitySettings(): OpacitySettings {
    if (this.previewMode && this.previewSettings?.opacity) {
      return { ...this.opacity, ...this.previewSettings.opacity };
    }
    return { ...this.opacity };
  }

  // Theme management methods
  getActiveTheme(): ThemePreset | undefined {
    const themeId =
      this.previewMode && this.previewSettings?.activeTheme
        ? this.previewSettings.activeTheme
        : this.activeTheme;

    const allThemes = [...Settings.PRESET_THEMES, ...this.customThemes];
    return allThemes.find((theme) => theme.id === themeId);
  }

  setActiveTheme(themeId: string): void {
    const theme = [...Settings.PRESET_THEMES, ...this.customThemes].find((t) => t.id === themeId);

    if (!theme) {
      throw new Error(`Theme not found: ${themeId}`);
    }

    if (this.previewMode && this.previewSettings) {
      this.previewSettings.activeTheme = themeId;
      this.previewSettings.colors = { ...theme.colors };
      this.previewSettings.opacity = { ...theme.opacity };
    } else {
      this.applyTheme(theme);
    }
  }

  applyTheme(theme: ThemePreset): void {
    this.colors = { ...theme.colors };
    this.opacity = { ...theme.opacity };
    this.activeTheme = theme.id;

    // Update player colors
    this.playerColors.player1 = theme.colors.blackPieces;
    this.playerColors.player2 = theme.colors.whitePieces;

    this.notifyListeners();
  }

  createCustomTheme(name: string, description: string): ThemePreset {
    if (this.customThemes.length >= 10) {
      throw new Error('Maximum number of custom themes reached (10)');
    }

    const theme: ThemePreset = {
      id: `custom_${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      colors: { ...this.colors },
      opacity: { ...this.opacity },
      isCustom: true,
    };

    this.customThemes.push(theme);
    this.notifyListeners();
    return theme;
  }

  updateCustomTheme(themeId: string, updates: Partial<ThemePreset>): void {
    const themeIndex = this.customThemes.findIndex((t) => t.id === themeId);
    if (themeIndex === -1) {
      throw new Error(`Custom theme not found: ${themeId}`);
    }

    const theme = this.customThemes[themeIndex];
    if (updates.name !== undefined) theme.name = updates.name.trim();
    if (updates.description !== undefined) theme.description = updates.description.trim();
    if (updates.colors) theme.colors = { ...theme.colors, ...updates.colors };
    if (updates.opacity) theme.opacity = { ...theme.opacity, ...updates.opacity };

    this.notifyListeners();
  }

  deleteCustomTheme(themeId: string): void {
    const index = this.customThemes.findIndex((t) => t.id === themeId);
    if (index === -1) {
      throw new Error(`Custom theme not found: ${themeId}`);
    }

    this.customThemes.splice(index, 1);

    // If deleted theme was active, switch to default
    if (this.activeTheme === themeId) {
      this.setActiveTheme('default');
    }

    this.notifyListeners();
  }

  getCustomThemes(): ThemePreset[] {
    return [...this.customThemes];
  }

  getAllThemes(): ThemePreset[] {
    return [...Settings.PRESET_THEMES, ...this.customThemes];
  }

  // Preview mode methods
  startPreview(): void {
    if (!this.previewMode) {
      this.previewMode = true;
      this.previewSettings = {};
    }
  }

  updatePreview(
    changes: Partial<{
      colors: Partial<ColorSettings>;
      opacity: Partial<OpacitySettings>;
      activeTheme: string;
    }>
  ): void {
    if (!this.previewMode) {
      this.startPreview();
    }

    if (changes.colors) {
      this.previewSettings!.colors = {
        ...(this.previewSettings!.colors || this.colors),
        ...changes.colors,
      };
    }

    if (changes.opacity) {
      this.previewSettings!.opacity = {
        ...(this.previewSettings!.opacity || this.opacity),
        ...changes.opacity,
      };
    }

    if (changes.activeTheme !== undefined) {
      this.previewSettings!.activeTheme = changes.activeTheme;
    }

    this.notifyListeners();
  }

  applyPreview(): void {
    if (!this.previewMode || !this.previewSettings) return;

    if (this.previewSettings.colors) {
      this.colors = { ...this.colors, ...this.previewSettings.colors };
    }

    if (this.previewSettings.opacity) {
      this.opacity = { ...this.opacity, ...this.previewSettings.opacity };
    }

    if (this.previewSettings.activeTheme !== undefined) {
      this.activeTheme = this.previewSettings.activeTheme;
    }

    // Update player colors
    this.playerColors.player1 = this.colors.blackPieces;
    this.playerColors.player2 = this.colors.whitePieces;

    this.previewMode = false;
    this.previewSettings = undefined;
    this.notifyListeners();
  }

  cancelPreview(): void {
    if (this.previewMode) {
      this.previewMode = false;
      this.previewSettings = undefined;
      this.notifyListeners();
    }
  }

  isInPreviewMode(): boolean {
    return this.previewMode;
  }

  // Validation methods
  validateColor(color: string): boolean {
    if (!color) return false;

    // Support hex colors with or without #
    const hexPattern = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexPattern.test(color);
  }

  validateOpacity(value: number): boolean {
    return typeof value === 'number' && value >= 0 && value <= 1;
  }

  private normalizeColor(color: string): string {
    // Add # if missing
    if (color && !color.startsWith('#')) {
      color = '#' + color;
    }

    // Convert 3-digit hex to 6-digit
    if (color.length === 4) {
      color = '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }

    return color.toUpperCase();
  }

  // Reset methods
  resetToDefaults(): void {
    const defaultTheme = Settings.PRESET_THEMES[0];
    this.applyTheme(defaultTheme);
    this.gridDiagonals = false;
    this.cameraPosition = undefined;
    this.soundEnabled = true;
    this.animationSpeed = 1.0;
    this.customThemes = [];
    this.previewMode = false;
    this.previewSettings = undefined;
    this.notifyListeners();
  }

  resetColors(): void {
    const defaultTheme = Settings.PRESET_THEMES[0];
    this.colors = { ...defaultTheme.colors };
    this.playerColors.player1 = this.colors.blackPieces;
    this.playerColors.player2 = this.colors.whitePieces;
    this.notifyListeners();
  }

  resetOpacity(): void {
    const defaultTheme = Settings.PRESET_THEMES[0];
    this.opacity = { ...defaultTheme.opacity };
    this.notifyListeners();
  }

  // Import/Export themes
  exportTheme(themeId: string): string {
    const theme = [...Settings.PRESET_THEMES, ...this.customThemes].find((t) => t.id === themeId);

    if (!theme) {
      throw new Error(`Theme not found: ${themeId}`);
    }

    return JSON.stringify(theme, null, 2);
  }

  importTheme(themeData: string): ThemePreset {
    try {
      const theme = JSON.parse(themeData) as ThemePreset;

      // Validate theme structure
      if (!theme.id || !theme.name || !theme.colors || !theme.opacity) {
        throw new Error('Invalid theme structure');
      }

      // Validate all required color fields
      const requiredColors: (keyof ColorSettings)[] = [
        'boardGrid',
        'nodeSpheres',
        'blackPieces',
        'whitePieces',
        'temporaryPieces',
        'highlightedNodes',
        'highlightedLines',
        'capturedPieces',
        'winningLine',
        'background',
        'ambientLight',
        'directionalLight',
      ];

      for (const colorKey of requiredColors) {
        if (!theme.colors[colorKey] || !this.validateColor(theme.colors[colorKey])) {
          throw new Error(`Invalid or missing color: ${colorKey}`);
        }
      }

      // Validate all required opacity fields
      const requiredOpacity: (keyof OpacitySettings)[] = [
        'boardGrid',
        'nodeSpheres',
        'pieces',
        'temporaryPieces',
        'highlights',
      ];

      for (const opacityKey of requiredOpacity) {
        if (!this.validateOpacity(theme.opacity[opacityKey])) {
          throw new Error(`Invalid opacity: ${opacityKey}`);
        }
      }

      // Generate new ID for imported theme
      const importedTheme: ThemePreset = {
        ...theme,
        id: `imported_${Date.now()}`,
        isCustom: true,
      };

      this.customThemes.push(importedTheme);
      this.notifyListeners();

      return importedTheme;
    } catch (error) {
      throw new Error(
        `Failed to import theme: ${error instanceof Error ? error.message : 'Invalid data'}`
      );
    }
  }
}
