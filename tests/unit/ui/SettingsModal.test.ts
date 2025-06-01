import { SettingsModal, SettingsModalOptions } from '../../../src/ui/SettingsModal';
import { Settings } from '../../../src/storage/Settings';
import { Renderer } from '../../../src/rendering/Renderer';

jest.mock('../../../src/rendering/Renderer');

describe('SettingsModal', () => {
  let settingsModal: SettingsModal;
  let settings: Settings;
  let renderer: Renderer;
  let options: SettingsModalOptions;
  let onSettingsChange: jest.Mock;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Create settings instance
    settings = new Settings();
    
    // Mock renderer
    renderer = new Renderer({
      canvas: document.createElement('canvas'),
      boardSize: 7
    });
    
    // Create callback
    onSettingsChange = jest.fn();
    
    // Create options
    options = {
      settings,
      renderer,
      onSettingsChange
    };
    
    settingsModal = new SettingsModal(options);
  });

  afterEach(() => {
    settingsModal.destroy();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create settings modal with correct title', () => {
      expect(settingsModal).toBeDefined();
      expect((settingsModal as any).options.title).toBe('Settings');
    });

    it('should store settings and renderer references', () => {
      expect((settingsModal as any).settings).toBe(settings);
      expect((settingsModal as any).renderer).toBe(renderer);
    });

    it('should create temporary settings copy', () => {
      expect((settingsModal as any).tempSettings).toEqual(settings);
      expect((settingsModal as any).tempSettings).not.toBe(settings);
    });
  });

  describe('render', () => {
    beforeEach(() => {
      settingsModal.open();
    });

    it('should render all setting sections', () => {
      const sections = document.querySelectorAll('.settings-section');
      expect(sections).toHaveLength(3);
      
      const sectionTitles = Array.from(sections).map(s => s.querySelector('h3')?.textContent);
      expect(sectionTitles).toContain('Colors');
      expect(sectionTitles).toContain('Size & Opacity');
      expect(sectionTitles).toContain('Display Options');
    });

    it('should render color controls', () => {
      const colorInputs = document.querySelectorAll('input[type="color"]');
      expect(colorInputs.length).toBeGreaterThan(0);
      
      const labels = Array.from(document.querySelectorAll('.setting-control label'))
        .map(l => l.textContent);
      
      expect(labels).toContain('Grid Color');
      expect(labels).toContain('Node Color');
      expect(labels).toContain('Black Piece Color');
      expect(labels).toContain('White Piece Color');
      expect(labels).toContain('Highlight Color');
      expect(labels).toContain('Line Highlight Color');
      expect(labels).toContain('Temporary Piece Color');
    });

    it('should render number controls with sliders', () => {
      const sliders = document.querySelectorAll('input[type="range"]');
      expect(sliders.length).toBeGreaterThan(0);
      
      const labels = Array.from(document.querySelectorAll('.setting-control label'))
        .map(l => l.textContent);
      
      expect(labels).toContain('Grid Opacity');
      expect(labels).toContain('Node Size');
      expect(labels).toContain('Piece Size');
      expect(labels).toContain('Highlight Intensity');
      expect(labels).toContain('Animation Speed');
    });

    it('should render boolean controls with toggles', () => {
      const toggles = document.querySelectorAll('.toggle-switch');
      expect(toggles.length).toBeGreaterThan(0);
      
      const labels = Array.from(document.querySelectorAll('.setting-control label'))
        .map(l => l.textContent);
      
      expect(labels).toContain('Show Grid');
      expect(labels).toContain('Show Nodes');
      expect(labels).toContain('Enable Animations');
      expect(labels).toContain('Show Coordinates');
      expect(labels).toContain('Enable Sound');
      expect(labels).toContain('Auto-rotate Board');
    });

    it('should render footer buttons', () => {
      const buttons = Array.from(document.querySelectorAll('.modal-footer button'));
      const buttonTexts = buttons.map(b => b.textContent);
      
      expect(buttonTexts).toContain('Reset to Defaults');
      expect(buttonTexts).toContain('Cancel');
      expect(buttonTexts).toContain('Apply');
    });
  });

  describe('color controls', () => {
    beforeEach(() => {
      settingsModal.open();
    });

    it('should update color value on color input change', () => {
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      const hexInput = colorInput.nextElementSibling as HTMLInputElement;
      
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      expect(hexInput.value).toBe('#ff0000');
      expect((settingsModal as any).tempSettings.gridColor).toBe('#ff0000');
    });

    it('should update color input on hex input change', () => {
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      const hexInput = colorInput.nextElementSibling as HTMLInputElement;
      
      hexInput.value = '#00ff00';
      const event = new Event('input', { bubbles: true });
      hexInput.dispatchEvent(event);
      
      expect(colorInput.value).toBe('#00ff00');
      expect((settingsModal as any).tempSettings.gridColor).toBe('#00ff00');
    });

    it('should only accept valid hex colors in text input', () => {
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      const hexInput = colorInput.nextElementSibling as HTMLInputElement;
      const initialValue = colorInput.value;
      
      hexInput.value = 'invalid';
      const event = new Event('input', { bubbles: true });
      hexInput.dispatchEvent(event);
      
      expect(colorInput.value).toBe(initialValue);
    });
  });

  describe('number controls', () => {
    beforeEach(() => {
      settingsModal.open();
    });

    it('should update value display on slider change', () => {
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
      const valueDisplay = slider.nextElementSibling as HTMLSpanElement;
      
      slider.value = '0.5';
      const event = new Event('input', { bubbles: true });
      slider.dispatchEvent(event);
      
      expect(valueDisplay.textContent).toBe('0.5');
    });

    it('should update temp settings on slider change', () => {
      const sliders = document.querySelectorAll('input[type="range"]') as NodeListOf<HTMLInputElement>;
      const gridOpacitySlider = Array.from(sliders).find(s => s.min === '0' && s.max === '1');
      
      if (gridOpacitySlider) {
        gridOpacitySlider.value = '0.7';
        const event = new Event('input', { bubbles: true });
        gridOpacitySlider.dispatchEvent(event);
        
        expect((settingsModal as any).tempSettings.gridOpacity).toBe(0.7);
      }
    });

    it('should respect min/max bounds', () => {
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
      
      expect(parseFloat(slider.min)).toBeLessThanOrEqual(parseFloat(slider.value));
      expect(parseFloat(slider.max)).toBeGreaterThanOrEqual(parseFloat(slider.value));
    });
  });

  describe('boolean controls', () => {
    beforeEach(() => {
      settingsModal.open();
    });

    it('should toggle checkbox state', () => {
      const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const initialState = checkbox.checked;
      
      checkbox.click();
      
      expect(checkbox.checked).toBe(!initialState);
    });

    it('should update toggle visual state', () => {
      const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
      const slider = checkbox.nextElementSibling as HTMLSpanElement;
      const knob = slider.firstElementChild as HTMLSpanElement;
      
      checkbox.checked = false;
      const event = new Event('change', { bubbles: true });
      checkbox.dispatchEvent(event);
      
      expect(slider.style.backgroundColor).toBe('rgb(204, 204, 204)');
      expect(knob.style.left).toBe('4px');
      
      checkbox.checked = true;
      checkbox.dispatchEvent(event);
      
      expect(slider.style.backgroundColor).toBe('rgb(76, 175, 80)');
      expect(knob.style.left).toBe('30px');
    });

    it('should update temp settings on toggle', () => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      const showGridCheckbox = checkboxes[0]; // First boolean setting is showGrid
      
      showGridCheckbox.checked = false;
      const event = new Event('change', { bubbles: true });
      showGridCheckbox.dispatchEvent(event);
      
      expect((settingsModal as any).tempSettings.showGrid).toBe(false);
    });
  });

  describe('footer buttons', () => {
    beforeEach(() => {
      settingsModal.open();
    });

    it('should reset to defaults', () => {
      // Change a setting
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      // Click reset button
      const resetBtn = Array.from(document.querySelectorAll('.modal-footer button'))
        .find(btn => btn.textContent === 'Reset to Defaults') as HTMLButtonElement;
      
      resetBtn.click();
      
      // Settings should be reset
      expect((settingsModal as any).tempSettings).toEqual(new Settings());
    });

    it('should cancel without applying changes', () => {
      // Change a setting
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      const originalValue = settings.gridColor;
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      // Click cancel button
      const cancelBtn = Array.from(document.querySelectorAll('.modal-footer button'))
        .find(btn => btn.textContent === 'Cancel') as HTMLButtonElement;
      
      cancelBtn.click();
      
      // Original settings should be unchanged
      expect(settings.gridColor).toBe(originalValue);
      expect((settingsModal as any).isOpen).toBe(false);
    });

    it('should apply changes and call callback', () => {
      // Change a setting
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      // Click apply button
      const applyBtn = Array.from(document.querySelectorAll('.modal-footer button'))
        .find(btn => btn.textContent === 'Apply') as HTMLButtonElement;
      
      applyBtn.click();
      
      // Settings should be updated
      expect(settings.gridColor).toBe('#ff0000');
      expect(onSettingsChange).toHaveBeenCalledWith(settings);
      expect((settingsModal as any).isOpen).toBe(false);
    });
  });

  describe('preview system', () => {
    beforeEach(() => {
      settingsModal.open();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should schedule preview on setting change', () => {
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      expect((settingsModal as any).previewTimeout).toBeDefined();
    });

    it('should debounce multiple changes', () => {
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      
      // Make multiple rapid changes
      for (let i = 0; i < 5; i++) {
        colorInput.value = `#ff000${i}`;
        const event = new Event('input', { bubbles: true });
        colorInput.dispatchEvent(event);
      }
      
      // Should only have one timeout scheduled
      jest.advanceTimersByTime(100);
      
      // Preview should be applied with final value
      expect((settingsModal as any).tempSettings.gridColor).toBe('#ff0004');
    });
  });

  describe('hover effects', () => {
    beforeEach(() => {
      settingsModal.open();
    });

    it('should apply hover effect to buttons', () => {
      const button = document.querySelector('.modal-footer button') as HTMLButtonElement;
      
      // Simulate mouseenter
      const mouseenterEvent = new MouseEvent('mouseenter', { bubbles: true });
      button.dispatchEvent(mouseenterEvent);
      
      expect(button.style.opacity).toBe('0.8');
      
      // Simulate mouseleave
      const mouseleaveEvent = new MouseEvent('mouseleave', { bubbles: true });
      button.dispatchEvent(mouseleaveEvent);
      
      expect(button.style.opacity).toBe('1');
    });
  });

  describe('destroy', () => {
    it('should clear preview timeout on destroy', () => {
      settingsModal.open();
      
      // Set a preview timeout
      const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
      colorInput.value = '#ff0000';
      const event = new Event('input', { bubbles: true });
      colorInput.dispatchEvent(event);
      
      const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
      
      settingsModal.destroy();
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});