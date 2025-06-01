import { Move } from '@/core';

export enum MessageType {
  MOVE = 'move',
  UNDO = 'undo',
  REDO = 'redo',
  RESET = 'reset',
  SYNC_REQUEST = 'sync_request',
  SYNC_RESPONSE = 'sync_response',
  PING = 'ping',
  PONG = 'pong',
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

export type NetworkMessageTypes = 
  | MoveMessage
  | UndoMessage
  | RedoMessage
  | ResetMessage
  | SyncRequestMessage
  | SyncResponseMessage
  | PingMessage
  | PongMessage;

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
}