import { Modal, ModalOptions } from './Modal';
import { Settings } from '../storage/Settings';
import { Renderer } from '../rendering/Renderer';

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

interface ColorSetting {
  label: string;
  key: keyof SettingsValues;
  defaultValue: string;
}

interface NumberSetting {
  label: string;
  key: keyof SettingsValues;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

interface BooleanSetting {
  label: string;
  key: keyof SettingsValues;
  defaultValue: boolean;
}

export class SettingsModal extends Modal {
  private settings: Settings;
  private modalOptions: SettingsModalOptions;
  private tempSettings: SettingsValues;
  private previewTimeout?: number;

  private colorSettings: ColorSetting[] = [
    { label: 'Grid Color', key: 'gridColor', defaultValue: '#444444' },
    { label: 'Node Color', key: 'nodeColor', defaultValue: '#666666' },
    { label: 'Black Piece Color', key: 'blackPieceColor', defaultValue: '#000000' },
    { label: 'White Piece Color', key: 'whitePieceColor', defaultValue: '#ffffff' },
    { label: 'Highlight Color', key: 'highlightColor', defaultValue: '#ffff00' },
    { label: 'Line Highlight Color', key: 'lineHighlightColor', defaultValue: '#00ff00' },
    { label: 'Temporary Piece Color', key: 'temporaryPieceColor', defaultValue: '#ff0000' }
  ];

  private numberSettings: NumberSetting[] = [
    { label: 'Grid Opacity', key: 'gridOpacity', defaultValue: 0.3, min: 0, max: 1, step: 0.1 },
    { label: 'Node Size', key: 'nodeSize', defaultValue: 0.15, min: 0.1, max: 0.3, step: 0.05 },
    { label: 'Piece Size', key: 'pieceSize', defaultValue: 0.4, min: 0.2, max: 0.6, step: 0.05 },
    { label: 'Highlight Intensity', key: 'highlightIntensity', defaultValue: 1.0, min: 0.5, max: 2.0, step: 0.1 },
    { label: 'Animation Speed', key: 'animationSpeed', defaultValue: 1.0, min: 0.5, max: 2.0, step: 0.1 }
  ];

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
    this.modalOptions = options;
    this.tempSettings = this.getSettingsValues();
  }

  protected render(): void {
    const settingsContainer = document.createElement('div');
    settingsContainer.className = 'settings-container';
    settingsContainer.style.display = 'flex';
    settingsContainer.style.flexDirection = 'column';
    settingsContainer.style.gap = '20px';

    // Color Settings Section
    const colorSection = this.createSection('Colors');
    this.colorSettings.forEach(setting => {
      const control = this.createColorControl(setting);
      colorSection.appendChild(control);
    });
    settingsContainer.appendChild(colorSection);

    // Size & Opacity Settings Section
    const sizeSection = this.createSection('Size & Opacity');
    this.numberSettings.forEach(setting => {
      const control = this.createNumberControl(setting);
      sizeSection.appendChild(control);
    });
    settingsContainer.appendChild(sizeSection);

    // Display Settings Section
    const displaySection = this.createSection('Display Options');
    this.booleanSettings.forEach(setting => {
      const control = this.createBooleanControl(setting);
      displaySection.appendChild(control);
    });
    settingsContainer.appendChild(displaySection);

    this.setContent(settingsContainer);

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

  private createColorControl(setting: ColorSetting): HTMLDivElement {
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

    const inputWrapper = document.createElement('div');
    inputWrapper.style.display = 'flex';
    inputWrapper.style.alignItems = 'center';
    inputWrapper.style.gap = '10px';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = String(this.tempSettings[setting.key] || setting.defaultValue);
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

    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value;
      this.updateSetting(setting.key, colorInput.value);
    });

    hexInput.addEventListener('input', () => {
      if (/^#[0-9A-F]{6}$/i.test(hexInput.value)) {
        colorInput.value = hexInput.value;
        this.updateSetting(setting.key, hexInput.value);
      }
    });

    inputWrapper.appendChild(colorInput);
    inputWrapper.appendChild(hexInput);

    control.appendChild(label);
    control.appendChild(inputWrapper);

    return control;
  }

  private createNumberControl(setting: NumberSetting): HTMLDivElement {
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

    const inputWrapper = document.createElement('div');
    inputWrapper.style.display = 'flex';
    inputWrapper.style.alignItems = 'center';
    inputWrapper.style.gap = '10px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = setting.min.toString();
    slider.max = setting.max.toString();
    slider.step = setting.step.toString();
    slider.value = (this.tempSettings[setting.key] || setting.defaultValue).toString();
    slider.style.width = '100px';

    const valueDisplay = document.createElement('span');
    valueDisplay.textContent = slider.value;
    valueDisplay.style.color = '#fff';
    valueDisplay.style.width = '40px';
    valueDisplay.style.textAlign = 'right';

    slider.addEventListener('input', () => {
      valueDisplay.textContent = slider.value;
      this.updateSetting(setting.key, parseFloat(slider.value));
    });

    inputWrapper.appendChild(slider);
    inputWrapper.appendChild(valueDisplay);

    control.appendChild(label);
    control.appendChild(inputWrapper);

    return control;
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
    // Apply temporary settings to renderer for live preview
    // This would update the renderer's visual properties
    // For now, we'll just store them
  }

  private resetToDefaults(): void {
    this.tempSettings = this.getDefaultSettingsValues();
    this.render();
    this.updateFocusableElements();
  }

  private cancel(): void {
    // Revert any preview changes
    this.tempSettings = this.getSettingsValues();
    this.close();
  }

  private apply(): void {
    // Apply all changes
    this.applySettingsValues(this.tempSettings);
    
    if (this.modalOptions.onSettingsChange) {
      this.modalOptions.onSettingsChange(this.settings);
    }
    
    this.close();
  }

  public destroy(): void {
    if (this.previewTimeout) {
      clearTimeout(this.previewTimeout);
    }
    super.destroy();
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

  private applySettingsValues(_values: SettingsValues): void {
    // In a real implementation, this would apply the values to the Settings object
    // For now, we'll just store them
  }
}