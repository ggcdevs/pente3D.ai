import { Move } from '@/core';

export enum MessageType {
  MOVE = 'move',
  MOVE_ACK = 'move_ack',
  MOVE_REJECT = 'move_reject',
  UNDO = 'undo',
  REDO = 'redo',
  RESET = 'reset',
  SYNC_REQUEST = 'sync_request',
  SYNC_RESPONSE = 'sync_response',
  PING = 'ping',
  PONG = 'pong',
  PLAYER_DISCONNECTED = 'player_disconnected',
  PLAYER_RECONNECTED = 'player_reconnected',
  CONFLICT_DETECTED = 'conflict_detected',
  CONFLICT_RESOLUTION = 'conflict_resolution',
  HASH_CHAIN_REQUEST = 'hash_chain_request',
  HASH_CHAIN_RESPONSE = 'hash_chain_response',
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

export interface NetworkMessage {
  type: MessageType;
  payload: any;
  timestamp: number;
  sequence: number;
}

export interface MoveMessage extends NetworkMessage {
  type: MessageType.MOVE;
  payload: {
    move: Move;
    stateHash: string;
    expectedTurn: 'black' | 'white';
  };
}

export interface MoveAckMessage extends NetworkMessage {
  type: MessageType.MOVE_ACK;
  payload: {
    moveSequence: number;
    stateHash: string;
  };
}

export interface MoveRejectMessage extends NetworkMessage {
  type: MessageType.MOVE_REJECT;
  payload: {
    moveSequence: number;
    reason: string;
    correctStateHash: string;
  };
}

export interface UndoMessage extends NetworkMessage {
  type: MessageType.UNDO;
  payload: {
    stateHash: string;
  };
}

export interface RedoMessage extends NetworkMessage {
  type: MessageType.REDO;
  payload: {
    stateHash: string;
  };
}

export interface ResetMessage extends NetworkMessage {
  type: MessageType.RESET;
  payload: {
    stateHash: string;
  };
}

export interface SyncRequestMessage extends NetworkMessage {
  type: MessageType.SYNC_REQUEST;
  payload: {
    lastKnownHash: string;
  };
}

export interface SyncResponseMessage extends NetworkMessage {
  type: MessageType.SYNC_RESPONSE;
  payload: {
    gameState: string; // Serialized game state
    stateHash: string;
  };
}

export interface PingMessage extends NetworkMessage {
  type: MessageType.PING;
  payload: {
    clientTime: number;
  };
}

export interface PongMessage extends NetworkMessage {
  type: MessageType.PONG;
  payload: {
    clientTime: number;
    serverTime: number;
  };
}

export interface PlayerDisconnectedMessage extends NetworkMessage {
  type: MessageType.PLAYER_DISCONNECTED;
  payload: {
    playerId: string;
  };
}

export interface PlayerReconnectedMessage extends NetworkMessage {
  type: MessageType.PLAYER_RECONNECTED;
  payload: {
    playerId: string;
  };
}

export interface ConflictDetectedMessage extends NetworkMessage {
  type: MessageType.CONFLICT_DETECTED;
  payload: {
    localStateHash: string;
    remoteStateHash: string;
    moveIndex: number;
    conflictType: 'state_divergence' | 'missing_moves' | 'invalid_sequence';
  };
}

export interface ConflictResolutionMessage extends NetworkMessage {
  type: MessageType.CONFLICT_RESOLUTION;
  payload: {
    resolution: 'rollback' | 'sync' | 'retry';
    targetStateHash: string;
    targetMoveIndex: number;
    gameState?: string; // Serialized game state for sync
  };
}

export interface HashChainRequestMessage extends NetworkMessage {
  type: MessageType.HASH_CHAIN_REQUEST;
  payload: {
    fromIndex: number;
    toIndex: number;
  };
}

export interface HashChainResponseMessage extends NetworkMessage {
  type: MessageType.HASH_CHAIN_RESPONSE;
  payload: {
    hashChain: Array<{
      index: number;
      hash: string;
      moveCount: number;
    }>;
  };
}

export type NetworkMessageTypes = 
  | MoveMessage
  | MoveAckMessage
  | MoveRejectMessage
  | UndoMessage
  | RedoMessage
  | ResetMessage
  | SyncRequestMessage
  | SyncResponseMessage
  | PingMessage
  | PongMessage
  | PlayerDisconnectedMessage
  | PlayerReconnectedMessage
  | ConflictDetectedMessage
  | ConflictResolutionMessage
  | HashChainRequestMessage
  | HashChainResponseMessage;

export interface NetworkConfig {
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
  debug?: boolean;
  config?: RTCConfiguration;
  reconnectTimeout?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  messageTimeout?: number;
}

export interface ConnectionInfo {
  peerId: string;
  gameCode: string;
  isHost: boolean;
  status: ConnectionStatus;
  lastActivity: number;
  latency: number;
  playerColor?: 'black' | 'white';
  opponentConnected: boolean;
}

export interface PendingMove {
  message: MoveMessage;
  timestamp: number;
  acknowledged: boolean;
}

export interface NetworkGameState {
  isNetworked: boolean;
  localPlayerColor?: 'black' | 'white';
  turnValidationEnabled: boolean;
  pendingMoves: Map<number, PendingMove>;
  lastConfirmedStateHash: string;
  hashChain: Array<{ index: number; hash: string; moveCount: number }>;
  conflictResolutionInProgress: boolean;
  lastConflictTimestamp?: number;
}

export interface ConflictInfo {
  type: 'state_divergence' | 'missing_moves' | 'invalid_sequence';
  localHash: string;
  remoteHash: string;
  divergencePoint: number;
  detectedAt: number;
  resolved: boolean;
}

export interface ConflictLog {
  timestamp: number;
  message: string;
  type: 'info' | 'warning' | 'error';
  data?: any;
}