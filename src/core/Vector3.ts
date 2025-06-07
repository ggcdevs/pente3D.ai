import { IVector3, Coordinates } from '@/types';

export class Vector3 implements IVector3 {
  public readonly x: number;
  public readonly y: number;
  public readonly z: number;

  constructor(x: number, y: number, z: number) {
    // Validate inputs
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('Vector3 coordinates must be finite numbers');
    }

    this.x = Math.round(x);
    this.y = Math.round(y);
    this.z = Math.round(z);
  }

  // Factory methods
  static create(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z);
  }

  static fromArray(coords: Coordinates): Vector3 {
    return new Vector3(coords[0], coords[1], coords[2]);
  }

  static fromObject(obj: IVector3): Vector3 {
    return new Vector3(obj.x, obj.y, obj.z);
  }

  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  // Comparison methods
  equals(other: Vector3 | IVector3): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  // Arithmetic operations (immutable)
  add(other: Vector3 | IVector3): Vector3 {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  subtract(other: Vector3 | IVector3): Vector3 {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  multiply(scalar: number): Vector3 {
    if (!Number.isFinite(scalar)) {
      throw new Error('Scalar must be a finite number');
    }
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  // Utility methods
  distance(other: Vector3 | IVector3): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize(): Vector3 {
    const mag = this.magnitude();
    if (mag === 0) {
      return Vector3.zero();
    }
    // For integer grid coordinates, return the direction vector with smallest integer components
    const factor = 1 / mag;
    return new Vector3(this.x * factor, this.y * factor, this.z * factor);
  }

  // Conversion methods
  toArray(): Coordinates {
    return [this.x, this.y, this.z];
  }

  toString(): string {
    return `Vector3(${this.x}, ${this.y}, ${this.z})`;
  }

  toJSON(): IVector3 {
    return { x: this.x, y: this.y, z: this.z };
  }

  // Immutability
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }
}
