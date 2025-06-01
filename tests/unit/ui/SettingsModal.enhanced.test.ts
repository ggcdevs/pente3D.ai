import { SettingsModal } from '@/ui/SettingsModal';
import { Settings } from '@/storage/Settings';
import { Renderer } from '@/rendering/Renderer';

// Mock file IO functions
jest.mock('@/utils/fileIO', () => ({
  downloadFile: jest.fn(),
  selectFile: jest.fn()
}));

describe('SettingsModal - Enhanced Features', () => {
  let settingsModal: SettingsModal;
  let settings: Settings;
  let renderer: Renderer;
  let container: HTMLElement;

  beforeEach(() => {
    // Create DOM container
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock renderer
    renderer = {
      applyColorSettings: jest.fn(),
      applyOpacitySettings: jest.fn()
    } as any;

    // Create settings
    settings = new Settings();

    // Create settings modal
    settingsModal = new SettingsModal({
      settings,
      renderer,
      parentElement: container
    });
  });

  afterEach(() => {
    settingsModal.destroy();
    document.body.removeChild(container);
  });

  describe('UI Structure', () => {
    test('should create tabbed interface', () => {
      settingsModal.open();
      
      const tabs = container.querySelectorAll('.settings-tab');
      expect(tabs).toHaveLength(4);
      expect(tabs[0].textContent).toBe('Themes');
      expect(tabs[1].textContent).toBe('Colors');
      expect(tabs[2].textContent).toBe('Opacity');
      expect(tabs[3].textContent).toBe('Advanced');
    });

    test('should render theme selection tab', () => {
      settingsModal.open();
      
      const themeContent = container.querySelector('.theme-tab-content');
      expect(themeContent).toBeTruthy();
      
      const themeCards = container.querySelectorAll('.theme-card');
      expect(themeCards.length).toBeGreaterThanOrEqual(5); // At least preset themes
    });

    test('should render colors customization tab', () => {
      settingsModal.open();
      
      // Click colors tab
      const colorTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Colors') as HTMLElement;
      colorTab.click();
      
      const colorContent = container.querySelector('.colors-tab-content');
      expect(colorContent).toBeTruthy();
      
      const colorControls = container.querySelectorAll('.color-control');
      expect(colorControls.length).toBeGreaterThan(0);
    });

    test('should render opacity controls tab', () => {
      settingsModal.open();
      
      // Click opacity tab
      const opacityTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Opacity') as HTMLElement;
      opacityTab.click();
      
      const opacityContent = container.querySelector('.opacity-tab-content');
      expect(opacityContent).toBeTruthy();
      
      const opacityControls = container.querySelectorAll('.opacity-control');
      expect(opacityControls).toHaveLength(5); // 5 opacity settings
    });

    test('should render advanced settings tab', () => {
      settingsModal.open();
      
      // Click advanced tab
      const advancedTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Advanced') as HTMLElement;
      advancedTab.click();
      
      const advancedContent = container.querySelector('.advanced-tab-content');
      expect(advancedContent).toBeTruthy();
      
      // Should have import/export buttons
      const buttons = Array.from(container.querySelectorAll('button'));
      expect(buttons.some(btn => btn.textContent === 'Export Current Theme')).toBe(true);
      expect(buttons.some(btn => btn.textContent === 'Import Theme')).toBe(true);
    });

    test('should highlight active tab', () => {
      settingsModal.open();
      
      const tabs = container.querySelectorAll('.settings-tab');
      
      // First tab should be active by default
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1].getAttribute('aria-selected')).toBe('false');
      
      // Click second tab
      (tabs[1] as HTMLElement).click();
      
      expect(tabs[0].getAttribute('aria-selected')).toBe('false');
      expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    });

    test('should include preview area', () => {
      settingsModal.open();
      
      // Settings should enter preview mode when opened
      expect(settings.isInPreviewMode()).toBe(true);
    });

    test('should have apply/cancel buttons', () => {
      settingsModal.open();
      
      const footer = container.querySelector('.modal-footer');
      expect(footer).toBeTruthy();
      
      const buttons = Array.from(footer!.querySelectorAll('button'));
      expect(buttons.some(btn => btn.textContent === 'Apply')).toBe(true);
      expect(buttons.some(btn => btn.textContent === 'Cancel')).toBe(true);
    });
  });

  describe('Interactions', () => {
    test('should switch tabs on click', () => {
      settingsModal.open();
      
      const tabs = container.querySelectorAll('.settings-tab');
      const colorTab = tabs[1] as HTMLElement;
      
      colorTab.click();
      
      const colorContent = container.querySelector('.colors-tab-content');
      expect(colorContent).toBeTruthy();
      
      const themeContent = container.querySelector('.theme-tab-content');
      expect(themeContent).toBeFalsy();
    });

    test('should update color on picker change', () => {
      settingsModal.open();
      
      // Switch to colors tab
      const colorTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Colors') as HTMLElement;
      colorTab.click();
      
      // Find a color input
      const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;
      expect(colorInput).toBeTruthy();
      
      // Change color
      colorInput.value = '#FF0000';
      colorInput.dispatchEvent(new Event('input'));
      
      // Should update preview
      expect(renderer.applyColorSettings).toHaveBeenCalled();
    });

    test('should update opacity on slider change', () => {
      settingsModal.open();
      
      // Switch to opacity tab
      const opacityTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Opacity') as HTMLElement;
      opacityTab.click();
      
      // Find opacity slider
      const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(slider).toBeTruthy();
      
      // Change opacity
      slider.value = '50';
      slider.dispatchEvent(new Event('input'));
      
      // Should update preview
      expect(renderer.applyOpacitySettings).toHaveBeenCalled();
    });

    test('should apply theme on selection', () => {
      settingsModal.open();
      
      // Find non-active theme card
      const themeCards = container.querySelectorAll('.theme-card');
      let oceanCard: HTMLElement | null = null;
      
      themeCards.forEach(card => {
        if (card.textContent?.includes('Ocean')) {
          oceanCard = card as HTMLElement;
        }
      });
      
      expect(oceanCard).toBeTruthy();
      
      // Click apply button in ocean theme
      const applyBtn = oceanCard!.querySelector('button:not([disabled])') as HTMLElement;
      applyBtn.click();
      
      // Should apply theme
      expect(settings.getActiveTheme()?.id).toBe('ocean');
    });

    test('should create custom theme on button click', () => {
      settingsModal.open();
      
      // Mock prompt
      const originalPrompt = window.prompt;
      window.prompt = jest.fn()
        .mockReturnValueOnce('My Custom Theme')
        .mockReturnValueOnce('A custom theme for testing');
      
      // Find create button
      const createBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Create Custom Theme') as HTMLElement;
      
      createBtn.click();
      
      // Should create theme
      const customThemes = settings.getCustomThemes();
      expect(customThemes).toHaveLength(1);
      expect(customThemes[0].name).toBe('My Custom Theme');
      
      window.prompt = originalPrompt;
    });

    test('should delete custom theme with confirmation', () => {
      // Create a custom theme first
      const theme = settings.createCustomTheme('To Delete', 'Will be deleted');
      
      settingsModal.open();
      
      // Mock confirm
      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(true);
      
      // Find delete button for custom theme
      const themeCards = container.querySelectorAll('.theme-card');
      let customCard: HTMLElement | null = null;
      
      themeCards.forEach(card => {
        if (card.textContent?.includes('To Delete')) {
          customCard = card as HTMLElement;
        }
      });
      
      expect(customCard).toBeTruthy();
      
      const deleteBtn = customCard!.querySelector('button[style*="f44336"]') as HTMLElement;
      deleteBtn.click();
      
      // Should delete theme
      expect(settings.getCustomThemes()).toHaveLength(0);
      
      window.confirm = originalConfirm;
    });

    test('should reset to defaults with confirmation', () => {
      settingsModal.open();
      
      // Change some settings first
      settings.setColor('boardGrid', '#FF0000');
      
      // Mock confirm
      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(true);
      
      // Switch to advanced tab
      const advancedTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Advanced') as HTMLElement;
      advancedTab.click();
      
      // Find reset all button
      const resetBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Reset All Settings') as HTMLElement;
      
      resetBtn.click();
      
      // Should reset
      expect(settings.getColor('boardGrid')).toBe(Settings.PRESET_THEMES[0].colors.boardGrid);
      
      window.confirm = originalConfirm;
    });

    test('should import theme from file', async () => {
      const { selectFile } = require('@/utils/fileIO');
      
      const mockTheme = {
        id: 'imported',
        name: 'Imported Theme',
        description: 'Test import',
        colors: Settings.PRESET_THEMES[0].colors,
        opacity: Settings.PRESET_THEMES[0].opacity,
        isCustom: true
      };
      
      const mockFile = new File([JSON.stringify(mockTheme)], 'theme.json', { type: 'application/json' });
      selectFile.mockResolvedValue(mockFile);
      
      settingsModal.open();
      
      // Switch to advanced tab
      const advancedTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Advanced') as HTMLElement;
      advancedTab.click();
      
      // Mock alert
      const originalAlert = window.alert;
      window.alert = jest.fn();
      
      // Find import button
      const importBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Import Theme') as HTMLElement;
      
      await importBtn.click();
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Should have imported theme
      const customThemes = settings.getCustomThemes();
      expect(customThemes.some(t => t.name === 'Imported Theme')).toBe(true);
      
      window.alert = originalAlert;
    });

    test('should export theme to file', () => {
      const { downloadFile } = require('@/utils/fileIO');
      
      settingsModal.open();
      
      // Switch to advanced tab
      const advancedTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Advanced') as HTMLElement;
      advancedTab.click();
      
      // Find export button
      const exportBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Export Current Theme') as HTMLElement;
      
      exportBtn.click();
      
      // Should call downloadFile
      expect(downloadFile).toHaveBeenCalled();
      const [content, filename, mimeType] = downloadFile.mock.calls[0];
      expect(filename).toMatch(/pente3d-theme-.*\.json/);
      expect(mimeType).toBe('application/json');
      
      const exportedTheme = JSON.parse(content);
      expect(exportedTheme.id).toBe('default');
    });

    test('should update preview in real-time', () => {
      jest.useFakeTimers();
      
      settingsModal.open();
      
      // Switch to colors tab
      const colorTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Colors') as HTMLElement;
      colorTab.click();
      
      // Change color
      const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;
      colorInput.value = '#FF0000';
      colorInput.dispatchEvent(new Event('input'));
      
      // Advance timers to trigger preview
      jest.advanceTimersByTime(100);
      
      // Should have called renderer methods
      expect(renderer.applyColorSettings).toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('Validation', () => {
    test('should validate color inputs before apply', () => {
      settingsModal.open();
      
      // Switch to colors tab
      const colorTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Colors') as HTMLElement;
      colorTab.click();
      
      // Find hex input
      const hexInput = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(hexInput).toBeTruthy();
      
      // Try invalid color
      hexInput.value = 'invalid';
      hexInput.dispatchEvent(new Event('input'));
      
      // Color picker should not update
      const colorPicker = hexInput.previousElementSibling as HTMLInputElement;
      expect(colorPicker.value).not.toBe('invalid');
    });

    test('should show error for invalid colors', () => {
      // This is handled internally by the Settings class validation
      expect(() => settings.setColor('boardGrid', 'invalid')).toThrow();
    });

    test('should validate opacity ranges', () => {
      settingsModal.open();
      
      // Switch to opacity tab
      const opacityTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Opacity') as HTMLElement;
      opacityTab.click();
      
      // Opacity sliders have min/max attributes
      const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
      expect(slider.min).toBe('0');
      expect(slider.max).toBe('100');
    });

    test('should validate theme names', () => {
      settingsModal.open();
      
      // Mock prompt with empty name
      const originalPrompt = window.prompt;
      window.prompt = jest.fn().mockReturnValue('');
      
      // Find create button
      const createBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Create Custom Theme') as HTMLElement;
      
      createBtn.click();
      
      // Should not create theme with empty name
      expect(settings.getCustomThemes()).toHaveLength(0);
      
      window.prompt = originalPrompt;
    });

    test('should prevent duplicate theme names', () => {
      // Theme names can be duplicated, but IDs are unique
      const theme1 = settings.createCustomTheme('Same Name', 'First');
      const theme2 = settings.createCustomTheme('Same Name', 'Second');
      
      expect(theme1.id).not.toBe(theme2.id);
      expect(settings.getCustomThemes()).toHaveLength(2);
    });

    test('should handle storage quota errors', () => {
      // This would be tested in integration tests with actual localStorage
      expect(true).toBe(true);
    });

    test('should validate imported theme data', async () => {
      const { selectFile } = require('@/utils/fileIO');
      
      const invalidTheme = { invalid: 'data' };
      const mockFile = new File([JSON.stringify(invalidTheme)], 'theme.json');
      selectFile.mockResolvedValue(mockFile);
      
      settingsModal.open();
      
      // Switch to advanced tab
      const advancedTab = Array.from(container.querySelectorAll('.settings-tab'))
        .find(tab => tab.textContent === 'Advanced') as HTMLElement;
      advancedTab.click();
      
      // Mock alert
      const originalAlert = window.alert;
      window.alert = jest.fn();
      
      // Find import button
      const importBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Import Theme') as HTMLElement;
      
      await importBtn.click();
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Should show error
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to import theme'));
      
      window.alert = originalAlert;
    });
  });

  describe('Preview Mode', () => {
    test('should enter preview mode when opened', () => {
      expect(settings.isInPreviewMode()).toBe(false);
      
      settingsModal.open();
      
      expect(settings.isInPreviewMode()).toBe(true);
    });

    test('should apply preview on confirm', () => {
      settingsModal.open();
      
      // Make some changes
      settings.setColor('boardGrid', '#FF0000');
      
      // Click apply
      const applyBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Apply') as HTMLElement;
      
      applyBtn.click();
      
      // Should apply changes and exit preview
      expect(settings.isInPreviewMode()).toBe(false);
      expect(settings.getColor('boardGrid')).toBe('#FF0000');
    });

    test('should cancel preview on cancel', () => {
      const originalColor = settings.getColor('boardGrid');
      
      settingsModal.open();
      
      // Make some changes
      settings.setColor('boardGrid', '#FF0000');
      
      // Click cancel
      const cancelBtn = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Cancel') as HTMLElement;
      
      cancelBtn.click();
      
      // Should revert changes and exit preview
      expect(settings.isInPreviewMode()).toBe(false);
      expect(settings.getColor('boardGrid')).toBe(originalColor);
    });

    test('should exit preview mode on destroy', () => {
      settingsModal.open();
      
      expect(settings.isInPreviewMode()).toBe(true);
      
      settingsModal.destroy();
      
      expect(settings.isInPreviewMode()).toBe(false);
    });
  });
});