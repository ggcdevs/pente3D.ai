import { Modal, ModalOptions } from './Modal';
import { Settings, ColorSettings, OpacitySettings, ThemePreset } from '../storage/Settings';
import { Renderer } from '../rendering/Renderer';
import { downloadFile, selectFile } from '../utils/fileIO';
import { logger } from '@/utils';

export interface SettingsModalOptions extends ModalOptions {
  settings: Settings;
  renderer: Renderer;
  onSettingsChange?: (settings: Settings) => void;
}

interface SettingsValues {
  gridColor: string;
  nodeColor: string;
  blackPieceColor: string;
  whitePieceColor: string;
  highlightColor: string;
  lineHighlightColor: string;
  temporaryPieceColor: string;
  gridOpacity: number;
  nodeSize: number;
  pieceSize: number;
  highlightIntensity: number;
  animationSpeed: number;
  showGrid: boolean;
  showNodes: boolean;
  enableAnimations: boolean;
  showCoordinates: boolean;
  enableSound: boolean;
  autoRotate: boolean;
}

interface BooleanSetting {
  label: string;
  key: keyof SettingsValues;
  defaultValue: boolean;
}

export class SettingsModal extends Modal {
  private settings: Settings;
  private renderer: Renderer;
  private modalOptions: SettingsModalOptions;
  private tempSettings: SettingsValues;
  private previewTimeout?: number;
  private colorPickers: Map<keyof ColorSettings, HTMLInputElement> = new Map();
  private opacitySliders: Map<keyof OpacitySettings, HTMLInputElement> = new Map();
  private categoryTabs: Map<string, HTMLElement> = new Map();
  private activeCategory: string = 'themes';
  private contentContainer?: HTMLElement;


  private booleanSettings: BooleanSetting[] = [
    { label: 'Show Grid', key: 'showGrid', defaultValue: true },
    { label: 'Show Nodes', key: 'showNodes', defaultValue: true },
    { label: 'Enable Animations', key: 'enableAnimations', defaultValue: true },
    { label: 'Show Coordinates', key: 'showCoordinates', defaultValue: false },
    { label: 'Enable Sound', key: 'enableSound', defaultValue: true },
    { label: 'Auto-rotate Board', key: 'autoRotate', defaultValue: false }
  ];

  constructor(options: SettingsModalOptions) {
    super({
      title: 'Settings',
      className: 'settings-modal',
      ...options
    });

    this.settings = options.settings;
    this.renderer = options.renderer;
    this.modalOptions = options;
    this.tempSettings = this.getSettingsValues();
    
    // Start preview mode
    this.settings.startPreview();
  }

  protected render(): void {
    const mainContainer = document.createElement('div');
    mainContainer.className = 'settings-main-container';
    mainContainer.style.display = 'flex';
    mainContainer.style.flexDirection = 'column';
    mainContainer.style.height = '500px';
    mainContainer.style.maxHeight = '80vh';

    // Create tabs
    const tabsContainer = this.createTabs();
    mainContainer.appendChild(tabsContainer);

    // Create content container
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'settings-content';
    this.contentContainer.style.flex = '1';
    this.contentContainer.style.overflowY = 'auto';
    this.contentContainer.style.padding = '20px';
    mainContainer.appendChild(this.contentContainer);

    // Show initial tab
    this.showTab('themes');

    this.setContent(mainContainer);

    // Footer with buttons
    const footerContent = document.createElement('div');
    footerContent.style.display = 'flex';
    footerContent.style.justifyContent = 'space-between';
    footerContent.style.gap = '10px';

    const resetBtn = this.createButton('Reset to Defaults', () => {
      this.resetToDefaults();
    });
    resetBtn.style.backgroundColor = '#666';

    const cancelBtn = this.createButton('Cancel', () => {
      this.cancel();
    });
    cancelBtn.style.backgroundColor = '#666';

    const applyBtn = this.createButton('Apply', () => {
      this.apply();
    });
    applyBtn.style.backgroundColor = '#4CAF50';

    footerContent.appendChild(resetBtn);
    const rightButtons = document.createElement('div');
    rightButtons.style.display = 'flex';
    rightButtons.style.gap = '10px';
    rightButtons.appendChild(cancelBtn);
    rightButtons.appendChild(applyBtn);
    footerContent.appendChild(rightButtons);

    this.setFooter(footerContent);
  }

  private createSection(title: string): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.style.marginBottom = '15px';

    const header = document.createElement('h3');
    header.textContent = title;
    header.style.color = '#fff';
    header.style.marginBottom = '10px';
    header.style.fontSize = '1.1rem';
    header.style.borderBottom = '1px solid #555';
    header.style.paddingBottom = '5px';
    section.appendChild(header);

    return section;
  }



  private createBooleanControl(setting: BooleanSetting): HTMLDivElement {
    const control = document.createElement('div');
    control.className = 'setting-control';
    control.style.display = 'flex';
    control.style.alignItems = 'center';
    control.style.justifyContent = 'space-between';
    control.style.marginBottom = '10px';

    const label = document.createElement('label');
    label.textContent = setting.label;
    label.style.color = '#ccc';
    label.style.flex = '1';

    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    toggle.style.position = 'relative';
    toggle.style.display = 'inline-block';
    toggle.style.width = '50px';
    toggle.style.height = '24px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(this.tempSettings[setting.key] ?? setting.defaultValue);
    checkbox.style.opacity = '0';
    checkbox.style.width = '0';
    checkbox.style.height = '0';

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    slider.style.position = 'absolute';
    slider.style.cursor = 'pointer';
    slider.style.top = '0';
    slider.style.left = '0';
    slider.style.right = '0';
    slider.style.bottom = '0';
    slider.style.backgroundColor = checkbox.checked ? '#4CAF50' : '#ccc';
    slider.style.transition = '0.4s';
    slider.style.borderRadius = '24px';

    const knob = document.createElement('span');
    knob.style.position = 'absolute';
    knob.style.content = '';
    knob.style.height = '16px';
    knob.style.width = '16px';
    knob.style.left = checkbox.checked ? '30px' : '4px';
    knob.style.bottom = '4px';
    knob.style.backgroundColor = 'white';
    knob.style.transition = '0.4s';
    knob.style.borderRadius = '50%';

    slider.appendChild(knob);
    toggle.appendChild(checkbox);
    toggle.appendChild(slider);

    checkbox.addEventListener('change', () => {
      slider.style.backgroundColor = checkbox.checked ? '#4CAF50' : '#ccc';
      knob.style.left = checkbox.checked ? '30px' : '4px';
      this.updateSetting(setting.key, checkbox.checked);
    });

    control.appendChild(label);
    control.appendChild(toggle);

    return control;
  }

  private createButton(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.padding = '10px 20px';
    button.style.fontSize = '1rem';
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.transition = 'opacity 0.2s';

    button.addEventListener('mouseenter', () => {
      button.style.opacity = '0.8';
    });

    button.addEventListener('mouseleave', () => {
      button.style.opacity = '1';
    });

    button.addEventListener('click', onClick);

    return button;
  }

  private updateSetting<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    this.tempSettings[key] = value;
    this.schedulePreview();
  }

  private schedulePreview(): void {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
    }
    this.previewTimeout = window.setTimeout(() => {
      this.applyPreview();
    }, 100);
  }

  private applyPreview(): void {
    // Apply settings to renderer for live preview
    const colors = this.settings.getColors();
    const opacity = this.settings.getOpacitySettings();
    
    if (this.renderer.applyColorSettings) {
      this.renderer.applyColorSettings(colors);
    }
    if (this.renderer.applyOpacitySettings) {
      this.renderer.applyOpacitySettings(opacity);
    }
  }

  private resetToDefaults(): void {
    this.settings.resetToDefaults();
    this.tempSettings = this.getDefaultSettingsValues();
    this.showTab('themes');
    this.schedulePreview();
  }

  private cancel(): void {
    // Cancel preview mode without applying changes
    this.settings.cancelPreview();
    this.close();
  }

  private apply(): void {
    // Apply preview changes permanently
    this.settings.applyPreview();
    
    if (this.modalOptions.onSettingsChange) {
      this.modalOptions.onSettingsChange(this.settings);
    }
    
    this.close();
  }

  public destroy(): void {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
    }
    // Cancel preview mode
    this.settings.cancelPreview();
    super.destroy();
  }
  
  private createTabs(): HTMLElement {
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'settings-tabs';
    tabsContainer.style.display = 'flex';
    tabsContainer.style.borderBottom = '2px solid #444';
    tabsContainer.style.marginBottom = '0';
    
    const tabs = [
      { id: 'themes', label: 'Themes' },
      { id: 'colors', label: 'Colors' },
      { id: 'opacity', label: 'Opacity' },
      { id: 'advanced', label: 'Advanced' }
    ];
    
    tabs.forEach((tab, index) => {
      const tabElement = document.createElement('button');
      tabElement.className = 'settings-tab';
      tabElement.textContent = tab.label;
      tabElement.style.flex = '1';
      tabElement.style.padding = '15px';
      tabElement.style.backgroundColor = 'transparent';
      tabElement.style.color = '#ccc';
      tabElement.style.border = 'none';
      tabElement.style.borderBottom = '2px solid transparent';
      tabElement.style.cursor = 'pointer';
      tabElement.style.fontSize = '1rem';
      tabElement.style.transition = 'all 0.2s';
      
      tabElement.addEventListener('click', () => this.showTab(tab.id));
      tabElement.addEventListener('mouseenter', () => {
        if (tab.id !== this.activeCategory) {
          tabElement.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        }
      });
      tabElement.addEventListener('mouseleave', () => {
        if (tab.id !== this.activeCategory) {
          tabElement.style.backgroundColor = 'transparent';
        }
      });
      
      // Set up keyboard navigation
      tabElement.setAttribute('role', 'tab');
      tabElement.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      tabElement.setAttribute('tabindex', index === 0 ? '0' : '-1');
      
      this.categoryTabs.set(tab.id, tabElement);
      tabsContainer.appendChild(tabElement);
    });
    
    return tabsContainer;
  }
  
  private showTab(tabId: string): void {
    // Update active tab styling
    this.categoryTabs.forEach((tab, id) => {
      if (id === tabId) {
        tab.style.color = '#fff';
        tab.style.borderBottomColor = '#4CAF50';
        tab.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        tab.setAttribute('aria-selected', 'true');
        tab.setAttribute('tabindex', '0');
      } else {
        tab.style.color = '#ccc';
        tab.style.borderBottomColor = 'transparent';
        tab.style.backgroundColor = 'transparent';
        tab.setAttribute('aria-selected', 'false');
        tab.setAttribute('tabindex', '-1');
      }
    });
    
    this.activeCategory = tabId;
    
    // Clear content
    if (this.contentContainer) {
      this.contentContainer.innerHTML = '';
      
      // Render appropriate content
      switch (tabId) {
        case 'themes':
          this.contentContainer.appendChild(this.createThemeTab());
          break;
        case 'colors':
          this.contentContainer.appendChild(this.createColorsTab());
          break;
        case 'opacity':
          this.contentContainer.appendChild(this.createOpacityTab());
          break;
        case 'advanced':
          this.contentContainer.appendChild(this.createAdvancedTab());
          break;
      }
    }
    
    this.updateFocusableElements();
  }
  
  private createThemeTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'theme-tab-content';
    
    // Theme selector section
    const selectorSection = this.createSection('Select Theme');
    
    const themeGrid = document.createElement('div');
    themeGrid.style.display = 'grid';
    themeGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
    themeGrid.style.gap = '15px';
    themeGrid.style.marginTop = '15px';
    
    const allThemes = this.settings.getAllThemes();
    const activeTheme = this.settings.getActiveTheme();
    
    allThemes.forEach(theme => {
      const themeCard = this.createThemeCard(theme, theme.id === activeTheme?.id);
      themeGrid.appendChild(themeCard);
    });
    
    selectorSection.appendChild(themeGrid);
    container.appendChild(selectorSection);
    
    // Custom theme section
    const customSection = this.createSection('Custom Themes');
    
    const createThemeBtn = this.createButton('Create Custom Theme', () => {
      this.createCustomTheme();
    });
    createThemeBtn.style.backgroundColor = '#4CAF50';
    createThemeBtn.style.marginBottom = '15px';
    
    customSection.appendChild(createThemeBtn);
    container.appendChild(customSection);
    
    return container;
  }
  
  private createThemeCard(theme: ThemePreset, isActive: boolean): HTMLElement {
    const card = document.createElement('div');
    card.className = 'theme-card';
    card.style.padding = '15px';
    card.style.border = isActive ? '2px solid #4CAF50' : '1px solid #555';
    card.style.borderRadius = '8px';
    card.style.backgroundColor = '#2a2a2a';
    card.style.cursor = 'pointer';
    card.style.transition = 'all 0.2s';
    
    // Theme preview
    const preview = document.createElement('div');
    preview.style.height = '60px';
    preview.style.marginBottom = '10px';
    preview.style.display = 'flex';
    preview.style.gap = '5px';
    preview.style.padding = '10px';
    preview.style.backgroundColor = theme.colors.background;
    preview.style.borderRadius = '4px';
    
    // Preview elements
    const pieceColors = [theme.colors.blackPieces, theme.colors.whitePieces];
    pieceColors.forEach(color => {
      const piece = document.createElement('div');
      piece.style.width = '20px';
      piece.style.height = '20px';
      piece.style.borderRadius = '50%';
      piece.style.backgroundColor = color;
      preview.appendChild(piece);
    });
    
    card.appendChild(preview);
    
    // Theme info
    const name = document.createElement('h4');
    name.textContent = theme.name;
    name.style.color = '#fff';
    name.style.marginBottom = '5px';
    card.appendChild(name);
    
    const description = document.createElement('p');
    description.textContent = theme.description;
    description.style.color = '#999';
    description.style.fontSize = '0.9rem';
    description.style.marginBottom = '10px';
    card.appendChild(description);
    
    // Actions
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    
    const applyBtn = document.createElement('button');
    applyBtn.textContent = isActive ? 'Active' : 'Apply';
    applyBtn.style.flex = '1';
    applyBtn.style.padding = '5px 10px';
    applyBtn.style.backgroundColor = isActive ? '#666' : '#4CAF50';
    applyBtn.style.color = '#fff';
    applyBtn.style.border = 'none';
    applyBtn.style.borderRadius = '4px';
    applyBtn.style.cursor = isActive ? 'default' : 'pointer';
    applyBtn.disabled = isActive;
    
    if (!isActive) {
      applyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyTheme(theme.id);
      });
    }
    
    actions.appendChild(applyBtn);
    
    if (theme.isCustom) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.padding = '5px 10px';
      deleteBtn.style.backgroundColor = '#f44336';
      deleteBtn.style.color = '#fff';
      deleteBtn.style.border = 'none';
      deleteBtn.style.borderRadius = '4px';
      deleteBtn.style.cursor = 'pointer';
      
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteCustomTheme(theme.id);
      });
      
      actions.appendChild(deleteBtn);
    }
    
    card.appendChild(actions);
    
    // Hover effect
    card.addEventListener('mouseenter', () => {
      if (!isActive) {
        card.style.borderColor = '#777';
        card.style.transform = 'translateY(-2px)';
      }
    });
    
    card.addEventListener('mouseleave', () => {
      if (!isActive) {
        card.style.borderColor = '#555';
        card.style.transform = 'translateY(0)';
      }
    });
    
    return card;
  }
  
  private createColorsTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'colors-tab-content';
    
    // Board colors
    const boardSection = this.createSection('Board');
    const boardColors: (keyof ColorSettings)[] = ['background', 'boardGrid', 'nodeSpheres'];
    boardColors.forEach(key => {
      const control = this.createEnhancedColorControl(key);
      boardSection.appendChild(control);
    });
    container.appendChild(boardSection);
    
    // Piece colors
    const pieceSection = this.createSection('Pieces');
    const pieceColors: (keyof ColorSettings)[] = ['blackPieces', 'whitePieces', 'temporaryPieces'];
    pieceColors.forEach(key => {
      const control = this.createEnhancedColorControl(key);
      pieceSection.appendChild(control);
    });
    container.appendChild(pieceSection);
    
    // Highlight colors
    const highlightSection = this.createSection('Highlights');
    const highlightColors: (keyof ColorSettings)[] = ['highlightedNodes', 'highlightedLines', 'capturedPieces', 'winningLine'];
    highlightColors.forEach(key => {
      const control = this.createEnhancedColorControl(key);
      highlightSection.appendChild(control);
    });
    container.appendChild(highlightSection);
    
    // Lighting colors
    const lightingSection = this.createSection('Lighting');
    const lightingColors: (keyof ColorSettings)[] = ['ambientLight', 'directionalLight'];
    lightingColors.forEach(key => {
      const control = this.createEnhancedColorControl(key);
      lightingSection.appendChild(control);
    });
    container.appendChild(lightingSection);
    
    return container;
  }
  
  private createEnhancedColorControl(key: keyof ColorSettings): HTMLElement {
    const control = document.createElement('div');
    control.className = 'color-control';
    control.style.display = 'flex';
    control.style.alignItems = 'center';
    control.style.justifyContent = 'space-between';
    control.style.marginBottom = '15px';
    
    const label = document.createElement('label');
    label.textContent = this.formatLabel(key);
    label.style.color = '#ccc';
    label.style.flex = '1';
    
    const inputWrapper = document.createElement('div');
    inputWrapper.style.display = 'flex';
    inputWrapper.style.alignItems = 'center';
    inputWrapper.style.gap = '10px';
    
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = this.settings.getColor(key);
    colorInput.style.width = '50px';
    colorInput.style.height = '30px';
    colorInput.style.border = 'none';
    colorInput.style.borderRadius = '4px';
    colorInput.style.cursor = 'pointer';
    
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = colorInput.value;
    hexInput.style.width = '80px';
    hexInput.style.padding = '5px';
    hexInput.style.backgroundColor = '#3a3a3a';
    hexInput.style.color = '#fff';
    hexInput.style.border = '1px solid #555';
    hexInput.style.borderRadius = '4px';
    hexInput.pattern = '^#[0-9A-Fa-f]{6}$';
    
    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value;
      this.updateColor(key, colorInput.value);
    });
    
    hexInput.addEventListener('input', () => {
      if (this.settings.validateColor(hexInput.value)) {
        colorInput.value = hexInput.value;
        this.updateColor(key, hexInput.value);
      }
    });
    
    this.colorPickers.set(key, colorInput);
    
    inputWrapper.appendChild(colorInput);
    inputWrapper.appendChild(hexInput);
    
    control.appendChild(label);
    control.appendChild(inputWrapper);
    
    return control;
  }
  
  private createOpacityTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'opacity-tab-content';
    
    const section = this.createSection('Transparency Settings');
    
    const opacitySettings: (keyof OpacitySettings)[] = [
      'boardGrid', 'nodeSpheres', 'pieces', 'temporaryPieces', 'highlights'
    ];
    
    opacitySettings.forEach(key => {
      const control = this.createOpacityControl(key);
      section.appendChild(control);
    });
    
    container.appendChild(section);
    
    return container;
  }
  
  private createOpacityControl(key: keyof OpacitySettings): HTMLElement {
    const control = document.createElement('div');
    control.className = 'opacity-control';
    control.style.display = 'flex';
    control.style.alignItems = 'center';
    control.style.justifyContent = 'space-between';
    control.style.marginBottom = '15px';
    
    const label = document.createElement('label');
    label.textContent = this.formatLabel(key);
    label.style.color = '#ccc';
    label.style.flex = '1';
    
    const inputWrapper = document.createElement('div');
    inputWrapper.style.display = 'flex';
    inputWrapper.style.alignItems = 'center';
    inputWrapper.style.gap = '10px';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = (this.settings.getOpacity(key) * 100).toString();
    slider.style.width = '150px';
    
    const valueDisplay = document.createElement('span');
    valueDisplay.textContent = `${slider.value}%`;
    valueDisplay.style.color = '#fff';
    valueDisplay.style.width = '50px';
    valueDisplay.style.textAlign = 'right';
    
    // Visual preview bar
    const previewBar = document.createElement('div');
    previewBar.style.width = '50px';
    previewBar.style.height = '20px';
    previewBar.style.backgroundColor = '#fff';
    previewBar.style.opacity = (parseInt(slider.value) / 100).toString();
    previewBar.style.border = '1px solid #555';
    previewBar.style.borderRadius = '2px';
    
    slider.addEventListener('input', () => {
      const opacity = parseInt(slider.value) / 100;
      valueDisplay.textContent = `${slider.value}%`;
      previewBar.style.opacity = opacity.toString();
      this.updateOpacity(key, opacity);
    });
    
    this.opacitySliders.set(key, slider);
    
    inputWrapper.appendChild(slider);
    inputWrapper.appendChild(valueDisplay);
    inputWrapper.appendChild(previewBar);
    
    control.appendChild(label);
    control.appendChild(inputWrapper);
    
    return control;
  }
  
  private createAdvancedTab(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'advanced-tab-content';
    
    // Display options
    const displaySection = this.createSection('Display Options');
    this.booleanSettings.forEach(setting => {
      const control = this.createBooleanControl(setting);
      displaySection.appendChild(control);
    });
    container.appendChild(displaySection);
    
    // Import/Export section
    const importExportSection = this.createSection('Theme Management');
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginBottom = '15px';
    
    const exportBtn = this.createButton('Export Current Theme', () => {
      this.exportCurrentTheme();
    });
    exportBtn.style.backgroundColor = '#2196F3';
    
    const importBtn = this.createButton('Import Theme', () => {
      this.importTheme();
    });
    importBtn.style.backgroundColor = '#2196F3';
    
    buttonContainer.appendChild(exportBtn);
    buttonContainer.appendChild(importBtn);
    importExportSection.appendChild(buttonContainer);
    
    container.appendChild(importExportSection);
    
    // Reset section
    const resetSection = this.createSection('Reset Options');
    
    const resetContainer = document.createElement('div');
    resetContainer.style.display = 'flex';
    resetContainer.style.gap = '10px';
    
    const resetColorsBtn = this.createButton('Reset Colors', () => {
      this.settings.resetColors();
      this.showTab('colors');
    });
    resetColorsBtn.style.backgroundColor = '#ff9800';
    
    const resetOpacityBtn = this.createButton('Reset Opacity', () => {
      this.settings.resetOpacity();
      this.showTab('opacity');
    });
    resetOpacityBtn.style.backgroundColor = '#ff9800';
    
    const resetAllBtn = this.createButton('Reset All Settings', () => {
      if (confirm('Are you sure you want to reset all settings to defaults?')) {
        this.resetToDefaults();
      }
    });
    resetAllBtn.style.backgroundColor = '#f44336';
    
    resetContainer.appendChild(resetColorsBtn);
    resetContainer.appendChild(resetOpacityBtn);
    resetContainer.appendChild(resetAllBtn);
    resetSection.appendChild(resetContainer);
    
    container.appendChild(resetSection);
    
    return container;
  }
  
  private formatLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
  
  private updateColor(key: keyof ColorSettings, color: string): void {
    try {
      this.settings.setColor(key, color);
      this.schedulePreview();
    } catch (error) {
      logger.error('Invalid color setting', error as Error, { key });
    }
  }
  
  private updateOpacity(key: keyof OpacitySettings, opacity: number): void {
    this.settings.setOpacity(key, opacity);
    this.schedulePreview();
  }
  
  private applyTheme(themeId: string): void {
    this.settings.setActiveTheme(themeId);
    this.schedulePreview();
    this.showTab('themes');
  }
  
  private createCustomTheme(): void {
    const name = prompt('Enter theme name:');
    if (!name) return;
    
    const description = prompt('Enter theme description:') || '';
    
    try {
      const theme = this.settings.createCustomTheme(name, description);
      this.showTab('themes');
      alert(`Theme "${theme.name}" created successfully!`);
    } catch (error) {
      alert(`Failed to create theme: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private deleteCustomTheme(themeId: string): void {
    if (confirm('Are you sure you want to delete this theme?')) {
      try {
        this.settings.deleteCustomTheme(themeId);
        this.showTab('themes');
      } catch (error) {
        alert(`Failed to delete theme: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
  
  private exportCurrentTheme(): void {
    const theme = this.settings.getActiveTheme();
    if (!theme) return;
    
    try {
      const themeData = this.settings.exportTheme(theme.id);
      const filename = `pente3d-theme-${theme.name.toLowerCase().replace(/\s+/g, '-')}.json`;
      downloadFile(themeData, filename, 'application/json');
    } catch (error) {
      alert(`Failed to export theme: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async importTheme(): Promise<void> {
    try {
      const file = await selectFile('.json');
      const content = await file.text();
      const theme = this.settings.importTheme(content);
      this.showTab('themes');
      alert(`Theme "${theme.name}" imported successfully!`);
    } catch (error) {
      alert(`Failed to import theme: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getSettingsValues(): SettingsValues {
    // For now, return default values - in a real implementation,
    // these would come from the actual Settings object
    return this.getDefaultSettingsValues();
  }

  private getDefaultSettingsValues(): SettingsValues {
    return {
      gridColor: '#444444',
      nodeColor: '#666666',
      blackPieceColor: '#000000',
      whitePieceColor: '#ffffff',
      highlightColor: '#ffff00',
      lineHighlightColor: '#00ff00',
      temporaryPieceColor: '#ff0000',
      gridOpacity: 0.3,
      nodeSize: 0.15,
      pieceSize: 0.4,
      highlightIntensity: 1.0,
      animationSpeed: 1.0,
      showGrid: true,
      showNodes: true,
      enableAnimations: true,
      showCoordinates: false,
      enableSound: true,
      autoRotate: false
    };
  }

}