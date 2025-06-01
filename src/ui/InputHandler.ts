import {
    Raycaster,
    Vector2,
    Camera,
    Scene,
    Intersection,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Vector3 } from '@/core/Vector3';
import { Game } from '@/core/Game';
import { Renderer } from '@/rendering/Renderer';

export interface InputHandlerOptions {
    canvas: HTMLCanvasElement;
    camera: Camera;
    scene: Scene;
    controls: OrbitControls;
    game: Game;
    renderer: Renderer;
}

export interface InteractionState {
    hoveredPosition: Vector3 | null;
    selectedPosition: Vector3 | null;
    temporaryPieceMode: boolean;
    temporaryPosition: Vector3 | null;
    mouseDown: boolean;
    mouseButton: number;
    lastClickTime: number;
    doubleClickThreshold: number;
}

export class InputHandler {
    private readonly canvas: HTMLCanvasElement;
    private readonly camera: Camera;
    private readonly scene: Scene;
    private readonly controls: OrbitControls;
    private readonly game: Game;
    private readonly renderer: Renderer;
    private readonly raycaster: Raycaster;
    private readonly mouse: Vector2;
    private readonly state: InteractionState;
    private readonly listeners: Map<string, Set<(data: any) => void>>;
    private readonly keyboardShortcuts: Map<string, () => void>;
    private animationFrameId: number | null = null;

    constructor(options: InputHandlerOptions) {
        this.canvas = options.canvas;
        this.camera = options.camera;
        this.scene = options.scene;
        this.controls = options.controls;
        this.game = options.game;
        this.renderer = options.renderer;
        
        this.raycaster = new Raycaster();
        this.mouse = new Vector2();
        
        this.state = {
            hoveredPosition: null,
            selectedPosition: null,
            temporaryPieceMode: false,
            temporaryPosition: null,
            mouseDown: false,
            mouseButton: -1,
            lastClickTime: 0,
            doubleClickThreshold: 300,
        };
        
        this.listeners = new Map();
        this.keyboardShortcuts = new Map();
        
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('click', this.onClick.bind(this));
        this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
        this.canvas.addEventListener('contextmenu', this.onContextMenu.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
        
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        window.addEventListener('resize', this.onResize.bind(this));
    }

    private setupKeyboardShortcuts(): void {
        // Undo/Redo
        this.keyboardShortcuts.set('ctrl+z', () => this.game.undo());
        this.keyboardShortcuts.set('ctrl+y', () => this.game.redo());
        this.keyboardShortcuts.set('ctrl+shift+z', () => this.game.redo());
        
        // Temporary piece mode
        this.keyboardShortcuts.set('t', () => this.toggleTemporaryPieceMode());
        
        // Cancel operations
        this.keyboardShortcuts.set('escape', () => this.cancelCurrentOperation());
        
        // Reset view
        this.keyboardShortcuts.set('r', () => this.resetView());
        
        // Toggle grid
        this.keyboardShortcuts.set('g', () => this.emit('toggleGrid'));
    }

    private updateMouse(event: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private performRaycast(): Intersection[] {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        return this.raycaster.intersectObjects(this.scene.children, true);
    }

    private findBoardIntersection(intersections: Intersection[]): Vector3 | null {
        // Look for intersection points (spheres) in the scene
        for (const intersection of intersections) {
            const object = intersection.object;
            if (object && object.userData && object.userData.type === 'intersection') {
                const position = object.userData.position;
                if (position instanceof Vector3) {
                    return position;
                }
            }
        }
        return null;
    }

    private onMouseMove(event: MouseEvent): void {
        this.updateMouse(event);
        
        const intersections = this.performRaycast();
        const boardPosition = this.findBoardIntersection(intersections);
        
        if (boardPosition !== this.state.hoveredPosition) {
            const previousPosition = this.state.hoveredPosition;
            this.state.hoveredPosition = boardPosition;
            
            // Update highlighting
            if (previousPosition) {
                this.renderer.unhighlightPosition(previousPosition);
            }
            if (boardPosition) {
                this.renderer.highlightPosition(boardPosition);
            }
            
            this.emit('hover', { position: boardPosition, previousPosition });
        }
        
        // Update temporary piece position if in temporary mode
        if (this.state.temporaryPieceMode && boardPosition) {
            this.state.temporaryPosition = boardPosition;
            this.renderer.setTemporaryPiece(boardPosition, this.game.getCurrentPlayer());
        }
    }

    private onMouseDown(event: MouseEvent): void {
        this.state.mouseDown = true;
        this.state.mouseButton = event.button;
        
        // Disable orbit controls for left click to allow piece placement
        if (event.button === 0) {
            this.controls.enabled = false;
        }
    }

    private onMouseUp(_event: MouseEvent): void {
        this.state.mouseDown = false;
        this.state.mouseButton = -1;
        
        // Re-enable orbit controls
        this.controls.enabled = true;
    }

    private onClick(event: MouseEvent): void {
        // Only process left clicks
        if (event.button !== 0) return;
        
        this.updateMouse(event);
        const intersections = this.performRaycast();
        const boardPosition = this.findBoardIntersection(intersections);
        
        if (boardPosition) {
            this.state.selectedPosition = boardPosition;
            
            // Try to place a piece at this position
            if (!this.state.temporaryPieceMode) {
                try {
                    this.game.placePiece(boardPosition);
                    this.emit('piecePlaced', { position: boardPosition });
                } catch (error) {
                    this.emit('invalidMove', { position: boardPosition, error });
                }
            } else {
                // In temporary mode, just show the piece
                this.state.temporaryPosition = boardPosition;
                this.renderer.setTemporaryPiece(boardPosition, this.game.getCurrentPlayer());
                this.emit('temporaryPiecePlaced', { position: boardPosition });
            }
        }
    }

    private onDoubleClick(_event: MouseEvent): void {
        // Double click to confirm temporary piece placement
        if (this.state.temporaryPieceMode && this.state.temporaryPosition) {
            try {
                this.game.placePiece(this.state.temporaryPosition);
                this.renderer.clearTemporaryPiece();
                this.state.temporaryPosition = null;
                this.state.temporaryPieceMode = false;
                this.emit('temporaryPieceConfirmed', { position: this.state.temporaryPosition });
            } catch (error) {
                this.emit('invalidMove', { position: this.state.temporaryPosition, error });
            }
        }
    }

    private onContextMenu(event: MouseEvent): void {
        event.preventDefault();
        // Right click handling is done in mousedown/mouseup for orbit controls
    }

    private onWheel(event: WheelEvent): void {
        // Wheel events are handled by OrbitControls for zoom
        // We can emit an event if needed for UI updates
        this.emit('zoom', { delta: event.deltaY });
    }

    private onKeyDown(event: KeyboardEvent): void {
        const key = this.getKeyString(event);
        const handler = this.keyboardShortcuts.get(key);
        
        if (handler) {
            event.preventDefault();
            handler();
            this.emit('shortcut', { key });
        }
    }

    private onKeyUp(_event: KeyboardEvent): void {
        // Handle key up events if needed
    }

    private onResize(): void {
        // Update raycaster on resize
        this.emit('resize');
    }

    private getKeyString(event: KeyboardEvent): string {
        const parts: string[] = [];
        if (event.ctrlKey || event.metaKey) parts.push('ctrl');
        if (event.shiftKey) parts.push('shift');
        if (event.altKey) parts.push('alt');
        parts.push(event.key.toLowerCase());
        return parts.join('+');
    }

    private toggleTemporaryPieceMode(): void {
        this.state.temporaryPieceMode = !this.state.temporaryPieceMode;
        
        if (!this.state.temporaryPieceMode) {
            this.renderer.clearTemporaryPiece();
            this.state.temporaryPosition = null;
        }
        
        this.emit('temporaryModeChanged', { enabled: this.state.temporaryPieceMode });
    }

    private cancelCurrentOperation(): void {
        if (this.state.temporaryPieceMode) {
            this.state.temporaryPieceMode = false;
            this.renderer.clearTemporaryPiece();
            this.state.temporaryPosition = null;
        }
        
        if (this.state.hoveredPosition) {
            this.renderer.unhighlightPosition(this.state.hoveredPosition);
            this.state.hoveredPosition = null;
        }
        
        this.emit('operationCancelled');
    }

    private resetView(): void {
        // Reset camera to default position
        this.controls.reset();
        this.emit('viewReset');
    }

    // Event system
    public on(event: string, listener: (data: any) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);
    }

    public off(event: string, listener: (data: any) => void): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.delete(listener);
        }
    }

    private emit(event: string, data?: any): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach(listener => listener(data));
        }
    }

    // Public methods
    public getState(): Readonly<InteractionState> {
        return { ...this.state };
    }

    public setTemporaryPieceMode(enabled: boolean): void {
        this.state.temporaryPieceMode = enabled;
        if (!enabled) {
            this.renderer.clearTemporaryPiece();
            this.state.temporaryPosition = null;
        }
    }

    public dispose(): void {
        // Remove event listeners
        this.canvas.removeEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.removeEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.removeEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.removeEventListener('click', this.onClick.bind(this));
        this.canvas.removeEventListener('dblclick', this.onDoubleClick.bind(this));
        this.canvas.removeEventListener('contextmenu', this.onContextMenu.bind(this));
        this.canvas.removeEventListener('wheel', this.onWheel.bind(this));
        
        window.removeEventListener('keydown', this.onKeyDown.bind(this));
        window.removeEventListener('keyup', this.onKeyUp.bind(this));
        window.removeEventListener('resize', this.onResize.bind(this));
        
        // Clear all listeners
        this.listeners.clear();
        this.keyboardShortcuts.clear();
        
        // Cancel any pending operations
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }
}