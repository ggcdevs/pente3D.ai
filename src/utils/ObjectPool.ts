export interface Poolable {
  reset(): void;
}

export class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private activeObjects: Set<T> = new Set();
  private factory: () => T;
  private maxSize: number;
  private preAllocateSize: number;
  
  constructor(
    factory: () => T,
    options: {
      maxSize?: number;
      preAllocateSize?: number;
    } = {}
  ) {
    this.factory = factory;
    this.maxSize = options.maxSize || 1000;
    this.preAllocateSize = options.preAllocateSize || 0;
    
    // Pre-allocate objects
    for (let i = 0; i < this.preAllocateSize; i++) {
      this.pool.push(this.factory());
    }
  }
  
  public acquire(): T {
    let obj: T;
    
    if (this.pool.length > 0) {
      obj = this.pool.pop()!;
    } else {
      obj = this.factory();
    }
    
    this.activeObjects.add(obj);
    return obj;
  }
  
  public release(obj: T): void {
    if (!this.activeObjects.has(obj)) {
      console.warn('Attempting to release object not from this pool');
      return;
    }
    
    this.activeObjects.delete(obj);
    obj.reset();
    
    if (this.pool.length < this.maxSize) {
      this.pool.push(obj);
    }
  }
  
  public releaseAll(): void {
    this.activeObjects.forEach(obj => {
      obj.reset();
      if (this.pool.length < this.maxSize) {
        this.pool.push(obj);
      }
    });
    this.activeObjects.clear();
  }
  
  public clear(): void {
    this.pool = [];
    this.activeObjects.clear();
  }
  
  public getPoolSize(): number {
    return this.pool.length;
  }
  
  public getActiveCount(): number {
    return this.activeObjects.size;
  }
  
  public getTotalCount(): number {
    return this.pool.length + this.activeObjects.size;
  }
}