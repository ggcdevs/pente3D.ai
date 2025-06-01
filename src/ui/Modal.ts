import { EventEmitter } from '../utils/EventEmitter';

export interface ModalOptions {
  title?: string;
  className?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  focusFirst?: boolean;
  showCloseButton?: boolean;
  animationDuration?: number;
}

export abstract class Modal extends EventEmitter {
  protected element: HTMLDivElement;
  protected backdrop: HTMLDivElement;
  protected container: HTMLDivElement;
  protected header: HTMLDivElement;
  protected content: HTMLDivElement;
  protected footer: HTMLDivElement;
  protected closeButton?: HTMLButtonElement;
  protected isOpen: boolean = false;
  protected previousFocus: Element | null = null;
  protected options: Required<ModalOptions>;
  protected focusableElements: HTMLElement[] = [];
  protected currentFocusIndex: number = 0;
  protected modalId: string;
  protected titleId: string;
  protected contentId: string;

  constructor(options: ModalOptions = {}) {
    super();
    
    this.options = {
      title: '',
      className: '',
      closeOnBackdrop: true,
      closeOnEscape: true,
      focusFirst: true,
      showCloseButton: true,
      animationDuration: 200,
      ...options
    };

    // Generate unique IDs for ARIA attributes
    const uniqueId = Math.random().toString(36).substr(2, 9);
    this.modalId = `modal-${uniqueId}`;
    this.titleId = `modal-title-${uniqueId}`;
    this.contentId = `modal-content-${uniqueId}`;

    this.element = this.createElement();
    this.backdrop = this.createBackdrop();
    this.container = this.createContainer();
    this.header = this.createHeader();
    this.content = this.createContent();
    this.footer = this.createFooter();

    this.setupStructure();
    this.setupEventListeners();
    this.setupAccessibility();
  }

  private createElement(): HTMLDivElement {
    const element = document.createElement('div');
    element.className = `modal ${this.options.className}`.trim();
    element.style.display = 'none';
    element.style.position = 'fixed';
    element.style.inset = '0';
    element.style.zIndex = '9999';
    return element;
  }

  private createBackdrop(): HTMLDivElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.position = 'absolute';
    backdrop.style.inset = '0';
    backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    backdrop.style.opacity = '0';
    backdrop.style.transition = `opacity ${this.options.animationDuration}ms ease-out`;
    return backdrop;
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'modal-container';
    container.style.position = 'absolute';
    container.style.top = '50%';
    container.style.left = '50%';
    container.style.transform = 'translate(-50%, -50%) scale(0.9)';
    container.style.backgroundColor = '#2a2a2a';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5)';
    container.style.maxWidth = '90vw';
    container.style.maxHeight = '90vh';
    container.style.minWidth = '300px';
    container.style.overflow = 'hidden';
    container.style.opacity = '0';
    container.style.transition = `all ${this.options.animationDuration}ms ease-out`;
    return container;
  }

  private createHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.padding = '20px';
    header.style.borderBottom = '1px solid #444';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    if (this.options.title) {
      const title = document.createElement('h2');
      title.className = 'modal-title';
      title.id = this.titleId;
      title.textContent = this.options.title;
      title.style.margin = '0';
      title.style.fontSize = '1.5rem';
      title.style.fontWeight = 'bold';
      title.style.color = '#fff';
      header.appendChild(title);
    }

    if (this.options.showCloseButton) {
      this.closeButton = document.createElement('button');
      this.closeButton.className = 'modal-close';
      this.closeButton.innerHTML = '&times;';
      this.closeButton.style.background = 'none';
      this.closeButton.style.border = 'none';
      this.closeButton.style.fontSize = '2rem';
      this.closeButton.style.color = '#fff';
      this.closeButton.style.cursor = 'pointer';
      this.closeButton.style.padding = '0';
      this.closeButton.style.width = '32px';
      this.closeButton.style.height = '32px';
      this.closeButton.style.display = 'flex';
      this.closeButton.style.alignItems = 'center';
      this.closeButton.style.justifyContent = 'center';
      this.closeButton.style.borderRadius = '4px';
      this.closeButton.style.transition = 'background-color 0.2s';
      this.closeButton.setAttribute('aria-label', 'Close modal');
      header.appendChild(this.closeButton);
    }

    return header;
  }

  private createContent(): HTMLDivElement {
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.id = this.contentId;
    content.style.padding = '20px';
    content.style.overflowY = 'auto';
    content.style.maxHeight = 'calc(90vh - 140px)';
    return content;
  }

  private createFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.style.padding = '20px';
    footer.style.borderTop = '1px solid #444';
    footer.style.display = 'none'; // Hidden by default
    return footer;
  }

  private setupStructure(): void {
    this.container.appendChild(this.header);
    this.container.appendChild(this.content);
    this.container.appendChild(this.footer);
    this.element.appendChild(this.backdrop);
    this.element.appendChild(this.container);
  }

  private setupEventListeners(): void {
    if (this.options.closeOnBackdrop) {
      this.backdrop.addEventListener('click', () => this.close());
    }

    if (this.options.closeOnEscape) {
      this.handleEscape = this.handleEscape.bind(this);
    }

    if (this.closeButton) {
      this.closeButton.addEventListener('click', () => this.close());
      this.closeButton.addEventListener('mouseenter', () => {
        this.closeButton!.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      });
      this.closeButton.addEventListener('mouseleave', () => {
        this.closeButton!.style.backgroundColor = 'transparent';
      });
    }

    this.container.addEventListener('click', (e) => e.stopPropagation());
  }

  protected setupAccessibility(): void {
    // Set ARIA attributes on container
    this.container.setAttribute('role', 'dialog');
    this.container.setAttribute('aria-modal', 'true');
    this.container.setAttribute('id', this.modalId);
    
    // Set labelledby and describedby
    if (this.options.title) {
      this.container.setAttribute('aria-labelledby', this.titleId);
    }
    this.container.setAttribute('aria-describedby', this.contentId);
    
    // Make backdrop not focusable
    this.backdrop.setAttribute('aria-hidden', 'true');
    
    // Ensure close button has proper ARIA
    if (this.closeButton) {
      this.closeButton.setAttribute('aria-label', 'Close dialog');
      this.closeButton.setAttribute('title', 'Close dialog (Escape)');
    }
    
    // Announce modal opening to screen readers
    this.element.setAttribute('aria-live', 'assertive');
    this.element.setAttribute('aria-atomic', 'true');
  }

  private handleEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isOpen) {
      this.close();
    }
  }

  private handleTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || this.focusableElements.length === 0) return;

    event.preventDefault();

    if (event.shiftKey) {
      this.currentFocusIndex--;
      if (this.currentFocusIndex < 0) {
        this.currentFocusIndex = this.focusableElements.length - 1;
      }
    } else {
      this.currentFocusIndex++;
      if (this.currentFocusIndex >= this.focusableElements.length) {
        this.currentFocusIndex = 0;
      }
    }

    this.focusableElements[this.currentFocusIndex].focus();
  }

  protected updateFocusableElements(): void {
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    this.focusableElements = Array.from(this.element.querySelectorAll(selector))
      .filter(el => !el.hasAttribute('disabled')) as HTMLElement[];
  }

  public open(): void {
    if (this.isOpen) return;

    this.previousFocus = document.activeElement;
    document.body.appendChild(this.element);
    this.element.style.display = 'block';
    
    this.render();
    this.updateFocusableElements();

    requestAnimationFrame(() => {
      this.backdrop.style.opacity = '1';
      this.container.style.opacity = '1';
      this.container.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    if (this.options.closeOnEscape) {
      document.addEventListener('keydown', this.handleEscape);
    }
    
    this.handleTab = this.handleTab.bind(this);
    document.addEventListener('keydown', this.handleTab);

    if (this.options.focusFirst && this.focusableElements.length > 0) {
      setTimeout(() => {
        this.focusableElements[0].focus();
      }, this.options.animationDuration);
    }

    this.isOpen = true;
    this.emit('open');
  }

  public close(): void {
    if (!this.isOpen) return;

    this.backdrop.style.opacity = '0';
    this.container.style.opacity = '0';
    this.container.style.transform = 'translate(-50%, -50%) scale(0.9)';

    setTimeout(() => {
      this.element.style.display = 'none';
      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }

      if (this.previousFocus && this.previousFocus instanceof HTMLElement) {
        this.previousFocus.focus();
      }
    }, this.options.animationDuration);

    if (this.options.closeOnEscape) {
      document.removeEventListener('keydown', this.handleEscape);
    }
    document.removeEventListener('keydown', this.handleTab);

    this.isOpen = false;
    this.emit('close');
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public setTitle(title: string): void {
    this.options.title = title;
    const titleElement = this.header.querySelector('.modal-title');
    if (titleElement) {
      titleElement.textContent = title;
    } else if (title) {
      const newTitle = document.createElement('h2');
      newTitle.className = 'modal-title';
      newTitle.id = this.titleId;
      newTitle.textContent = title;
      newTitle.style.margin = '0';
      newTitle.style.fontSize = '1.5rem';
      newTitle.style.fontWeight = 'bold';
      newTitle.style.color = '#fff';
      this.header.insertBefore(newTitle, this.closeButton || null);
      this.container.setAttribute('aria-labelledby', this.titleId);
    }
  }

  protected setContent(html: string | HTMLElement): void {
    if (typeof html === 'string') {
      this.content.innerHTML = html;
    } else {
      this.content.innerHTML = '';
      this.content.appendChild(html);
    }
    if (this.isOpen) {
      this.updateFocusableElements();
    }
  }

  protected setFooter(html: string | HTMLElement): void {
    if (typeof html === 'string') {
      this.footer.innerHTML = html;
    } else {
      this.footer.innerHTML = '';
      this.footer.appendChild(html);
    }
    this.footer.style.display = this.footer.innerHTML ? 'block' : 'none';
    if (this.isOpen) {
      this.updateFocusableElements();
    }
  }

  public destroy(): void {
    this.close();
    this.removeAllListeners();
  }

  protected abstract render(): void;
}