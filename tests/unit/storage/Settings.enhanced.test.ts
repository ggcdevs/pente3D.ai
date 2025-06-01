import { Settings, ColorSettings, OpacitySettings, ThemePreset } from '@/storage/Settings';

describe('Settings - Enhanced Features', () => {
  let settings: Settings;

  beforeEach(() => {
    settings = new Settings();
  });

  describe('Color Management', () => {
    test('should get default colors for all elements', () => {
      const defaultTheme = Settings.PRESET_THEMES[0];
      
      expect(settings.getColor('boardGrid')).toBe(defaultTheme.colors.boardGrid);
      expect(settings.getColor('nodeSpheres')).toBe(defaultTheme.colors.nodeSpheres);
      expect(settings.getColor('blackPieces')).toBe(defaultTheme.colors.blackPieces);
      expect(settings.getColor('whitePieces')).toBe(defaultTheme.colors.whitePieces);
      expect(settings.getColor('temporaryPieces')).toBe(defaultTheme.colors.temporaryPieces);
      expect(settings.getColor('highlightedNodes')).toBe(defaultTheme.colors.highlightedNodes);
      expect(settings.getColor('highlightedLines')).toBe(defaultTheme.colors.highlightedLines);
      expect(settings.getColor('capturedPieces')).toBe(defaultTheme.colors.capturedPieces);
      expect(settings.getColor('winningLine')).toBe(defaultTheme.colors.winningLine);
      expect(settings.getColor('background')).toBe(defaultTheme.colors.background);
      expect(settings.getColor('ambientLight')).toBe(defaultTheme.colors.ambientLight);
      expect(settings.getColor('directionalLight')).toBe(defaultTheme.colors.directionalLight);
    });

    test('should set valid color for specific element', () => {
      settings.setColor('boardGrid', '#FF0000');
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
    });

    test('should reject invalid color format', () => {
      expect(() => settings.setColor('boardGrid', 'invalid')).toThrow('Invalid color format');
      expect(() => settings.setColor('boardGrid', '#GGGGGG')).toThrow('Invalid color format');
      expect(() => settings.setColor('boardGrid', '')).toThrow('Invalid color format');
    });

    test('should maintain color immutability', () => {
      const colors1 = settings.getColors();
      colors1.boardGrid = '#FF0000';
      
      const colors2 = settings.getColors();
      expect(colors2.boardGrid).not.toBe('#FF0000');
      expect(colors2.boardGrid).toBe(Settings.PRESET_THEMES[0].colors.boardGrid);
    });

    test('should reset colors to defaults', () => {
      settings.setColor('boardGrid', '#FF0000');
      settings.setColor('blackPieces', '#00FF00');
      
      settings.resetColors();
      
      const defaultTheme = Settings.PRESET_THEMES[0];
      expect(settings.getColor('boardGrid')).toBe(defaultTheme.colors.boardGrid);
      expect(settings.getColor('blackPieces')).toBe(defaultTheme.colors.blackPieces);
    });

    test('should validate hex color formats', () => {
      expect(settings.validateColor('#FFFFFF')).toBe(true);
      expect(settings.validateColor('#FFF')).toBe(true);
      expect(settings.validateColor('FFFFFF')).toBe(true);
      expect(settings.validateColor('FFF')).toBe(true);
      expect(settings.validateColor('#GGGGGG')).toBe(false);
      expect(settings.validateColor('red')).toBe(false);
      expect(settings.validateColor('')).toBe(false);
    });

    test('should handle color shortcuts (#fff -> #ffffff)', () => {
      settings.setColor('boardGrid', '#FFF');
      expect(settings.getColor('boardGrid')).toBe('#FFFFFF');
      
      settings.setColor('boardGrid', 'fff');
      expect(settings.getColor('boardGrid')).toBe('#FFFFFF');
    });

    test('should emit change event on color update', () => {
      const listener = jest.fn();
      settings.addChangeListener(listener);
      
      settings.setColor('boardGrid', '#FF0000');
      
      expect(listener).toHaveBeenCalledWith(settings);
    });
  });

  describe('Opacity Management', () => {
    test('should get default opacity values', () => {
      const defaultTheme = Settings.PRESET_THEMES[0];
      
      expect(settings.getOpacity('boardGrid')).toBe(defaultTheme.opacity.boardGrid);
      expect(settings.getOpacity('nodeSpheres')).toBe(defaultTheme.opacity.nodeSpheres);
      expect(settings.getOpacity('pieces')).toBe(defaultTheme.opacity.pieces);
      expect(settings.getOpacity('temporaryPieces')).toBe(defaultTheme.opacity.temporaryPieces);
      expect(settings.getOpacity('highlights')).toBe(defaultTheme.opacity.highlights);
    });

    test('should set opacity within valid range', () => {
      settings.setOpacity('boardGrid', 0.5);
      expect(settings.getOpacity('boardGrid')).toBe(0.5);
      
      settings.setOpacity('pieces', 0);
      expect(settings.getOpacity('pieces')).toBe(0);
      
      settings.setOpacity('highlights', 1);
      expect(settings.getOpacity('highlights')).toBe(1);
    });

    test('should clamp opacity to 0-1 range', () => {
      settings.setOpacity('boardGrid', -0.5);
      expect(settings.getOpacity('boardGrid')).toBe(0);
      
      settings.setOpacity('pieces', 1.5);
      expect(settings.getOpacity('pieces')).toBe(1);
    });

    test('should reject invalid opacity values', () => {
      expect(settings.validateOpacity(0.5)).toBe(true);
      expect(settings.validateOpacity(0)).toBe(true);
      expect(settings.validateOpacity(1)).toBe(true);
      expect(settings.validateOpacity('0.5' as any)).toBe(false);
      expect(settings.validateOpacity(null as any)).toBe(false);
      expect(settings.validateOpacity(undefined as any)).toBe(false);
    });

    test('should reset opacity to defaults', () => {
      settings.setOpacity('boardGrid', 0.8);
      settings.setOpacity('pieces', 0.5);
      
      settings.resetOpacity();
      
      const defaultTheme = Settings.PRESET_THEMES[0];
      expect(settings.getOpacity('boardGrid')).toBe(defaultTheme.opacity.boardGrid);
      expect(settings.getOpacity('pieces')).toBe(defaultTheme.opacity.pieces);
    });

    test('should handle percentage inputs (50% -> 0.5)', () => {
      // This would be handled in the UI layer, but we can test the validation
      const percentageValue = 50 / 100;
      settings.setOpacity('boardGrid', percentageValue);
      expect(settings.getOpacity('boardGrid')).toBe(0.5);
    });

    test('should emit change event on opacity update', () => {
      const listener = jest.fn();
      settings.addChangeListener(listener);
      
      settings.setOpacity('boardGrid', 0.5);
      
      expect(listener).toHaveBeenCalledWith(settings);
    });
  });

  describe('Theme System', () => {
    test('should load preset themes correctly', () => {
      const themes = Settings.PRESET_THEMES;
      
      expect(themes.length).toBeGreaterThan(0);
      expect(themes[0].id).toBe('default');
      expect(themes[0].name).toBe('Classic');
      expect(themes[0].isCustom).toBe(false);
      
      // Check all preset themes exist
      const themeIds = themes.map(t => t.id);
      expect(themeIds).toContain('default');
      expect(themeIds).toContain('ocean');
      expect(themeIds).toContain('forest');
      expect(themeIds).toContain('sunset');
      expect(themeIds).toContain('neon');
    });

    test('should apply theme colors and opacity', () => {
      const oceanTheme = Settings.PRESET_THEMES.find(t => t.id === 'ocean')!;
      settings.applyTheme(oceanTheme);
      
      expect(settings.getColor('boardGrid')).toBe(oceanTheme.colors.boardGrid);
      expect(settings.getOpacity('boardGrid')).toBe(oceanTheme.opacity.boardGrid);
      expect(settings.getActiveTheme()?.id).toBe('ocean');
    });

    test('should get active theme details', () => {
      const activeTheme = settings.getActiveTheme();
      expect(activeTheme).toBeDefined();
      expect(activeTheme?.id).toBe('default');
      expect(activeTheme?.name).toBe('Classic');
    });

    test('should create custom theme with unique ID', () => {
      const theme = settings.createCustomTheme('My Theme', 'Custom description');
      
      expect(theme.id).toMatch(/^custom_\d+$/);
      expect(theme.name).toBe('My Theme');
      expect(theme.description).toBe('Custom description');
      expect(theme.isCustom).toBe(true);
      expect(theme.colors).toEqual(settings.getColors());
      expect(theme.opacity).toEqual(settings.getOpacitySettings());
    });

    test('should update custom theme properties', () => {
      const theme = settings.createCustomTheme('Test Theme', 'Test');
      
      settings.updateCustomTheme(theme.id, {
        name: 'Updated Theme',
        description: 'Updated description',
        colors: { boardGrid: '#FF0000' } as any
      });
      
      const updatedTheme = settings.getCustomThemes().find(t => t.id === theme.id);
      expect(updatedTheme?.name).toBe('Updated Theme');
      expect(updatedTheme?.description).toBe('Updated description');
      expect(updatedTheme?.colors.boardGrid).toBe('#FF0000');
    });

    test('should delete custom theme', () => {
      const theme = settings.createCustomTheme('To Delete', 'Will be deleted');
      const themeId = theme.id;
      
      settings.deleteCustomTheme(themeId);
      
      const themes = settings.getCustomThemes();
      expect(themes.find(t => t.id === themeId)).toBeUndefined();
    });

    test('should prevent deletion of preset themes', () => {
      // Preset themes are not in customThemes array, so trying to delete will throw
      expect(() => settings.deleteCustomTheme('default')).toThrow('Custom theme not found');
    });

    test('should limit custom theme count', () => {
      // Create 10 custom themes (the limit)
      for (let i = 0; i < 10; i++) {
        settings.createCustomTheme(`Theme ${i}`, `Description ${i}`);
      }
      
      // Try to create one more
      expect(() => settings.createCustomTheme('One Too Many', 'Should fail'))
        .toThrow('Maximum number of custom themes reached');
    });

    test('should export theme as JSON string', () => {
      const themeJson = settings.exportTheme('default');
      const theme = JSON.parse(themeJson);
      
      expect(theme.id).toBe('default');
      expect(theme.name).toBe('Classic');
      expect(theme.colors).toBeDefined();
      expect(theme.opacity).toBeDefined();
    });

    test('should import valid theme data', () => {
      const customTheme = {
        id: 'test',
        name: 'Imported Theme',
        description: 'Imported from JSON',
        colors: Settings.PRESET_THEMES[0].colors,
        opacity: Settings.PRESET_THEMES[0].opacity,
        isCustom: true
      };
      
      const imported = settings.importTheme(JSON.stringify(customTheme));
      
      expect(imported.id).toMatch(/^imported_\d+$/);
      expect(imported.name).toBe('Imported Theme');
      expect(imported.isCustom).toBe(true);
      
      const themes = settings.getCustomThemes();
      expect(themes.find(t => t.name === 'Imported Theme')).toBeDefined();
    });

    test('should reject invalid theme imports', () => {
      expect(() => settings.importTheme('invalid json'))
        .toThrow('Failed to import theme');
        
      expect(() => settings.importTheme('{}'))
        .toThrow('Failed to import theme');
        
      const invalidTheme = { id: 'test', name: 'Missing colors' };
      expect(() => settings.importTheme(JSON.stringify(invalidTheme)))
        .toThrow('Failed to import theme');
    });

    test('should maintain theme immutability', () => {
      const theme = settings.getActiveTheme()!;
      const originalColor = theme.colors.boardGrid;
      
      theme.colors.boardGrid = '#FF0000';
      
      const themeAgain = settings.getActiveTheme()!;
      expect(themeAgain.colors.boardGrid).toBe(originalColor);
    });
  });

  describe('Preview Mode', () => {
    test('should enter preview mode', () => {
      expect(settings.isInPreviewMode()).toBe(false);
      
      settings.startPreview();
      
      expect(settings.isInPreviewMode()).toBe(true);
    });

    test('should update preview settings without affecting actual', () => {
      const originalColor = settings.getColor('boardGrid');
      
      settings.startPreview();
      settings.setColor('boardGrid', '#FF0000');
      
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
      
      settings.cancelPreview();
      
      expect(settings.getColor('boardGrid')).toBe(originalColor);
    });

    test('should apply preview changes', () => {
      settings.startPreview();
      settings.setColor('boardGrid', '#FF0000');
      settings.setOpacity('pieces', 0.7);
      
      settings.applyPreview();
      
      expect(settings.isInPreviewMode()).toBe(false);
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
      expect(settings.getOpacity('pieces')).toBe(0.7);
    });

    test('should cancel preview and revert', () => {
      const originalColor = settings.getColor('boardGrid');
      const originalOpacity = settings.getOpacity('pieces');
      
      settings.startPreview();
      settings.setColor('boardGrid', '#FF0000');
      settings.setOpacity('pieces', 0.5);
      
      settings.cancelPreview();
      
      expect(settings.isInPreviewMode()).toBe(false);
      expect(settings.getColor('boardGrid')).toBe(originalColor);
      expect(settings.getOpacity('pieces')).toBe(originalOpacity);
    });

    test('should track preview mode state', () => {
      expect(settings.isInPreviewMode()).toBe(false);
      
      settings.startPreview();
      expect(settings.isInPreviewMode()).toBe(true);
      
      settings.applyPreview();
      expect(settings.isInPreviewMode()).toBe(false);
    });

    test('should handle nested preview sessions', () => {
      settings.startPreview();
      settings.setColor('boardGrid', '#FF0000');
      
      // Starting preview again should not reset preview settings
      settings.startPreview();
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
    });

    test('should emit preview events', () => {
      const listener = jest.fn();
      settings.addChangeListener(listener);
      
      settings.startPreview();
      settings.setColor('boardGrid', '#FF0000');
      
      expect(listener).toHaveBeenCalled();
    });

    test('should clean up on preview exit', () => {
      settings.startPreview();
      settings.updatePreview({
        colors: { boardGrid: '#FF0000' },
        opacity: { pieces: 0.5 }
      });
      
      settings.cancelPreview();
      
      // Should not have preview settings anymore
      settings.startPreview();
      expect(settings.getColor('boardGrid')).not.toBe('#FF0000');
    });
  });

  describe('Serialization and Persistence', () => {
    test('should serialize all settings to JSON', () => {
      settings.setColor('boardGrid', '#FF0000');
      settings.setOpacity('pieces', 0.8);
      const theme = settings.createCustomTheme('Test', 'Test theme');
      
      const json = settings.toJSON();
      
      expect(json.colors.boardGrid).toBe('#FF0000');
      expect(json.opacity.pieces).toBe(0.8);
      expect(json.customThemes).toHaveLength(1);
      expect(json.customThemes[0].name).toBe('Test');
    });

    test('should deserialize from JSON', () => {
      const data = {
        gridDiagonals: true,
        playerColors: { player1: '#111111', player2: '#EEEEEE' },
        soundEnabled: false,
        animationSpeed: 2.0,
        colors: { boardGrid: '#FF0000' } as any,
        opacity: { pieces: 0.7 } as any,
        activeTheme: 'ocean',
        customThemes: [{
          id: 'custom_123',
          name: 'Loaded Theme',
          description: 'From storage',
          colors: Settings.PRESET_THEMES[0].colors,
          opacity: Settings.PRESET_THEMES[0].opacity,
          isCustom: true
        }]
      };
      
      const loaded = Settings.fromJSON(data);
      
      expect(loaded.getColor('boardGrid')).toBe('#FF0000');
      expect(loaded.getOpacity('pieces')).toBe(0.7);
      expect(loaded.getActiveTheme()?.id).toBe('ocean');
      expect(loaded.getCustomThemes()).toHaveLength(1);
      expect(loaded.getCustomThemes()[0].name).toBe('Loaded Theme');
    });

    test('should maintain equality after serialization round-trip', () => {
      settings.setColor('boardGrid', '#FF0000');
      const theme = settings.createCustomTheme('Test', 'Test');
      
      const json = settings.toJSON();
      const loaded = Settings.fromJSON(json);
      
      expect(loaded.equals(settings)).toBe(true);
    });

    test('should update player colors when piece colors change', () => {
      settings.setColor('blackPieces', '#123456');
      expect(settings.getPlayerColor(1)).toBe('#123456');
      
      settings.setColor('whitePieces', '#FEDCBA');
      expect(settings.getPlayerColor(2)).toBe('#FEDCBA');
    });
  });
});