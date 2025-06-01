import Peer, { DataConnection } from 'peerjs';
import { EventEmitter } from '@/utils';
import { Game, Move } from '@/core';
import {
  ConnectionStatus,
  MessageType,
  NetworkConfig,
  NetworkMessage,
  ConnectionInfo,
  MoveMessage,
  MoveAckMessage,
  MoveRejectMessage,
  UndoMessage,
  RedoMessage,
  ResetMessage,
  SyncRequestMessage,
  SyncResponseMessage,
  PingMessage,
  PongMessage,
  PlayerDisconnectedMessage,
  PlayerReconnectedMessage,
  NetworkGameState,
  ConflictDetectedMessage,
  ConflictResolutionMessage,
  HashChainRequestMessage,
  HashChainResponseMessage,
  ConflictInfo,
  ConflictLog,
} from './types';

export class NetworkManager extends EventEmitter {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private game: Game;
  private config: Required<NetworkConfig>;
  private connectionInfo: ConnectionInfo;
  private messageSequence = 0;
  private reconnectAttempts = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageHandlers: Map<MessageType, (message: NetworkMessage) => void>;
  private pendingMessages: NetworkMessage[] = [];
  private networkGameState: NetworkGameState;
  private moveAckTimeout: NodeJS.Timeout | null = null;
  private queuedMoves: Move[] = [];
  private conflictInfo: ConflictInfo | null = null;
  private conflictLogs: ConflictLog[] = [];
  private maxLogSize = 100;

  constructor(game: Game, config: NetworkConfig = {}) {
    super();
    this.game = game;
    
    // Set default configuration
    this.config = {
      host: config.host || 'peerjs.com',
      port: config.port || 443,
      path: config.path || '/',
      key: config.key || 'peerjs',
      secure: config.secure !== false,
      debug: config.debug || false,
      config: config.config || { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      reconnectTimeout: config.reconnectTimeout || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      pingInterval: config.pingInterval || 10000,
      messageTimeout: config.messageTimeout || 5000,
    };

    // Initialize connection info
    this.connectionInfo = {
      peerId: '',
      gameCode: '',
      isHost: false,
      status: ConnectionStatus.DISCONNECTED,
      lastActivity: Date.now(),
      latency: 0,
      playerColor: undefined,
      opponentConnected: false,
    };

    // Initialize network game state
    this.networkGameState = {
      isNetworked: false,
      localPlayerColor: undefined,
      turnValidationEnabled: true,
      pendingMoves: new Map(),
      lastConfirmedStateHash: '',
      hashChain: [],
      conflictResolutionInProgress: false,
      lastConflictTimestamp: undefined,
    };

    // Set up message handlers
    this.messageHandlers = new Map();
    this.setupMessageHandlers();
  }

  /**
   * Initialize as host and generate a game code
   */
  async hostGame(): Promise<string> {
    this.connectionInfo.isHost = true;
    const gameCode = this.generateGameCode();
    this.connectionInfo.gameCode = gameCode;
    
    // Host always plays as black
    this.connectionInfo.playerColor = 'black';
    this.networkGameState.localPlayerColor = 'black';
    this.networkGameState.isNetworked = true;
    
    await this.initializePeer(gameCode);
    return gameCode;
  }

  /**
   * Join a game using a game code
   */
  async joinGame(gameCode: string): Promise<void> {
    this.connectionInfo.isHost = false;
    this.connectionInfo.gameCode = gameCode;
    
    // Client always plays as white
    this.connectionInfo.playerColor = 'white';
    this.networkGameState.localPlayerColor = 'white';
    this.networkGameState.isNetworked = true;
    
    // Generate a unique peer ID for the client
    const clientId = `${gameCode}_client_${Math.random().toString(36).substr(2, 9)}`;
    await this.initializePeer(clientId);
    
    // Connect to the host
    this.connectToPeer(gameCode);
  }

  /**
   * Send a move to the remote player
   */
  sendMove(move: Move): boolean {
    // Validate it's our turn
    const currentPlayer = this.game.getCurrentState().getCurrentPlayer();
    if (this.networkGameState.turnValidationEnabled && 
        currentPlayer.getColor() !== this.networkGameState.localPlayerColor) {
      this.emit('error', new Error('Not your turn'));
      return false;
    }

    // Update hash chain before sending move
    this.updateHashChain();

    const sequence = this.getNextSequence();
    const message: MoveMessage = {
      type: MessageType.MOVE,
      payload: {
        move: move,
        stateHash: this.game.getCurrentState().generateHash(),
        expectedTurn: currentPlayer.getColor(),
      },
      timestamp: Date.now(),
      sequence: sequence,
    };
    
    // Store pending move
    this.networkGameState.pendingMoves.set(sequence, {
      message: message,
      timestamp: Date.now(),
      acknowledged: false,
    });
    
    // Send the message
    this.sendMessage(message);
    
    // Set timeout for acknowledgment
    this.setMoveAckTimeout(sequence);
    
    return true;
  }

  /**
   * Send an undo request to the remote player
   */
  sendUndo(): void {
    const message: UndoMessage = {
      type: MessageType.UNDO,
      payload: {
        stateHash: this.game.getCurrentState().generateHash(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    
    this.sendMessage(message);
  }

  /**
   * Send a redo request to the remote player
   */
  sendRedo(): void {
    const message: RedoMessage = {
      type: MessageType.REDO,
      payload: {
        stateHash: this.game.getCurrentState().generateHash(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    
    this.sendMessage(message);
  }

  /**
   * Send a reset request to the remote player
   */
  sendReset(): void {
    const message: ResetMessage = {
      type: MessageType.RESET,
      payload: {
        stateHash: this.game.getCurrentState().generateHash(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    
    this.sendMessage(message);
  }

  /**
   * Request synchronization with the remote player
   */
  requestSync(): void {
    const message: SyncRequestMessage = {
      type: MessageType.SYNC_REQUEST,
      payload: {
        lastKnownHash: this.game.getCurrentState().generateHash(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    
    this.sendMessage(message);
  }

  /**
   * Get the current connection status
   */
  getStatus(): ConnectionStatus {
    return this.connectionInfo.status;
  }

  /**
   * Get the current connection info
   */
  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }

  /**
   * Get the current latency in milliseconds
   */
  getLatency(): number {
    return this.connectionInfo.latency;
  }

  /**
   * Check if it's the local player's turn
   */
  isLocalPlayerTurn(): boolean {
    const currentPlayer = this.game.getCurrentState().getCurrentPlayer();
    return currentPlayer.getColor() === this.networkGameState.localPlayerColor;
  }

  /**
   * Get the local player's color
   */
  getLocalPlayerColor(): 'black' | 'white' | undefined {
    return this.networkGameState.localPlayerColor;
  }

  /**
   * Check if the game is networked
   */
  isNetworked(): boolean {
    return this.networkGameState.isNetworked;
  }

  /**
   * Disconnect from the current game
   */
  disconnect(): void {
    this.cleanup();
    this.updateStatus(ConnectionStatus.DISCONNECTED);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.cleanup();
    this.removeAllListeners();
  }

  // Private methods

  private async initializePeer(peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.updateStatus(ConnectionStatus.CONNECTING);
      
      // Create peer with configuration
      this.peer = new Peer(peerId, {
        host: this.config.host,
        port: this.config.port,
        path: this.config.path,
        key: this.config.key,
        secure: this.config.secure,
        debug: this.config.debug ? 3 : 0,
        config: this.config.config,
      });

      this.connectionInfo.peerId = peerId;

      // Set up peer event handlers
      this.peer.on('open', (id) => {
        console.log('Peer opened with ID:', id);
        this.connectionInfo.peerId = id;
        
        if (this.connectionInfo.isHost) {
          this.updateStatus(ConnectionStatus.CONNECTED);
          this.startPingTimer();
        }
        
        resolve();
      });

      this.peer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (error) => {
        console.error('Peer error:', error);
        this.emit('error', error);
        this.updateStatus(ConnectionStatus.ERROR);
        
        if (!this.peer?.open) {
          reject(error);
        }
      });

      this.peer.on('disconnected', () => {
        console.log('Peer disconnected');
        if (this.connectionInfo.status === ConnectionStatus.CONNECTED) {
          this.handleDisconnection();
        }
      });

      this.peer.on('close', () => {
        console.log('Peer closed');
        this.updateStatus(ConnectionStatus.DISCONNECTED);
      });
    });
  }

  private connectToPeer(remotePeerId: string): void {
    if (!this.peer) {
      throw new Error('Peer not initialized');
    }

    const conn = this.peer.connect(remotePeerId, {
      reliable: true,
      serialization: 'json',
    });

    this.setupConnection(conn);
  }

  private handleIncomingConnection(conn: DataConnection): void {
    // Only accept one connection at a time
    if (this.connection && this.connection.open) {
      console.warn('Already connected, rejecting new connection');
      conn.close();
      return;
    }

    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection): void {
    this.connection = conn;

    conn.on('open', () => {
      console.log('Connection opened');
      this.updateStatus(ConnectionStatus.CONNECTED);
      this.connectionInfo.opponentConnected = true;
      this.reconnectAttempts = 0;
      this.startPingTimer();
      
      // Update last confirmed state hash
      this.networkGameState.lastConfirmedStateHash = this.game.getCurrentState().generateHash();
      
      // Initialize hash chain
      this.updateHashChain();
      
      // Send any pending messages
      this.flushPendingMessages();
      
      // Process any queued moves
      this.processQueuedMoves();
      
      this.emit('connected', { peerId: conn.peer });
    });

    conn.on('data', (data) => {
      this.handleMessage(data as NetworkMessage);
    });

    conn.on('close', () => {
      console.log('Connection closed');
      this.handleDisconnection();
    });

    conn.on('error', (error) => {
      console.error('Connection error:', error);
      this.emit('error', error);
    });
  }

  private handleDisconnection(): void {
    this.stopPingTimer();
    
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.updateStatus(ConnectionStatus.CONNECTING);
      this.scheduleReconnection();
    } else {
      this.updateStatus(ConnectionStatus.ERROR);
      this.emit('error', new Error('Max reconnection attempts reached'));
    }
  }

  private scheduleReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts}`);
      
      if (this.connectionInfo.isHost) {
        // Host waits for client to reconnect
        this.emit('reconnecting', { attempt: this.reconnectAttempts });
      } else {
        // Client attempts to reconnect to host
        this.connectToPeer(this.connectionInfo.gameCode);
      }
    }, this.config.reconnectTimeout);
  }

  private setupMessageHandlers(): void {
    this.messageHandlers.set(MessageType.MOVE, this.handleMoveMessage.bind(this));
    this.messageHandlers.set(MessageType.MOVE_ACK, this.handleMoveAck.bind(this));
    this.messageHandlers.set(MessageType.MOVE_REJECT, this.handleMoveReject.bind(this));
    this.messageHandlers.set(MessageType.UNDO, this.handleUndoMessage.bind(this));
    this.messageHandlers.set(MessageType.REDO, this.handleRedoMessage.bind(this));
    this.messageHandlers.set(MessageType.RESET, this.handleResetMessage.bind(this));
    this.messageHandlers.set(MessageType.SYNC_REQUEST, this.handleSyncRequest.bind(this));
    this.messageHandlers.set(MessageType.SYNC_RESPONSE, this.handleSyncResponse.bind(this));
    this.messageHandlers.set(MessageType.PING, this.handlePing.bind(this));
    this.messageHandlers.set(MessageType.PONG, this.handlePong.bind(this));
    this.messageHandlers.set(MessageType.PLAYER_DISCONNECTED, this.handlePlayerDisconnected.bind(this));
    this.messageHandlers.set(MessageType.PLAYER_RECONNECTED, this.handlePlayerReconnected.bind(this));
    this.messageHandlers.set(MessageType.CONFLICT_DETECTED, this.handleConflictDetected.bind(this));
    this.messageHandlers.set(MessageType.CONFLICT_RESOLUTION, this.handleConflictResolution.bind(this));
    this.messageHandlers.set(MessageType.HASH_CHAIN_REQUEST, this.handleHashChainRequest.bind(this));
    this.messageHandlers.set(MessageType.HASH_CHAIN_RESPONSE, this.handleHashChainResponse.bind(this));
  }

  private handleMessage(message: NetworkMessage): void {
    this.connectionInfo.lastActivity = Date.now();
    
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message);
    } else {
      console.warn('Unknown message type:', message.type);
    }
  }

  private handleMoveMessage(message: NetworkMessage): void {
    const moveMsg = message as MoveMessage;
    
    // Validate turn
    const currentState = this.game.getCurrentState();
    const expectedTurn = currentState.getCurrentPlayer().getColor();
    
    if (moveMsg.payload.expectedTurn !== expectedTurn) {
      // Send rejection
      const reject: MoveRejectMessage = {
        type: MessageType.MOVE_REJECT,
        payload: {
          moveSequence: moveMsg.sequence,
          reason: 'Turn mismatch',
          correctStateHash: currentState.generateHash(),
        },
        timestamp: Date.now(),
        sequence: this.getNextSequence(),
      };
      this.sendMessage(reject);
      return;
    }
    
    // Validate state hash if not the first move
    if (currentState.getMoveCount() > 0 && 
        moveMsg.payload.stateHash !== currentState.generateHash()) {
      // Detect conflict
      this.detectAndReportConflict(moveMsg.payload.stateHash, this.game.getCurrentStateIndex());
      return;
    }
    
    // Send acknowledgment
    const ack: MoveAckMessage = {
      type: MessageType.MOVE_ACK,
      payload: {
        moveSequence: moveMsg.sequence,
        stateHash: this.game.getCurrentState().generateHash(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    this.sendMessage(ack);
    
    // Emit the move for the game to process
    this.emit('move', moveMsg.payload);
    
    // Update hash chain after move is processed
    this.updateHashChain();
  }

  private handleUndoMessage(message: NetworkMessage): void {
    const undoMsg = message as UndoMessage;
    this.emit('undo', undoMsg.payload);
  }

  private handleRedoMessage(message: NetworkMessage): void {
    const redoMsg = message as RedoMessage;
    this.emit('redo', redoMsg.payload);
  }

  private handleResetMessage(message: NetworkMessage): void {
    const resetMsg = message as ResetMessage;
    this.emit('reset', resetMsg.payload);
  }

  private handleSyncRequest(_message: NetworkMessage): void {
    // Send current game state
    const response: SyncResponseMessage = {
      type: MessageType.SYNC_RESPONSE,
      payload: {
        gameState: JSON.stringify(this.game.toJSON()),
        stateHash: this.game.getCurrentState().generateHash(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    
    this.sendMessage(response);
  }

  private handleSyncResponse(message: NetworkMessage): void {
    const syncResp = message as SyncResponseMessage;
    this.emit('sync', syncResp.payload);
  }

  private handlePing(message: NetworkMessage): void {
    const ping = message as PingMessage;
    
    // Respond with pong
    const pong: PongMessage = {
      type: MessageType.PONG,
      payload: {
        clientTime: ping.payload.clientTime,
        serverTime: Date.now(),
      },
      timestamp: Date.now(),
      sequence: this.getNextSequence(),
    };
    
    this.sendMessage(pong);
  }

  private handlePong(message: NetworkMessage): void {
    const pong = message as PongMessage;
    const now = Date.now();
    const latency = now - pong.payload.clientTime;
    
    this.connectionInfo.latency = latency;
    this.emit('latency', latency);
  }

  private handleMoveAck(message: NetworkMessage): void {
    const ack = message as MoveAckMessage;
    
    // Clear acknowledgment timeout
    if (this.moveAckTimeout) {
      clearTimeout(this.moveAckTimeout);
      this.moveAckTimeout = null;
    }
    
    // Mark move as acknowledged
    const pendingMove = this.networkGameState.pendingMoves.get(ack.payload.moveSequence);
    if (pendingMove) {
      pendingMove.acknowledged = true;
      this.networkGameState.lastConfirmedStateHash = ack.payload.stateHash;
      this.networkGameState.pendingMoves.delete(ack.payload.moveSequence);
      
      this.emit('moveAcknowledged', { sequence: ack.payload.moveSequence });
    }
  }

  private handleMoveReject(message: NetworkMessage): void {
    const reject = message as MoveRejectMessage;
    
    // Clear acknowledgment timeout
    if (this.moveAckTimeout) {
      clearTimeout(this.moveAckTimeout);
      this.moveAckTimeout = null;
    }
    
    // Remove rejected move
    this.networkGameState.pendingMoves.delete(reject.payload.moveSequence);
    
    // Emit rejection event
    this.emit('moveRejected', {
      sequence: reject.payload.moveSequence,
      reason: reject.payload.reason,
    });
    
    // Request sync to get correct state
    this.requestSync();
  }

  private handlePlayerDisconnected(message: NetworkMessage): void {
    const msg = message as PlayerDisconnectedMessage;
    this.connectionInfo.opponentConnected = false;
    this.emit('playerDisconnected', { playerId: msg.payload.playerId });
  }

  private handlePlayerReconnected(message: NetworkMessage): void {
    const msg = message as PlayerReconnectedMessage;
    this.connectionInfo.opponentConnected = true;
    this.emit('playerReconnected', { playerId: msg.payload.playerId });
    
    // Request sync to ensure we're in sync
    this.requestSync();
  }

  private sendMessage(message: NetworkMessage): void {
    if (!this.connection || !this.connection.open) {
      // Queue message if not connected
      this.pendingMessages.push(message);
      return;
    }

    try {
      this.connection.send(message);
    } catch (error) {
      console.error('Failed to send message:', error);
      this.emit('error', error);
    }
  }

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        this.sendMessage(message);
      }
    }
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    
    this.pingTimer = setInterval(() => {
      if (this.connection && this.connection.open) {
        const ping: PingMessage = {
          type: MessageType.PING,
          payload: {
            clientTime: Date.now(),
          },
          timestamp: Date.now(),
          sequence: this.getNextSequence(),
        };
        
        this.sendMessage(ping);
      }
    }, this.config.pingInterval);
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private updateStatus(status: ConnectionStatus): void {
    const oldStatus = this.connectionInfo.status;
    this.connectionInfo.status = status;
    
    if (oldStatus !== status) {
      this.emit('statusChanged', { oldStatus, newStatus: status });
    }
  }

  private generateGameCode(): string {
    // Generate a 6-character alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return code;
  }

  private getNextSequence(): number {
    return ++this.messageSequence;
  }

  private setMoveAckTimeout(sequence: number): void {
    if (this.moveAckTimeout) {
      clearTimeout(this.moveAckTimeout);
    }
    
    this.moveAckTimeout = setTimeout(() => {
      const pendingMove = this.networkGameState.pendingMoves.get(sequence);
      if (pendingMove && !pendingMove.acknowledged) {
        // Move was not acknowledged, emit timeout
        this.emit('moveTimeout', { sequence });
        
        // Queue the move for retry
        if (pendingMove.message.payload.move) {
          this.queuedMoves.push(pendingMove.message.payload.move);
        }
        
        // Remove from pending
        this.networkGameState.pendingMoves.delete(sequence);
        
        // Request sync
        this.requestSync();
      }
    }, this.config.messageTimeout);
  }

  private processQueuedMoves(): void {
    while (this.queuedMoves.length > 0 && this.isLocalPlayerTurn()) {
      const move = this.queuedMoves.shift();
      if (move) {
        this.sendMove(move);
      }
    }
  }

  private cleanup(): void {
    this.stopPingTimer();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.moveAckTimeout) {
      clearTimeout(this.moveAckTimeout);
      this.moveAckTimeout = null;
    }
    
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    
    this.pendingMessages = [];
    this.messageSequence = 0;
    this.reconnectAttempts = 0;
    this.networkGameState.pendingMoves.clear();
    this.queuedMoves = [];
    this.networkGameState.hashChain = [];
    this.conflictInfo = null;
    this.conflictLogs = [];
  }

  // Conflict Resolution Methods

  private updateHashChain(): void {
    const currentState = this.game.getCurrentState();
    const currentIndex = this.game.getCurrentStateIndex();
    const hash = currentState.generateHash();
    const moveCount = currentState.getMoveCount();

    // Add to hash chain
    this.networkGameState.hashChain.push({
      index: currentIndex,
      hash: hash,
      moveCount: moveCount
    });

    // Keep only recent entries (last 50)
    if (this.networkGameState.hashChain.length > 50) {
      this.networkGameState.hashChain = this.networkGameState.hashChain.slice(-50);
    }
  }

  private detectConflict(remoteHash: string, remoteMoveIndex: number): ConflictInfo | null {
    const localHash = this.game.getCurrentState().generateHash();
    const localIndex = this.game.getCurrentStateIndex();

    if (localHash !== remoteHash && localIndex === remoteMoveIndex) {
      return {
        type: 'state_divergence',
        localHash,
        remoteHash,
        divergencePoint: remoteMoveIndex,
        detectedAt: Date.now(),
        resolved: false
      };
    }

    // Check if we're missing moves
    if (remoteMoveIndex > localIndex + 1) {
      return {
        type: 'missing_moves',
        localHash,
        remoteHash,
        divergencePoint: localIndex,
        detectedAt: Date.now(),
        resolved: false
      };
    }

    // Check for invalid sequence
    if (remoteMoveIndex < localIndex - 1) {
      return {
        type: 'invalid_sequence',
        localHash,
        remoteHash,
        divergencePoint: Math.min(localIndex, remoteMoveIndex),
        detectedAt: Date.now(),
        resolved: false
      };
    }

    return null;
  }

  private findCommonAncestor(remoteHashChain: Array<{ index: number; hash: string; moveCount: number }>): number {
    // Find the most recent common hash
    let commonIndex = -1;

    for (const remoteEntry of remoteHashChain) {
      const localEntry = this.networkGameState.hashChain.find(
        entry => entry.index === remoteEntry.index && entry.hash === remoteEntry.hash
      );
      
      if (localEntry) {
        commonIndex = Math.max(commonIndex, remoteEntry.index);
      }
    }

    return commonIndex;
  }

  private async rollbackToState(targetIndex: number): Promise<boolean> {
    this.logConflict('info', `Rolling back to state index ${targetIndex}`);
    
    try {
      // Use game's goToMove method to navigate to the target state
      const success = this.game.goToMove(targetIndex);
      
      if (success) {
        // Update hash chain after rollback
        this.updateHashChain();
        
        // Clear pending moves that are now invalid
        this.networkGameState.pendingMoves.clear();
        this.queuedMoves = [];
        
        this.logConflict('info', 'Rollback successful');
        return true;
      } else {
        this.logConflict('error', 'Rollback failed: goToMove returned false');
        return false;
      }
    } catch (error) {
      this.logConflict('error', `Rollback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  private logConflict(type: 'info' | 'warning' | 'error', message: string, data?: any): void {
    const log: ConflictLog = {
      timestamp: Date.now(),
      message,
      type,
      data
    };

    this.conflictLogs.push(log);

    // Keep only recent logs
    if (this.conflictLogs.length > this.maxLogSize) {
      this.conflictLogs = this.conflictLogs.slice(-this.maxLogSize);
    }

    // Also log to console for debugging
    const logFn = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
    logFn(`[NetworkManager Conflict] ${message}`, data);
  }

  getConflictLogs(): ConflictLog[] {
    return [...this.conflictLogs];
  }

  private handleConflictDetected(message: NetworkMessage): void {
    const conflictMsg = message as ConflictDetectedMessage;
    
    this.logConflict('warning', 'Conflict detected', conflictMsg.payload);
    
    // Store conflict info
    this.conflictInfo = {
      type: conflictMsg.payload.conflictType,
      localHash: this.game.getCurrentState().generateHash(),
      remoteHash: conflictMsg.payload.remoteStateHash,
      divergencePoint: conflictMsg.payload.moveIndex,
      detectedAt: Date.now(),
      resolved: false
    };

    // Set conflict resolution in progress
    this.networkGameState.conflictResolutionInProgress = true;
    this.networkGameState.lastConflictTimestamp = Date.now();

    // Emit conflict event for UI
    this.emit('conflictDetected', this.conflictInfo);

    // Request hash chain to find common ancestor
    this.requestHashChain(0, this.game.getCurrentStateIndex());
  }

  private handleConflictResolution(message: NetworkMessage): void {
    const resolutionMsg = message as ConflictResolutionMessage;
    
    this.logConflict('info', 'Received conflict resolution', resolutionMsg.payload);

    switch (resolutionMsg.payload.resolution) {
      case 'rollback':
        this.rollbackToState(resolutionMsg.payload.targetMoveIndex).then(success => {
          if (success) {
            this.networkGameState.conflictResolutionInProgress = false;
            if (this.conflictInfo) {
              this.conflictInfo.resolved = true;
            }
            this.emit('conflictResolved', { resolution: 'rollback', targetIndex: resolutionMsg.payload.targetMoveIndex });
          }
        });
        break;

      case 'sync':
        if (resolutionMsg.payload.gameState) {
          try {
            const game = Game.importGame(resolutionMsg.payload.gameState);
            // Replace our game state with the synced state
            this.game = game;
            this.updateHashChain();
            
            this.networkGameState.conflictResolutionInProgress = false;
            if (this.conflictInfo) {
              this.conflictInfo.resolved = true;
            }
            
            this.emit('conflictResolved', { resolution: 'sync' });
            this.emit('gameReplaced', { game });
          } catch (error) {
            this.logConflict('error', 'Failed to sync game state', error);
          }
        }
        break;

      case 'retry':
        // Clear pending moves and retry
        this.networkGameState.pendingMoves.clear();
        this.processQueuedMoves();
        
        this.networkGameState.conflictResolutionInProgress = false;
        if (this.conflictInfo) {
          this.conflictInfo.resolved = true;
        }
        
        this.emit('conflictResolved', { resolution: 'retry' });
        break;
    }
  }

  private handleHashChainRequest(message: NetworkMessage): void {
    const request = message as HashChainRequestMessage;
    
    // Build hash chain for requested range
    const hashChain: Array<{ index: number; hash: string; moveCount: number }> = [];
    const history = this.game.getHistory();
    
    const fromIndex = Math.max(0, request.payload.fromIndex);
    const toIndex = Math.min(history.length - 1, request.payload.toIndex);
    
    for (let i = fromIndex; i <= toIndex; i++) {
      const state = history[i];
      hashChain.push({
        index: i,
        hash: state.generateHash(),
        moveCount: state.getMoveCount()
      });
    }

    // Send response
    const response: HashChainResponseMessage = {
      type: MessageType.HASH_CHAIN_RESPONSE,
      payload: { hashChain },
      timestamp: Date.now(),
      sequence: this.getNextSequence()
    };
    
    this.sendMessage(response);
  }

  private handleHashChainResponse(message: NetworkMessage): void {
    const response = message as HashChainResponseMessage;
    
    this.logConflict('info', 'Received hash chain', { length: response.payload.hashChain.length });
    
    // Find common ancestor
    const commonAncestorIndex = this.findCommonAncestor(response.payload.hashChain);
    
    if (commonAncestorIndex >= 0) {
      this.logConflict('info', `Found common ancestor at index ${commonAncestorIndex}`);
      
      // Send resolution message to rollback to common ancestor
      const resolution: ConflictResolutionMessage = {
        type: MessageType.CONFLICT_RESOLUTION,
        payload: {
          resolution: 'rollback',
          targetStateHash: response.payload.hashChain.find(h => h.index === commonAncestorIndex)?.hash || '',
          targetMoveIndex: commonAncestorIndex
        },
        timestamp: Date.now(),
        sequence: this.getNextSequence()
      };
      
      this.sendMessage(resolution);
      
      // Perform our own rollback
      this.rollbackToState(commonAncestorIndex);
    } else {
      this.logConflict('error', 'No common ancestor found, requesting full sync');
      
      // Request full game sync
      this.requestSync();
    }
  }

  private requestHashChain(fromIndex: number, toIndex: number): void {
    const request: HashChainRequestMessage = {
      type: MessageType.HASH_CHAIN_REQUEST,
      payload: { fromIndex, toIndex },
      timestamp: Date.now(),
      sequence: this.getNextSequence()
    };
    
    this.sendMessage(request);
  }

  // Add conflict detection to existing methods
  detectAndReportConflict(expectedHash: string, moveIndex: number): void {
    const conflict = this.detectConflict(expectedHash, moveIndex);
    
    if (conflict && !this.networkGameState.conflictResolutionInProgress) {
      this.logConflict('warning', 'Sending conflict detection', conflict);
      
      const message: ConflictDetectedMessage = {
        type: MessageType.CONFLICT_DETECTED,
        payload: {
          localStateHash: conflict.localHash,
          remoteStateHash: conflict.remoteHash,
          moveIndex: conflict.divergencePoint,
          conflictType: conflict.type
        },
        timestamp: Date.now(),
        sequence: this.getNextSequence()
      };
      
      this.sendMessage(message);
      
      // Also handle it locally
      this.handleConflictDetected(message);
    }
  }
}