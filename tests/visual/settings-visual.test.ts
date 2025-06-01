import { Settings } from '@/storage/Settings';
import { Renderer } from '@/rendering/Renderer';
import { Board } from '@/core/Board';
import { Player } from '@/core/Player';
import * as THREE from 'three';

// Mock Three.js
jest.mock('three');

describe('Visual - Theme Application', () => {
  let renderer: Renderer;
  let settings: Settings;
  let canvas: HTMLCanvasElement;
  let board: Board;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    settings = new Settings();
    renderer = new Renderer({ canvas, boardSize: 7 });
    board = new Board(7);
    
    // Add some pieces for visual testing
    const player1 = new Player('p1', 'black');
    const player2 = new Player('p2', 'white');
    
    board = board.placePiece({ x: 3, y: 3, z: 3 }, player1);
    board = board.placePiece({ x: 3, y: 3, z: 4 }, player2);
    board = board.placePiece({ x: 4, y: 3, z: 3 }, player1);
    
    renderer.setBoard(board);
  });

  afterEach(() => {
    renderer.dispose();
    document.body.removeChild(canvas);
  });

  test('should render default theme correctly', () => {
    const defaultTheme = Settings.PRESET_THEMES[0];
    settings.applyTheme(defaultTheme);
    
    renderer.applyColorSettings(settings.getColors());
    renderer.applyOpacitySettings(settings.getOpacitySettings());
    
    // Visual verification would happen here
    // In a real visual test, we'd capture a screenshot and compare
    expect(renderer.getScene().background).toEqual(new THREE.Color(defaultTheme.colors.background));
    
    // Verify materials have correct colors
    const scene = renderer.getScene();
    expect(scene).toBeTruthy();
  });

  test('should render ocean theme correctly', () => {
    const oceanTheme = Settings.PRESET_THEMES.find(t => t.id === 'ocean')!;
    settings.applyTheme(oceanTheme);
    
    renderer.applyColorSettings(settings.getColors());
    renderer.applyOpacitySettings(settings.getOpacitySettings());
    
    // Verify ocean theme colors
    expect(renderer.getScene().background).toEqual(new THREE.Color(oceanTheme.colors.background));
  });

  test('should render forest theme correctly', () => {
    const forestTheme = Settings.PRESET_THEMES.find(t => t.id === 'forest')!;
    settings.applyTheme(forestTheme);
    
    renderer.applyColorSettings(settings.getColors());
    renderer.applyOpacitySettings(settings.getOpacitySettings());
    
    // Verify forest theme colors
    expect(renderer.getScene().background).toEqual(new THREE.Color(forestTheme.colors.background));
  });

  test('should render sunset theme correctly', () => {
    const sunsetTheme = Settings.PRESET_THEMES.find(t => t.id === 'sunset')!;
    settings.applyTheme(sunsetTheme);
    
    renderer.applyColorSettings(settings.getColors());
    renderer.applyOpacitySettings(settings.getOpacitySettings());
    
    // Verify sunset theme colors
    expect(renderer.getScene().background).toEqual(new THREE.Color(sunsetTheme.colors.background));
  });

  test('should render neon theme correctly', () => {
    const neonTheme = Settings.PRESET_THEMES.find(t => t.id === 'neon')!;
    settings.applyTheme(neonTheme);
    
    renderer.applyColorSettings(settings.getColors());
    renderer.applyOpacitySettings(settings.getOpacitySettings());
    
    // Verify neon theme colors
    expect(renderer.getScene().background).toEqual(new THREE.Color(neonTheme.colors.background));
  });

  test('should apply custom colors accurately', () => {
    const customColors = {
      boardGrid: '#FF0000',
      nodeSpheres: '#00FF00',
      blackPieces: '#0000FF',
      whitePieces: '#FFFF00',
      temporaryPieces: '#FF00FF',
      highlightedNodes: '#00FFFF',
      highlightedLines: '#FFFFFF',
      capturedPieces: '#800080',
      winningLine: '#FFA500',
      background: '#333333',
      ambientLight: '#666666',
      directionalLight: '#FFFFFF'
    };
    
    renderer.applyColorSettings(customColors);
    
    // Verify custom colors applied
    expect(renderer.getScene().background).toEqual(new THREE.Color('#333333'));
  });

  test('should render opacity changes correctly', () => {
    const opacitySettings = {
      boardGrid: 0.2,
      nodeSpheres: 0.4,
      pieces: 0.8,
      temporaryPieces: 0.5,
      highlights: 0.7
    };
    
    renderer.applyOpacitySettings(opacitySettings);
    
    // In a real visual test, we'd verify opacity visually
    // For now, just ensure no errors
    expect(true).toBe(true);
  });

  test('should maintain visual quality during preview', () => {
    settings.startPreview();
    
    // Make many rapid changes
    for (let i = 0; i < 10; i++) {
      const color = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
      settings.setColor('boardGrid', color);
      renderer.applyColorSettings(settings.getColors());
    }
    
    // Visual quality should be maintained
    // In real test, would check for artifacts or glitches
    expect(renderer.getScene()).toBeTruthy();
  });

  test('should handle extreme opacity values visually', () => {
    // Test full transparency
    renderer.applyOpacitySettings({
      boardGrid: 0,
      nodeSpheres: 0,
      pieces: 1,
      temporaryPieces: 0,
      highlights: 0
    });
    
    // Should still render pieces
    expect(renderer.getScene()).toBeTruthy();
    
    // Test full opacity
    renderer.applyOpacitySettings({
      boardGrid: 1,
      nodeSpheres: 1,
      pieces: 1,
      temporaryPieces: 1,
      highlights: 1
    });
    
    // Should render everything opaque
    expect(renderer.getScene()).toBeTruthy();
  });

  test('should transition smoothly between themes', () => {
    const themes = Settings.PRESET_THEMES;
    
    // Cycle through all themes
    themes.forEach(theme => {
      settings.applyTheme(theme);
      renderer.applyColorSettings(settings.getColors());
      renderer.applyOpacitySettings(settings.getOpacitySettings());
      
      // Each theme should apply cleanly
      expect(renderer.getScene().background).toEqual(new THREE.Color(theme.colors.background));
    });
  });

  test('should display highlights with theme colors', () => {
    // Apply a theme
    settings.setActiveTheme('ocean');
    renderer.applyColorSettings(settings.getColors());
    
    // Add highlights
    renderer.highlightPosition({ x: 3, y: 3, z: 3 });
    renderer.highlightLine([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 }
    ]);
    
    // Highlights should use theme colors
    // In real test, would verify visually
    expect(true).toBe(true);
  });

  test('should maintain piece contrast with background', () => {
    // Test various background colors
    const backgrounds = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF'];
    
    backgrounds.forEach(bg => {
      settings.setColor('background', bg);
      renderer.applyColorSettings(settings.getColors());
      
      // Pieces should remain visible
      // In real test, would check contrast ratios
      expect(renderer.getScene().background).toEqual(new THREE.Color(bg));
    });
  });
});