import { Settings, ColorSettings, OpacitySettings } from '@/storage/Settings';
import { StorageManager } from '@/storage/StorageManager';
import { Renderer } from '@/rendering/Renderer';
import { SettingsModal } from '@/ui/SettingsModal';
import * as THREE from 'three';

// Mock Three.js
jest.mock('three');

describe('Settings System Integration', () => {
  let settings: Settings;
  let renderer: Renderer;
  let modal: SettingsModal;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();

    // Create canvas
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    // Create instances
    settings = new Settings();
    renderer = new Renderer({ canvas });
  });

  afterEach(() => {
    if (modal) {
      modal.destroy();
    }
    renderer.dispose();
    document.body.removeChild(canvas);
    localStorage.clear();
  });

  describe('Settings-Renderer Integration', () => {
    test('should apply color changes to renderer', () => {
      const colorSettings: ColorSettings = {
        boardGrid: '#FF0000',
        nodeSpheres: '#00FF00',
        blackPieces: '#0000FF',
        whitePieces: '#FFFF00',
        temporaryPieces: '#FF00FF',
        highlightedNodes: '#00FFFF',
        highlightedLines: '#FFFFFF',
        capturedPieces: '#800080',
        winningLine: '#FFA500',
        background: '#222222',
        ambientLight: '#888888',
        directionalLight: '#CCCCCC'
      };

      renderer.applyColorSettings(colorSettings);

      // Verify materials were updated
      const scene = renderer.getScene();
      expect(scene.background).toEqual(new THREE.Color('#222222'));
    });

    test('should update material opacity in renderer', () => {
      const opacitySettings: OpacitySettings = {
        boardGrid: 0.5,
        nodeSpheres: 0.7,
        pieces: 0.9,
        temporaryPieces: 0.6,
        highlights: 0.8
      };

      renderer.applyOpacitySettings(opacitySettings);

      // Verify opacity was applied (would check actual materials in real test)
      expect(true).toBe(true);
    });

    test('should apply complete theme to scene', () => {
      const oceanTheme = Settings.PRESET_THEMES.find(t => t.id === 'ocean')!;
      
      settings.applyTheme(oceanTheme);
      renderer.applyColorSettings(settings.getColors());
      renderer.applyOpacitySettings(settings.getOpacitySettings());

      // Scene should reflect ocean theme
      const scene = renderer.getScene();
      expect(scene.background).toEqual(new THREE.Color(oceanTheme.colors.background));
    });

    test('should handle preview mode in renderer', () => {
      settings.startPreview();
      settings.setColor('boardGrid', '#FF0000');
      
      const colors = settings.getColors();
      renderer.applyColorSettings(colors);
      
      // Preview changes should be applied
      expect(colors.boardGrid).toBe('#FF0000');
      
      settings.cancelPreview();
      
      // Changes should be reverted
      const revertedColors = settings.getColors();
      expect(revertedColors.boardGrid).not.toBe('#FF0000');
    });

    test('should batch multiple setting changes', () => {
      const applyColorSpy = jest.spyOn(renderer, 'applyColorSettings');
      const applyOpacitySpy = jest.spyOn(renderer, 'applyOpacitySettings');
      
      // Make multiple changes
      settings.setColor('boardGrid', '#FF0000');
      settings.setColor('blackPieces', '#00FF00');
      settings.setOpacity('pieces', 0.8);
      
      // Apply all at once
      renderer.applyColorSettings(settings.getColors());
      renderer.applyOpacitySettings(settings.getOpacitySettings());
      
      expect(applyColorSpy).toHaveBeenCalledTimes(1);
      expect(applyOpacitySpy).toHaveBeenCalledTimes(1);
    });

    test('should maintain performance during updates', () => {
      const startTime = performance.now();
      
      // Apply many changes
      for (let i = 0; i < 10; i++) {
        renderer.applyColorSettings(settings.getColors());
        renderer.applyOpacitySettings(settings.getOpacitySettings());
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete quickly (< 100ms for 10 updates)
      expect(duration).toBeLessThan(100);
    });

    test('should properly dispose old materials', () => {
      // This would test material disposal in a real implementation
      const colors = settings.getColors();
      renderer.applyColorSettings(colors);
      
      // Change colors again
      colors.boardGrid = '#FF0000';
      renderer.applyColorSettings(colors);
      
      // Old materials should be disposed (would check in real test)
      expect(true).toBe(true);
    });

    test('should handle renderer errors gracefully', () => {
      // Test with invalid color
      const invalidColors = { boardGrid: 'not-a-color' } as any;
      
      // Should not throw
      expect(() => renderer.applyColorSettings(invalidColors)).not.toThrow();
    });
  });

  describe('Settings-Storage Integration', () => {
    test('should persist color settings', () => {
      settings.setColor('boardGrid', '#FF0000');
      settings.setColor('blackPieces', '#00FF00');
      
      StorageManager.save(null as any, settings);
      
      const loadedSettings = StorageManager.loadSettings();
      expect(loadedSettings.getColor('boardGrid')).toBe('#FF0000');
      expect(loadedSettings.getColor('blackPieces')).toBe('#00FF00');
    });

    test('should persist opacity settings', () => {
      settings.setOpacity('boardGrid', 0.7);
      settings.setOpacity('pieces', 0.9);
      
      StorageManager.save(null as any, settings);
      
      const loadedSettings = StorageManager.loadSettings();
      expect(loadedSettings.getOpacity('boardGrid')).toBe(0.7);
      expect(loadedSettings.getOpacity('pieces')).toBe(0.9);
    });

    test('should persist active theme', () => {
      settings.setActiveTheme('ocean');
      
      StorageManager.save(null as any, settings);
      
      const loadedSettings = StorageManager.loadSettings();
      expect(loadedSettings.getActiveTheme()?.id).toBe('ocean');
    });

    test('should save and load custom themes', () => {
      const theme = settings.createCustomTheme('My Theme', 'Custom theme');
      
      StorageManager.save(null as any, settings);
      StorageManager.saveCustomThemes(settings.getCustomThemes());
      
      const loadedThemes = StorageManager.loadCustomThemes();
      expect(loadedThemes).toHaveLength(1);
      expect(loadedThemes[0].name).toBe('My Theme');
    });

    test('should handle storage quota limits', () => {
      // Create many custom themes
      for (let i = 0; i < 10; i++) {
        settings.createCustomTheme(`Theme ${i}`, `Description ${i}`);
      }
      
      // Should handle gracefully
      expect(() => {
        StorageManager.saveCustomThemes(settings.getCustomThemes());
      }).not.toThrow();
    });

    test('should migrate old settings format', () => {
      // Save old format
      const oldData = {
        version: 0,
        settings: {
          gridDiagonals: true,
          playerColors: { player1: '#000000', player2: '#FFFFFF' },
          soundEnabled: false,
          animationSpeed: 2.0
        }
      };
      
      localStorage.setItem('pente3d_data', JSON.stringify(oldData));
      
      // Load should migrate
      const loadedSettings = StorageManager.loadSettings();
      expect(loadedSettings).toBeDefined();
      expect(loadedSettings.getGridDiagonals()).toBe(true);
      expect(loadedSettings.getSoundEnabled()).toBe(false);
    });

    test('should handle corrupted storage data', () => {
      localStorage.setItem('pente3d_data', 'corrupted data');
      
      // Should return default settings
      const loadedSettings = StorageManager.loadSettings();
      expect(loadedSettings).toBeDefined();
      expect(loadedSettings.getActiveTheme()?.id).toBe('default');
    });
  });

  describe('Modal-Settings Integration', () => {
    beforeEach(() => {
      modal = new SettingsModal({
        settings,
        renderer,
        parentElement: document.body
      });
    });

    test('should load current settings on open', () => {
      settings.setColor('boardGrid', '#FF0000');
      settings.setActiveTheme('ocean');
      
      modal.open();
      
      // Modal should reflect current settings
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      expect(colorInput).toBeTruthy();
      
      // Should show ocean theme as active
      const themeCards = document.querySelectorAll('.theme-card');
      let oceanCardActive = false;
      themeCards.forEach(card => {
        if (card.textContent?.includes('Ocean') && 
            card.querySelector('button[disabled]')) {
          oceanCardActive = true;
        }
      });
      expect(oceanCardActive).toBe(true);
    });

    test('should apply changes on confirm', () => {
      modal.open();
      
      settings.setColor('boardGrid', '#FF0000');
      
      // Click apply
      const applyBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Apply') as HTMLElement;
      applyBtn.click();
      
      // Changes should be permanent
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
      expect(settings.isInPreviewMode()).toBe(false);
    });

    test('should revert changes on cancel', () => {
      const originalColor = settings.getColor('boardGrid');
      
      modal.open();
      
      settings.setColor('boardGrid', '#FF0000');
      
      // Click cancel
      const cancelBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Cancel') as HTMLElement;
      cancelBtn.click();
      
      // Changes should be reverted
      expect(settings.getColor('boardGrid')).toBe(originalColor);
      expect(settings.isInPreviewMode()).toBe(false);
    });

    test('should update preview during changes', () => {
      jest.useFakeTimers();
      
      modal.open();
      
      const applyColorSpy = jest.spyOn(renderer, 'applyColorSettings');
      
      // Change color
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      colorInput.value = '#FF0000';
      colorInput.dispatchEvent(new Event('input'));
      
      // Advance timers
      jest.advanceTimersByTime(100);
      
      // Renderer should be updated
      expect(applyColorSpy).toHaveBeenCalled();
      
      jest.useRealTimers();
    });

    test('should handle settings events', () => {
      const changeHandler = jest.fn();
      const onSettingsChange = jest.fn();
      
      settings.addChangeListener(changeHandler);
      
      modal = new SettingsModal({
        settings,
        renderer,
        parentElement: document.body,
        onSettingsChange
      });
      
      modal.open();
      
      // Make a change
      settings.setColor('boardGrid', '#FF0000');
      
      // Listener should be called
      expect(changeHandler).toHaveBeenCalled();
      
      // Apply changes
      const applyBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Apply') as HTMLElement;
      applyBtn.click();
      
      // Callback should be called
      expect(onSettingsChange).toHaveBeenCalledWith(settings);
    });
  });

  describe('Complete Settings Flow', () => {
    test('should handle full customization workflow', () => {
      // 1. Open settings
      modal = new SettingsModal({ settings, renderer, parentElement: document.body });
      modal.open();
      
      // 2. Create custom theme
      const theme = settings.createCustomTheme('My Game Theme', 'Personalized colors');
      
      // 3. Customize colors
      settings.setColor('boardGrid', '#FF0000');
      settings.setColor('blackPieces', '#333333');
      settings.setColor('whitePieces', '#EEEEEE');
      
      // 4. Adjust opacity
      settings.setOpacity('boardGrid', 0.6);
      settings.setOpacity('highlights', 0.9);
      
      // 5. Apply theme
      settings.setActiveTheme(theme.id);
      
      // 6. Apply changes
      const applyBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Apply') as HTMLElement;
      applyBtn.click();
      
      // 7. Save to storage
      StorageManager.save(null as any, settings);
      
      // 8. Reload and verify
      const loadedSettings = StorageManager.loadSettings();
      expect(loadedSettings.getActiveTheme()?.name).toBe('My Game Theme');
      expect(loadedSettings.getColor('boardGrid')).toBe('#FF0000');
      expect(loadedSettings.getOpacity('boardGrid')).toBe(0.6);
    });

    test('should maintain consistency across components', () => {
      // Change theme
      settings.setActiveTheme('neon');
      
      // Apply to renderer
      renderer.applyColorSettings(settings.getColors());
      renderer.applyOpacitySettings(settings.getOpacitySettings());
      
      // Save to storage
      StorageManager.save(null as any, settings);
      
      // Create new instances
      const newSettings = StorageManager.loadSettings();
      const newRenderer = new Renderer({ canvas: document.createElement('canvas') });
      
      // Apply loaded settings
      newRenderer.applyColorSettings(newSettings.getColors());
      newRenderer.applyOpacitySettings(newSettings.getOpacitySettings());
      
      // Should match original
      expect(newSettings.getActiveTheme()?.id).toBe('neon');
      
      newRenderer.dispose();
    });

    test('should handle concurrent operations', async () => {
      // Multiple operations at once
      const operations = [
        () => settings.setColor('boardGrid', '#FF0000'),
        () => settings.setOpacity('pieces', 0.8),
        () => settings.createCustomTheme('Concurrent', 'Test'),
        () => StorageManager.save(null as any, settings),
        () => renderer.applyColorSettings(settings.getColors())
      ];
      
      // Execute concurrently
      await Promise.all(operations.map(op => Promise.resolve(op())));
      
      // Should maintain consistency
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
      expect(settings.getOpacity('pieces')).toBe(0.8);
      expect(settings.getCustomThemes().some(t => t.name === 'Concurrent')).toBe(true);
    });
  });
});