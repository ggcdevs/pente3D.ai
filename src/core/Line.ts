import { ILine, IVector3 } from '@/types';
import { Vector3 } from './Vector3';

export class Line implements ILine {
  private readonly _coords: Vector3[];
  public readonly direction: Vector3;
  public readonly isComplete: boolean;

  get coords(): Vector3[] {
    return [...this._coords]; // Return a copy to ensure immutability
  }

  constructor(coords: (Vector3 | IVector3)[], direction: Vector3 | IVector3) {
    // Validation
    if (!coords || coords.length === 0) {
      throw new Error('Line must have at least one coordinate');
    }

    if (!direction) {
      throw new Error('Line direction is required');
    }

    // Convert to Vector3 instances
    this._coords = coords.map((coord) =>
      coord instanceof Vector3 ? coord : Vector3.fromObject(coord)
    );

    this.direction = direction instanceof Vector3 ? direction : Vector3.fromObject(direction);

    // A complete line has exactly 5 coordinates
    this.isComplete = this._coords.length === 5;

    // Validate line continuity
    this.validateContinuity();
  }

  // Factory methods
  static fromCoords(coords: (Vector3 | IVector3)[]): Line {
    if (coords.length < 2) {
      throw new Error('Need at least 2 coordinates to determine direction');
    }

    const first = coords[0] instanceof Vector3 ? coords[0] : Vector3.fromObject(coords[0]);
    const second = coords[1] instanceof Vector3 ? coords[1] : Vector3.fromObject(coords[1]);
    const direction = second.subtract(first);

    return new Line(coords, direction);
  }

  // Validation
  private validateContinuity(): void {
    if (this._coords.length < 2) return;

    for (let i = 1; i < this._coords.length; i++) {
      const expected = this._coords[0].add(this.direction.multiply(i));
      if (!this._coords[i].equals(expected)) {
        throw new Error(`Line is not continuous at index ${i}`);
      }
    }
  }

  // Query methods
  contains(coord: Vector3 | IVector3): boolean {
    const target = coord instanceof Vector3 ? coord : Vector3.fromObject(coord);
    return this._coords.some((c) => c.equals(target));
  }

  getLength(): number {
    return this._coords.length;
  }

  getStart(): Vector3 {
    return this._coords[0];
  }

  getEnd(): Vector3 {
    return this._coords[this._coords.length - 1];
  }

  // Extend the line by one position in the positive direction
  extend(): Line | null {
    const nextCoord = this.getEnd().add(this.direction);
    return new Line([...this._coords, nextCoord], this.direction);
  }

  // Extend the line by one position in the negative direction
  extendBackward(): Line | null {
    const prevCoord = this.getStart().subtract(this.direction);
    return new Line([prevCoord, ...this._coords], this.direction);
  }

  // Check if this line is a subset of another line
  isSubsetOf(other: Line): boolean {
    if (!this.direction.equals(other.direction)) {
      return false;
    }
    return this.coords.every((coord) => other.contains(coord));
  }

  // Utility methods
  toString(): string {
    const coordStr = this._coords.map((c) => c.toString()).join(' -> ');
    return `Line(${coordStr})`;
  }

  toJSON(): ILine {
    return {
      coords: this._coords.map((c) => c.toJSON()),
      direction: this.direction.toJSON(),
      isComplete: this.isComplete,
    };
  }

  clone(): Line {
    return new Line(
      this._coords.map((c) => c.clone()),
      this.direction.clone()
    );
  }

  equals(other: Line): boolean {
    if (this._coords.length !== other._coords.length) return false;
    if (!this.direction.equals(other.direction)) return false;

    return this._coords.every((coord, index) => coord.equals(other._coords[index]));
  }

  get positions(): Vector3[] {
    return this._coords;
  }

  static fromJSON(json: any): Line {
    if (!json || typeof json !== 'object') {
      throw new Error('Invalid JSON for Line');
    }

    return new Line(
      json.coords.map((c: any) => Vector3.fromObject(c)),
      Vector3.fromObject(json.direction)
    );
  }
}
