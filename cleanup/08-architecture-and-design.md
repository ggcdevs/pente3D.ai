# Architecture and Design Improvements

## 1. Current Architecture Issues

### 1.1 Tight Coupling
**Problem**: Direct dependencies between modules
```typescript
// Renderer directly knows about Game internals
class Renderer {
  private game: Game;
  
  updatePieces() {
    const board = this.game.getBoard();
    const pieces = board.getAllPieces(); // Tight coupling
  }
}
```

**Solution**: Introduce interfaces and dependency injection
```typescript
// Define clear interfaces
interface GameView {
  readonly pieces: ReadonlyArray<PieceView>;
  readonly currentPlayer: PlayerView;
  readonly phase: GamePhase;
}

interface PieceView {
  readonly position: Vector3;
  readonly color: 'black' | 'white';
  readonly isTemporary: boolean;
}

// Renderer only depends on interfaces
class Renderer {
  constructor(private gameView: GameView) {}
  
  updatePieces() {
    for (const piece of this.gameView.pieces) {
      this.renderPiece(piece);
    }
  }
}
```

### 1.2 Unclear Module Boundaries
**Problem**: Modules doing too much
- Renderer handles animations, input highlighting, performance monitoring
- NetworkManager handles UI updates, game state, conflict resolution

**Solution**: Single Responsibility Principle
```typescript
// Before: One class doing everything
class Renderer {
  // Rendering
  render() {}
  
  // Animation
  animate() {}
  
  // Input handling
  highlightNode() {}
  
  // Performance
  measureFPS() {}
}

// After: Separated concerns
class SceneRenderer {
  render(scene: Scene, camera: Camera): void {}
}

class AnimationEngine {
  update(deltaTime: number): void {}
  addAnimation(animation: Animation): void {}
}

class HighlightSystem {
  highlight(object: Object3D): void {}
  clearHighlights(): void {}
}

class RenderPipeline {
  constructor(
    private renderer: SceneRenderer,
    private animations: AnimationEngine,
    private highlights: HighlightSystem
  ) {}
  
  frame(deltaTime: number): void {
    this.animations.update(deltaTime);
    this.highlights.update();
    this.renderer.render();
  }
}
```

## 2. Proposed Architecture

### 2.1 Layered Architecture
```
┌─────────────────────────────────────────┐
│          Presentation Layer             │
│  (UI Components, Views, Controllers)    │
├─────────────────────────────────────────┤
│          Application Layer              │
│  (Use Cases, Application Services)      │
├─────────────────────────────────────────┤
│           Domain Layer                  │
│  (Game Logic, Business Rules)          │
├─────────────────────────────────────────┤
│        Infrastructure Layer             │
│  (Storage, Network, Rendering)          │
└─────────────────────────────────────────┘
```

### 2.2 Module Structure
```typescript
// Domain Layer - Pure business logic
namespace Domain {
  export class Board {
    // Pure game logic, no dependencies
  }
  
  export class GameRules {
    // Business rules only
  }
  
  export interface BoardRepository {
    save(board: Board): Promise<void>;
    load(id: string): Promise<Board>;
  }
}

// Application Layer - Use cases
namespace Application {
  export class PlacePieceUseCase {
    constructor(
      private boardRepo: Domain.BoardRepository,
      private eventBus: EventBus
    ) {}
    
    async execute(command: PlacePieceCommand): Promise<Result> {
      // Orchestrate domain objects
      const board = await this.boardRepo.load(command.gameId);
      const newBoard = board.placePiece(command.piece);
      await this.boardRepo.save(newBoard);
      
      this.eventBus.publish(new PiecePlacedEvent(command.piece));
      
      return { success: true };
    }
  }
}

// Infrastructure Layer - External concerns
namespace Infrastructure {
  export class LocalStorageBoardRepository implements Domain.BoardRepository {
    async save(board: Board): Promise<void> {
      localStorage.setItem('board', JSON.stringify(board));
    }
    
    async load(id: string): Promise<Board> {
      const data = localStorage.getItem('board');
      return Board.fromJSON(JSON.parse(data));
    }
  }
}
```

## 3. Design Patterns Implementation

### 3.1 Repository Pattern
```typescript
// Abstract repository interface
interface Repository<T, ID> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<void>;
  delete(id: ID): Promise<void>;
}

// Game repository
interface GameRepository extends Repository<Game, string> {
  findByPlayerId(playerId: string): Promise<Game[]>;
  findActive(): Promise<Game[]>;
}

// Implementation
class IndexedDBGameRepository implements GameRepository {
  private db: IDBDatabase;
  
  async findById(id: string): Promise<Game | null> {
    const transaction = this.db.transaction(['games'], 'readonly');
    const store = transaction.objectStore('games');
    const data = await store.get(id);
    
    return data ? Game.fromJSON(data) : null;
  }
  
  async save(game: Game): Promise<void> {
    const transaction = this.db.transaction(['games'], 'readwrite');
    const store = transaction.objectStore('games');
    await store.put(game.toJSON());
  }
}
```

### 3.2 Unit of Work Pattern
```typescript
interface UnitOfWork {
  games: GameRepository;
  players: PlayerRepository;
  moves: MoveRepository;
  
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

class TransactionalUnitOfWork implements UnitOfWork {
  private operations: (() => Promise<void>)[] = [];
  
  async commit(): Promise<void> {
    try {
      for (const operation of this.operations) {
        await operation();
      }
      this.operations = [];
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
  
  async rollback(): Promise<void> {
    // Rollback logic
    this.operations = [];
  }
}
```

### 3.3 CQRS Pattern
```typescript
// Commands (write operations)
interface Command {
  readonly id: string;
  readonly timestamp: number;
}

class PlacePieceCommand implements Command {
  readonly id = generateId();
  readonly timestamp = Date.now();
  
  constructor(
    public readonly gameId: string,
    public readonly position: Vector3,
    public readonly playerId: string
  ) {}
}

// Queries (read operations)
interface Query<TResult> {
  readonly resultType: TResult;
}

class GetGameStateQuery implements Query<GameState> {
  readonly resultType!: GameState;
  
  constructor(public readonly gameId: string) {}
}

// Handlers
interface CommandHandler<TCommand extends Command> {
  handle(command: TCommand): Promise<void>;
}

interface QueryHandler<TQuery extends Query<TResult>, TResult> {
  handle(query: TQuery): Promise<TResult>;
}

// Bus
class CommandBus {
  private handlers = new Map<string, CommandHandler<any>>();
  
  register<T extends Command>(
    commandType: new (...args: any[]) => T,
    handler: CommandHandler<T>
  ): void {
    this.handlers.set(commandType.name, handler);
  }
  
  async execute<T extends Command>(command: T): Promise<void> {
    const handler = this.handlers.get(command.constructor.name);
    if (!handler) {
      throw new Error(`No handler for command: ${command.constructor.name}`);
    }
    await handler.handle(command);
  }
}
```

## 4. Dependency Injection

### 4.1 DI Container
```typescript
// Service definitions
interface ServiceDefinition {
  factory: () => any;
  singleton?: boolean;
  dependencies?: string[];
}

// DI Container
class Container {
  private services = new Map<string, ServiceDefinition>();
  private instances = new Map<string, any>();
  
  register<T>(
    name: string,
    factory: (...deps: any[]) => T,
    options?: { singleton?: boolean; dependencies?: string[] }
  ): void {
    this.services.set(name, {
      factory,
      singleton: options?.singleton ?? true,
      dependencies: options?.dependencies ?? []
    });
  }
  
  resolve<T>(name: string): T {
    const definition = this.services.get(name);
    if (!definition) {
      throw new Error(`Service not found: ${name}`);
    }
    
    // Return singleton instance if exists
    if (definition.singleton && this.instances.has(name)) {
      return this.instances.get(name);
    }
    
    // Resolve dependencies
    const deps = definition.dependencies.map(dep => this.resolve(dep));
    
    // Create instance
    const instance = definition.factory(...deps);
    
    // Store singleton
    if (definition.singleton) {
      this.instances.set(name, instance);
    }
    
    return instance;
  }
}

// Usage
const container = new Container();

// Register services
container.register('gameRepository', 
  () => new IndexedDBGameRepository(),
  { singleton: true }
);

container.register('gameService',
  (repo) => new GameService(repo),
  { 
    singleton: true,
    dependencies: ['gameRepository']
  }
);

// Resolve
const gameService = container.resolve<GameService>('gameService');
```

### 4.2 Service Locator Alternative
```typescript
// For simpler cases
class ServiceLocator {
  private static services = new Map<string, any>();
  
  static register(name: string, service: any): void {
    this.services.set(name, service);
  }
  
  static get<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    return service;
  }
}

// Bootstrap
ServiceLocator.register('eventBus', new EventBus());
ServiceLocator.register('gameEngine', new GameEngine());

// Usage
const eventBus = ServiceLocator.get<EventBus>('eventBus');
```

## 5. Event-Driven Architecture

### 5.1 Domain Events
```typescript
// Base domain event
abstract class DomainEvent {
  readonly id = generateId();
  readonly timestamp = Date.now();
  readonly version = 1;
  
  constructor(
    public readonly aggregateId: string,
    public readonly aggregateType: string
  ) {}
}

// Specific events
class PiecePlacedEvent extends DomainEvent {
  constructor(
    gameId: string,
    public readonly position: Vector3,
    public readonly playerId: string
  ) {
    super(gameId, 'Game');
  }
}

class GameWonEvent extends DomainEvent {
  constructor(
    gameId: string,
    public readonly winnerId: string,
    public readonly winType: WinType
  ) {
    super(gameId, 'Game');
  }
}
```

### 5.2 Event Bus
```typescript
interface EventHandler<T extends DomainEvent> {
  handle(event: T): Promise<void>;
}

class EventBus {
  private handlers = new Map<string, EventHandler<any>[]>();
  private middleware: EventMiddleware[] = [];
  
  subscribe<T extends DomainEvent>(
    eventType: new (...args: any[]) => T,
    handler: EventHandler<T>
  ): void {
    const eventName = eventType.name;
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName)!.push(handler);
  }
  
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    // Run middleware
    for (const mw of this.middleware) {
      await mw.process(event);
    }
    
    // Get handlers
    const handlers = this.handlers.get(event.constructor.name) || [];
    
    // Execute handlers
    await Promise.all(
      handlers.map(handler => 
        this.executeHandler(handler, event)
      )
    );
  }
  
  private async executeHandler(
    handler: EventHandler<any>,
    event: DomainEvent
  ): Promise<void> {
    try {
      await handler.handle(event);
    } catch (error) {
      console.error(`Handler error for ${event.constructor.name}:`, error);
      // Could implement retry logic here
    }
  }
}
```

## 6. State Management

### 6.1 Redux-like State Management
```typescript
// State
interface AppState {
  game: GameState;
  ui: UIState;
  network: NetworkState;
}

// Actions
interface Action {
  type: string;
  payload?: any;
}

// Reducers
type Reducer<S = any> = (state: S, action: Action) => S;

const gameReducer: Reducer<GameState> = (state, action) => {
  switch (action.type) {
    case 'PIECE_PLACED':
      return {
        ...state,
        pieces: [...state.pieces, action.payload.piece],
        currentPlayer: state.currentPlayer === 'black' ? 'white' : 'black'
      };
    default:
      return state;
  }
};

// Store
class Store<S> {
  private state: S;
  private listeners: ((state: S) => void)[] = [];
  
  constructor(
    private reducer: Reducer<S>,
    initialState: S
  ) {
    this.state = initialState;
  }
  
  getState(): S {
    return this.state;
  }
  
  dispatch(action: Action): void {
    this.state = this.reducer(this.state, action);
    this.listeners.forEach(listener => listener(this.state));
  }
  
  subscribe(listener: (state: S) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}
```

### 6.2 Observable State Pattern
```typescript
// Using RxJS-like observables
class ObservableState<T> {
  private state: T;
  private observers: ((state: T) => void)[] = [];
  
  constructor(initialState: T) {
    this.state = initialState;
  }
  
  get value(): T {
    return this.state;
  }
  
  set(newState: T): void {
    this.state = newState;
    this.notify();
  }
  
  update(updater: (state: T) => T): void {
    this.state = updater(this.state);
    this.notify();
  }
  
  subscribe(observer: (state: T) => void): () => void {
    this.observers.push(observer);
    observer(this.state); // Immediate notification
    
    return () => {
      this.observers = this.observers.filter(o => o !== observer);
    };
  }
  
  private notify(): void {
    this.observers.forEach(observer => observer(this.state));
  }
}

// Usage
const gameState = new ObservableState<GameState>(initialState);

const unsubscribe = gameState.subscribe(state => {
  console.log('Game state updated:', state);
});

gameState.update(state => ({
  ...state,
  moveCount: state.moveCount + 1
}));
```

## 7. Plugin Architecture

### 7.1 Plugin System
```typescript
// Plugin interface
interface Plugin {
  name: string;
  version: string;
  init(context: PluginContext): void;
  destroy?(): void;
}

interface PluginContext {
  game: GameAPI;
  ui: UIAPI;
  events: EventBus;
  storage: StorageAPI;
}

// Plugin manager
class PluginManager {
  private plugins = new Map<string, Plugin>();
  private context: PluginContext;
  
  constructor(context: PluginContext) {
    this.context = context;
  }
  
  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    
    try {
      await plugin.init(this.context);
      this.plugins.set(plugin.name, plugin);
      console.log(`Plugin registered: ${plugin.name} v${plugin.version}`);
    } catch (error) {
      console.error(`Failed to initialize plugin ${plugin.name}:`, error);
      throw error;
    }
  }
  
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    
    if (plugin.destroy) {
      await plugin.destroy();
    }
    
    this.plugins.delete(name);
  }
}

// Example plugin
class ReplayPlugin implements Plugin {
  name = 'replay';
  version = '1.0.0';
  
  private recorder?: GameRecorder;
  
  init(context: PluginContext): void {
    this.recorder = new GameRecorder();
    
    // Hook into game events
    context.events.subscribe(PiecePlacedEvent, {
      handle: async (event) => {
        this.recorder!.record(event);
      }
    });
    
    // Add UI button
    context.ui.addMenuItem({
      label: 'Replay',
      action: () => this.showReplayUI()
    });
  }
  
  destroy(): void {
    this.recorder?.stop();
  }
}
```

## 8. API Design

### 8.1 RESTful API Design
```typescript
// API client interface
interface GameAPI {
  // Resource-based endpoints
  games: {
    list(filter?: GameFilter): Promise<Game[]>;
    get(id: string): Promise<Game>;
    create(config: GameConfig): Promise<Game>;
    update(id: string, updates: Partial<Game>): Promise<Game>;
    delete(id: string): Promise<void>;
  };
  
  // Sub-resources
  moves: {
    list(gameId: string): Promise<Move[]>;
    create(gameId: string, move: MoveData): Promise<Move>;
  };
  
  // Actions
  actions: {
    surrender(gameId: string): Promise<void>;
    offerDraw(gameId: string): Promise<void>;
  };
}

// Implementation with proper error handling
class GameAPIClient implements GameAPI {
  constructor(private http: HttpClient) {}
  
  games = {
    list: async (filter?: GameFilter) => {
      const params = filter ? `?${new URLSearchParams(filter)}` : '';
      const response = await this.http.get<Game[]>(`/api/games${params}`);
      return response.data.map(Game.fromJSON);
    },
    
    create: async (config: GameConfig) => {
      const response = await this.http.post<Game>('/api/games', config);
      return Game.fromJSON(response.data);
    }
  };
}
```

### 8.2 GraphQL Alternative
```typescript
// Type definitions
const typeDefs = `
  type Game {
    id: ID!
    board: Board!
    players: [Player!]!
    currentPlayer: Player!
    status: GameStatus!
    moves: [Move!]!
  }
  
  type Query {
    game(id: ID!): Game
    games(filter: GameFilter): [Game!]!
  }
  
  type Mutation {
    createGame(config: GameConfig!): Game!
    placePiece(gameId: ID!, position: Vector3Input!): Game!
    surrender(gameId: ID!): Game!
  }
  
  type Subscription {
    gameUpdated(gameId: ID!): Game!
  }
`;

// Resolvers
const resolvers = {
  Query: {
    game: (_, { id }) => gameService.findById(id),
    games: (_, { filter }) => gameService.findAll(filter)
  },
  
  Mutation: {
    placePiece: async (_, { gameId, position }) => {
      const command = new PlacePieceCommand(gameId, position);
      await commandBus.execute(command);
      return gameService.findById(gameId);
    }
  }
};
```

## 9. Testing Architecture

### 9.1 Test Doubles
```typescript
// Test builder pattern
class GameBuilder {
  private game: Partial<Game> = {};
  
  withId(id: string): this {
    this.game.id = id;
    return this;
  }
  
  withBoard(board: Board): this {
    this.game.board = board;
    return this;
  }
  
  withMoves(moves: Move[]): this {
    this.game.moves = moves;
    return this;
  }
  
  build(): Game {
    return new Game(this.game);
  }
}

// Usage in tests
const game = new GameBuilder()
  .withId('test-game')
  .withBoard(new BoardBuilder().withSize(7).build())
  .withMoves([/* test moves */])
  .build();
```

### 9.2 Integration Test Harness
```typescript
class TestHarness {
  container: Container;
  eventBus: EventBus;
  
  async setup(): Promise<void> {
    this.container = new Container();
    this.eventBus = new EventBus();
    
    // Register test doubles
    this.container.register('eventBus', () => this.eventBus);
    this.container.register('gameRepository', () => new InMemoryGameRepository());
    
    // Bootstrap application
    await bootstrap(this.container);
  }
  
  async teardown(): Promise<void> {
    // Clean up
  }
  
  async executeCommand<T extends Command>(command: T): Promise<void> {
    const bus = this.container.resolve<CommandBus>('commandBus');
    await bus.execute(command);
  }
  
  async waitForEvent<T extends DomainEvent>(
    eventType: new (...args: any[]) => T
  ): Promise<T> {
    return new Promise(resolve => {
      this.eventBus.subscribe(eventType, {
        handle: async (event) => resolve(event)
      });
    });
  }
}
```

## 10. Scalability Considerations

### 10.1 Modular Loading
```typescript
// Lazy load features
const features = {
  singlePlayer: () => import('./features/single-player'),
  multiplayer: () => import('./features/multiplayer'),
  tutorial: () => import('./features/tutorial'),
  replay: () => import('./features/replay')
};

async function loadFeature(name: keyof typeof features) {
  const module = await features[name]();
  return module.default;
}
```

### 10.2 Micro-Frontend Architecture
```typescript
// Feature modules as micro-frontends
interface MicroFrontend {
  mount(container: HTMLElement, props: any): void;
  unmount(): void;
}

class GameBoardMicroFrontend implements MicroFrontend {
  private app?: Application;
  
  mount(container: HTMLElement, props: GameProps): void {
    this.app = new Application({
      container,
      gameId: props.gameId
    });
    this.app.start();
  }
  
  unmount(): void {
    this.app?.destroy();
  }
}
```