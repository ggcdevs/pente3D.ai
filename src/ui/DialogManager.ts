import type { ModalOptions } from './Modal';
import { Modal } from './Modal';

export type DialogType = 'info' | 'warning' | 'error' | 'confirm';

export interface DialogOptions {
  type?: DialogType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

class Dialog extends Modal {
  private dialogOptions: DialogOptions;

  constructor(options: DialogOptions) {
    const modalOptions: ModalOptions = {
      title: options.title || Dialog.getDefaultTitle(options.type || 'info'),
      className: `dialog dialog-${options.type || 'info'}`,
      closeOnBackdrop: options.type !== 'confirm',
      closeOnEscape: options.type !== 'confirm',
      showCloseButton: false, // Dialogs don't show the X close button
    };

    super(modalOptions);
    this.dialogOptions = options;
  }

  private static getDefaultTitle(type: DialogType): string {
    switch (type) {
      case 'info':
        return 'Information';
      case 'warning':
        return 'Warning';
      case 'error':
        return 'Error';
      case 'confirm':
        return 'Confirm';
      default:
        return '';
    }
  }

  protected render(): void {
    const contentContainer = document.createElement('div');
    contentContainer.style.textAlign = 'center';
    contentContainer.style.minWidth = '300px';

    // Icon
    const icon = this.createIcon();
    if (icon) {
      contentContainer.appendChild(icon);
    }

    // Message
    const message = document.createElement('p');
    message.textContent = this.dialogOptions.message;
    message.style.color = '#fff';
    message.style.fontSize = '1.1rem';
    message.style.marginTop = '20px';
    message.style.marginBottom = '20px';
    message.style.lineHeight = '1.5';
    contentContainer.appendChild(message);

    this.setContent(contentContainer);

    // Footer buttons
    const footerContent = document.createElement('div');
    footerContent.style.display = 'flex';
    footerContent.style.justifyContent = 'center';
    footerContent.style.gap = '10px';

    if (this.dialogOptions.type === 'confirm') {
      const cancelBtn = this.createButton(this.dialogOptions.cancelText || 'Cancel', '#666', () => {
        if (this.dialogOptions.onCancel) {
          this.dialogOptions.onCancel();
        }
        this.close();
      });
      footerContent.appendChild(cancelBtn);

      const confirmBtn = this.createButton(
        this.dialogOptions.confirmText || 'Confirm',
        '#4CAF50',
        () => {
          if (this.dialogOptions.onConfirm) {
            this.dialogOptions.onConfirm();
          }
          this.close();
        }
      );
      footerContent.appendChild(confirmBtn);
    } else {
      const okBtn = this.createButton('OK', this.getButtonColor(), () => {
        if (this.dialogOptions.onConfirm) {
          this.dialogOptions.onConfirm();
        }
        this.close();
      });
      footerContent.appendChild(okBtn);
    }

    this.setFooter(footerContent);
  }

  private createIcon(): HTMLDivElement | null {
    const type = this.dialogOptions.type || 'info';
    const iconContainer = document.createElement('div');
    iconContainer.style.fontSize = '3rem';
    iconContainer.style.marginBottom = '10px';

    switch (type) {
      case 'info':
        iconContainer.textContent = 'ℹ️';
        iconContainer.style.color = '#2196F3';
        break;
      case 'warning':
        iconContainer.textContent = '⚠️';
        iconContainer.style.color = '#FF9800';
        break;
      case 'error':
        iconContainer.textContent = '❌';
        iconContainer.style.color = '#f44336';
        break;
      case 'confirm':
        iconContainer.textContent = '❓';
        iconContainer.style.color = '#FFC107';
        break;
      default:
        return null;
    }

    return iconContainer;
  }

  private getButtonColor(): string {
    switch (this.dialogOptions.type) {
      case 'error':
        return '#f44336';
      case 'warning':
        return '#FF9800';
      default:
        return '#2196F3';
    }
  }

  private createButton(text: string, color: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.padding = '10px 20px';
    button.style.fontSize = '1rem';
    button.style.backgroundColor = color;
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.minWidth = '100px';
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
}

export class DialogManager {
  private currentDialog: Dialog | null = null;

  public showInfo(message: string, title?: string): Promise<void> {
    return this.show({
      type: 'info',
      title,
      message,
    });
  }

  public showWarning(message: string, title?: string): Promise<void> {
    return this.show({
      type: 'warning',
      title,
      message,
    });
  }

  public showError(message: string, title?: string): Promise<void> {
    return this.show({
      type: 'error',
      title,
      message,
    });
  }

  public showConfirm(
    message: string,
    title?: string,
    confirmText?: string,
    cancelText?: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.show({
        type: 'confirm',
        title,
        message,
        confirmText,
        cancelText,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  public async confirmAction(action: string, consequence?: string): Promise<boolean> {
    const message = consequence
      ? `Are you sure you want to ${action}? ${consequence}`
      : `Are you sure you want to ${action}?`;

    return this.showConfirm(message, 'Confirm Action', 'Yes', 'No');
  }

  private show(options: DialogOptions): Promise<void> {
    return new Promise((resolve) => {
      if (this.currentDialog) {
        this.currentDialog.destroy();
      }

      const dialog = new Dialog({
        ...options,
        onConfirm: () => {
          if (options.onConfirm) {
            options.onConfirm();
          }
          resolve();
        },
        onCancel: () => {
          if (options.onCancel) {
            options.onCancel();
          }
          resolve();
        },
      });

      this.currentDialog = dialog;

      dialog.on('close', () => {
        if (this.currentDialog === dialog) {
          this.currentDialog = null;
        }
        resolve();
      });

      dialog.open();
    });
  }

  public closeAll(): void {
    if (this.currentDialog) {
      this.currentDialog.destroy();
      this.currentDialog = null;
    }
  }
}
