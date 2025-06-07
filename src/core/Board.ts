import { DIRECTIONS_3D, type IBoard, type IPiece, type IVector3, type BoardSize, type CoordKey } from '@/types';
import { Vector3 } from './Vector3';
import { Piece } from './Piece';
import { Line } from './Line';
import { Player } from './Player';
import { SerializationError } from '@/utils';

export class Board implements IBoard {
  public readonly size: BoardSize;
  private readonly _pieces: Map<string, Piece>;

  constructor(size: BoardSize = 7) {
    // Validate size
    if (![7, 9, 11].includes(size)) {
      throw new Error('Board size must be 7, 9, or 11');
    }

    this.size = size;
    this._pieces = new Map();
  }

  // Factory methods
  static createEmpty(size: BoardSize = 7): Board {
    return new Board(size);
  }

  getSize(): BoardSize {
    return this.size;
  }

  static fromPieces(pieces: (Piece | IPiece)[], size: BoardSize = 7): Board {
    let board = new Board(size);
    pieces.forEach((piece) => {
      board = board.placePiece(piece);
    });
    return board;
  }

  // Coordinate key management
  private coordToKey(coord: Vector3 | IVector3): CoordKey {
    const v = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    return `${v.x},${v.y},${v.z}`;
  }

  // private keyToCoord(key: CoordKey): Vector3 {
  //   const [x, y, z] = key.split(',').map(Number);
  //   return new Vector3(x, y, z);
  // }

  // Board state queries
  get pieces(): Map<string, IPiece> {
    const result = new Map<string, IPiece>();
    this._pieces.forEach((piece, key) => {
      result.set(key, piece.toJSON());
    });
    return result;
  }

  getPiece(coord: Vector3 | IVector3): Piece | null {
    const key = this.coordToKey(coord);
    return this._pieces.get(key) || null;
  }

  hasPiece(coord: Vector3 | IVector3): boolean {
    return this.getPiece(coord) !== null;
  }

  isEmpty(coord: Vector3 | IVector3): boolean {
    return !this.hasPiece(coord);
  }

  getPieceCount(): number {
    return this._pieces.size;
  }

  getAllPieces(): Piece[] {
    return Array.from(this._pieces.values());
  }

  // Board bounds checking
  isInBounds(coord: Vector3 | IVector3): boolean {
    const v = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    const halfSize = Math.floor(this.size / 2);

    return (
      v.x >= -halfSize &&
      v.x <= halfSize &&
      v.y >= -halfSize &&
      v.y <= halfSize &&
      v.z >= -halfSize &&
      v.z <= halfSize
    );
  }

  // Moore neighborhood (26 neighbors in 3D)
  getNeighbors(coord: Vector3 | IVector3): Vector3[] {
    const center = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    const neighbors: Vector3[] = [];

    DIRECTIONS_3D.forEach((dir) => {
      const neighbor = center.add(dir);
      if (this.isInBounds(neighbor)) {
        neighbors.push(neighbor);
      }
    });

    return neighbors;
  }

  // Line generation methods
  generateFullLine(start: Vector3 | IVector3, end: Vector3 | IVector3): Line | null {
    const startVec = start instanceof Vector3 ? start : Vector3.fromObject(start);
    const endVec = end instanceof Vector3 ? end : Vector3.fromObject(end);

    // Validate both points are in bounds
    if (!this.isInBounds(startVec) || !this.isInBounds(endVec)) {
      return null;
    }

    // Handle same start and end
    if (startVec.equals(endVec)) {
      return new Line([startVec], new Vector3(1, 0, 0)); // arbitrary direction
    }

    // Calculate direction
    const diff = endVec.subtract(startVec);

    // Check if points are collinear in a valid 3D direction
    const isValidDirection = DIRECTIONS_3D.some((dir) => {
      const scale = this.getScaleFactor(diff, dir);
      return scale !== null && scale > 0;
    });

    if (!isValidDirection) {
      return null;
    }

    // Generate all points on the line
    const coords: Vector3[] = [];
    const direction = this.normalizeDirection(diff);
    let current = startVec.clone();

    while (!current.equals(endVec)) {
      coords.push(current.clone());
      current = current.add(direction);

      // Safety check to prevent infinite loops
      if (coords.length > this.size) {
        return null;
      }
    }
    coords.push(endVec);

    return new Line(coords, direction);
  }

  generatePartialLine(
    center: Vector3 | IVector3,
    direction: Vector3 | IVector3,
    radius: number = 2
  ): Line {
    const centerVec = center instanceof Vector3 ? center : Vector3.fromObject(center);
    const dirVec = direction instanceof Vector3 ? direction : Vector3.fromObject(direction);

    // Normalize direction to unit vector
    const unitDir = this.normalizeDirection(dirVec);
    const coords: Vector3[] = [];

    // Generate line from -radius to +radius around center
    for (let i = -radius; i <= radius; i++) {
      const point = centerVec.add(unitDir.multiply(i));
      if (this.isInBounds(point)) {
        coords.push(point);
      }
    }

    // Ensure we have at least one coordinate
    if (coords.length === 0) {
      coords.push(centerVec);
    }

    return new Line(coords, unitDir);
  }

  // Get all possible lines of length 5 containing a given coordinate
  getLinesContaining(coord: Vector3 | IVector3, length: number = 5): Line[] {
    const center = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    const lines: Line[] = [];

    DIRECTIONS_3D.forEach((dir) => {
      // For each direction, generate all possible lines containing the coord
      for (let offset = 0; offset < length; offset++) {
        const dirVec = Vector3.fromObject(dir);
        const start = center.subtract(dirVec.multiply(offset));
        const end = start.add(dirVec.multiply(length - 1));

        // Check if line is within bounds
        if (this.isInBounds(start) && this.isInBounds(end)) {
          const line = this.generateFullLine(start, end);
          if (line && line.getLength() === length) {
            lines.push(line);
          }
        }
      }
    });

    return this.removeDuplicateLines(lines);
  }

  // Helper methods
  private normalizeDirection(direction: IVector3): Vector3 {
    // Find the matching unit direction from DIRECTIONS_3D
    for (const dir of DIRECTIONS_3D) {
      const scale = this.getScaleFactor(direction, dir);
      if (scale !== null && scale > 0) {
        return Vector3.fromObject(dir);
      }
    }

    // If no exact match, normalize to unit vector
    const vec = Vector3.fromObject(direction);
    const magnitude = Math.max(Math.abs(vec.x), Math.abs(vec.y), Math.abs(vec.z));
    return new Vector3(
      Math.round(vec.x / magnitude),
      Math.round(vec.y / magnitude),
      Math.round(vec.z / magnitude)
    );
  }

  private getScaleFactor(vector: IVector3, unitVector: IVector3): number | null {
    // Check if vector is a scalar multiple of unitVector
    const scales: number[] = [];
    let scale: number | null = null;

    // Check each component
    if (unitVector.x !== 0) {
      scale = vector.x / unitVector.x;
      scales.push(scale);
    } else if (vector.x !== 0) {
      return null; // Vector has non-zero component where unit vector is zero
    }

    if (unitVector.y !== 0) {
      scale = vector.y / unitVector.y;
      scales.push(scale);
    } else if (vector.y !== 0) {
      return null;
    }

    if (unitVector.z !== 0) {
      scale = vector.z / unitVector.z;
      scales.push(scale);
    } else if (vector.z !== 0) {
      return null;
    }

    // All scales must be equal
    if (scales.length === 0) {
      return null;
    }
    const firstScale = scales[0];

    const allEqual = scales.every((s) => Math.abs(s - firstScale) < 0.0001);
    return allEqual ? firstScale : null;
  }

  private removeDuplicateLines(lines: Line[]): Line[] {
    const uniqueLines: Line[] = [];

    for (const line of lines) {
      const isDuplicate = uniqueLines.some(
        (existing) =>
          existing.getStart().equals(line.getStart()) && existing.getEnd().equals(line.getEnd())
      );

      if (!isDuplicate) {
        uniqueLines.push(line);
      }
    }

    return uniqueLines;
  }

  // Board mutations (return new Board instance)
  placePiece(piece: Piece | IPiece): Board {
    const p = piece instanceof Piece ? piece : Piece.createNormal(piece.coords, piece.player);

    if (!this.isInBounds(p.coords)) {
      throw new Error('Piece placement out of bounds');
    }

    if (this.hasPiece(p.coords)) {
      throw new Error('Position already occupied');
    }

    const newBoard = this.clone();
    newBoard._pieces.set(newBoard.coordToKey(p.coords), p);
    return newBoard;
  }

  removePiece(coord: Vector3 | IVector3): Board {
    if (!this.hasPiece(coord)) {
      return this;
    }

    const newBoard = this.clone();
    newBoard._pieces.delete(newBoard.coordToKey(coord));
    return newBoard;
  }

  // Utility methods
  clear(): Board {
    return new Board(this.size);
  }

  equals(other: Board): boolean {
    if (this.size !== other.size) {
      return false;
    }
    if (this._pieces.size !== other._pieces.size) {
      return false;
    }

    for (const [key, piece] of this._pieces) {
      const otherPiece = other._pieces.get(key);
      if (!otherPiece || !piece.equals(otherPiece)) {
        return false;
      }
    }

    return true;
  }

  clone(): Board {
    const newBoard = new Board(this.size);
    this._pieces.forEach((piece, key) => {
      newBoard._pieces.set(key, piece.clone());
    });
    return newBoard;
  }

  toString(): string {
    return `Board(${this.size}x${this.size}x${this.size}, ${this._pieces.size} pieces)`;
  }

  toJSON(): IBoard {
    return {
      size: this.size,
      pieces: this.pieces,
    };
  }

  // Extended methods for game rules

  /**
   * Gets the piece at a given position
   * @param position Position to check
   * @returns Piece at position or null
   */
  getPieceAt(position: Vector3 | IVector3): Piece | null {
    return this.getPiece(position);
  }

  /**
   * Places a piece by position and player ID
   * @param position Position to place piece
   * @param playerId Player ID
   * @param isTemporary Whether piece is temporary
   * @returns New board with piece placed
   */
  placePieceByPlayer(
    position: Vector3 | IVector3,
    playerId: string,
    isTemporary: boolean = false
  ): Board {
    // Create a minimal player object for the piece
    const player = Player.createLocal(playerId, 'white');
    const piece = isTemporary
      ? Piece.createTemporary(position, player)
      : Piece.createNormal(position, player);
    return this.placePiece(piece);
  }

  /**
   * Gets all lines passing through a position
   * @param position Position to check
   * @returns Array of lines through the position
   */
  getLinesAtPosition(position: Vector3 | IVector3): Line[] {
    const pos = position instanceof Vector3 ? position : Vector3.fromObject(position);
    const lines: Line[] = [];

    // For each of the 13 unique directions (half of 26)
    const halfDirections = DIRECTIONS_3D.filter(
      (dir) => dir.x > 0 || (dir.x === 0 && dir.y > 0) || (dir.x === 0 && dir.y === 0 && dir.z > 0)
    );

    for (const dir of halfDirections) {
      const line = this.buildLineAtPosition(pos, Vector3.fromObject(dir));
      if (line && line.positions.length > 1) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Gets pieces in a specific direction from a position
   * @param position Starting position
   * @param direction Direction vector
   * @param maxDistance Maximum distance to check
   * @returns Array of pieces in order
   */
  getPiecesInDirection(
    position: Vector3 | IVector3,
    direction: Vector3 | IVector3,
    maxDistance: number
  ): (Piece | null)[] {
    const pos = position instanceof Vector3 ? position : Vector3.fromObject(position);
    const dir = direction instanceof Vector3 ? direction : Vector3.fromObject(direction);
    const pieces: (Piece | null)[] = [];

    for (let i = 1; i <= maxDistance; i++) {
      const checkPos = pos.add(dir.multiply(i));
      if (!this.isInBounds(checkPos)) {
        break;
      }
      pieces.push(this.getPieceAt(checkPos));
    }

    return pieces;
  }

  /**
   * Counts consecutive pieces of same player
   * @param position Starting position
   * @param direction Direction to count
   * @param playerId Player to match
   * @returns Count of consecutive pieces
   */
  countConsecutive(
    position: Vector3 | IVector3,
    direction: Vector3 | IVector3,
    playerId: string
  ): number {
    const pos = position instanceof Vector3 ? position : Vector3.fromObject(position);
    const dir = direction instanceof Vector3 ? direction : Vector3.fromObject(direction);
    let count = 0;

    let current = pos.add(dir);
    while (this.isInBounds(current)) {
      const piece = this.getPieceAt(current);
      if (piece && piece.playerId === playerId) {
        count++;
        current = current.add(dir);
      } else {
        break;
      }
    }

    return count;
  }

  /**
   * Builds a line at a position in a given direction
   * @param position Center position
   * @param direction Direction to build line
   * @returns Line object
   */
  private buildLineAtPosition(position: Vector3, direction: Vector3): Line {
    const positions: Vector3[] = [];

    // Go backwards first
    const negDir = direction.multiply(-1);
    let current = position.add(negDir);
    const backwardPositions: Vector3[] = [];

    while (this.isInBounds(current)) {
      backwardPositions.unshift(current.clone());
      current = current.add(negDir);
    }

    positions.push(...backwardPositions);
    positions.push(position);

    // Go forwards
    current = position.add(direction);

    while (this.isInBounds(current)) {
      positions.push(current.clone());
      current = current.add(direction);
    }

    return new Line(positions, direction);
  }

  /**
   * Creates Board from JSON
   * @param json JSON object
   * @returns New board
   */
  static fromJSON(json: unknown): Board {
    if (!json || typeof json !== 'object' || json === null) {
      throw new SerializationError('Invalid JSON for Board', 'Board');
    }

    const boardData = json as { size?: unknown; pieces?: unknown };
    
    if (typeof boardData.size !== 'number' || ![7, 9, 11].includes(boardData.size)) {
      throw new SerializationError('Invalid board size in JSON', 'Board', { size: boardData.size });
    }

    const board = new Board(boardData.size as BoardSize);

    if (boardData.pieces instanceof Map) {
      boardData.pieces.forEach((pieceData: unknown, key: string) => {
        board._pieces.set(key, Piece.fromJSON(pieceData));
      });
    } else if (boardData.pieces && typeof boardData.pieces === 'object') {
      Object.entries(boardData.pieces).forEach(([key, pieceData]) => {
        board._pieces.set(key, Piece.fromJSON(pieceData));
      });
    }

    return board;
  }
}
