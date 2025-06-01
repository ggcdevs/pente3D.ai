import { ObjectPool, Poolable } from '@/utils/ObjectPool';

class TestPoolObject implements Poolable {
  data: Float32Array;
  
  constructor() {
    this.data = new Float32Array(1000);
  }
  
  reset(): void {
    this.data.fill(0);
  }
}

describe('ObjectPool Performance', () => {
  test('should be faster than creating new objects', () => {
    const pool = new ObjectPool(() => new TestPoolObject(), {
      preAllocateSize: 100
    });
    
    // Measure pooled performance
    const poolStart = performance.now();
    const pooledObjects: TestPoolObject[] = [];
    
    for (let i = 0; i < 1000; i++) {
      const obj = pool.acquire();
      pooledObjects.push(obj);
    }
    
    pooledObjects.forEach(obj => pool.release(obj));
    
    const poolTime = performance.now() - poolStart;
    
    // Measure non-pooled performance
    const nonPoolStart = performance.now();
    const nonPooledObjects: TestPoolObject[] = [];
    
    for (let i = 0; i < 1000; i++) {
      nonPooledObjects.push(new TestPoolObject());
    }
    
    const nonPoolTime = performance.now() - nonPoolStart;
    
    // Pool should be significantly faster
    expect(poolTime).toBeLessThan(nonPoolTime * 0.5);
  });
  
  test('should handle high-frequency acquire/release', () => {
    const pool = new ObjectPool(() => new TestPoolObject(), {
      maxSize: 50
    });
    
    const start = performance.now();
    
    // Simulate high-frequency usage
    for (let i = 0; i < 10000; i++) {
      const obj = pool.acquire();
      // Simulate some work
      obj.data[0] = i;
      pool.release(obj);
    }
    
    const elapsed = performance.now() - start;
    
    // Should complete quickly
    expect(elapsed).toBeLessThan(100);
    expect(pool.getPoolSize()).toBeLessThanOrEqual(50);
  });
  
  test('should maintain stable memory usage', () => {
    const pool = new ObjectPool(() => new TestPoolObject(), {
      maxSize: 100,
      preAllocateSize: 50
    });
    
    const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;
    
    // Simulate extended usage
    for (let cycle = 0; cycle < 100; cycle++) {
      const objects: TestPoolObject[] = [];
      
      // Acquire many objects
      for (let i = 0; i < 20; i++) {
        objects.push(pool.acquire());
      }
      
      // Release them
      objects.forEach(obj => pool.release(obj));
    }
    
    const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
    const memoryGrowth = finalMemory - initialMemory;
    
    // Memory growth should be minimal
    expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024); // Less than 10MB growth
  });
});