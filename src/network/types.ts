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
  | PlayerReconnectedMessage;

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
}