import { ObjectPool, Poolable } from '@/utils/ObjectPool';

class TestObject implements Poolable {
  public value: number = 0;
  public active: boolean = true;
  
  reset(): void {
    this.value = 0;
    this.active = true;
  }
}

describe('ObjectPool', () => {
  let pool: ObjectPool<TestObject>;
  
  beforeEach(() => {
    pool = new ObjectPool(() => new TestObject());
  });
  
  describe('Constructor', () => {
    test('should create empty pool by default', () => {
      expect(pool.getPoolSize()).toBe(0);
      expect(pool.getActiveCount()).toBe(0);
    });
    
    test('should pre-allocate objects if specified', () => {
      const preAllocatedPool = new ObjectPool(() => new TestObject(), {
        preAllocateSize: 10
      });
      
      expect(preAllocatedPool.getPoolSize()).toBe(10);
      expect(preAllocatedPool.getActiveCount()).toBe(0);
    });
    
    test('should accept max size option', () => {
      const limitedPool = new ObjectPool(() => new TestObject(), {
        maxSize: 5
      });
      
      // Acquire and release more than max
      const objects: TestObject[] = [];
      for (let i = 0; i < 10; i++) {
        objects.push(limitedPool.acquire());
      }
      
      objects.forEach(obj => limitedPool.release(obj));
      
      expect(limitedPool.getPoolSize()).toBe(5);
    });
  });
  
  describe('Acquire', () => {
    test('should create new object when pool is empty', () => {
      const obj = pool.acquire();
      expect(obj).toBeInstanceOf(TestObject);
      expect(pool.getActiveCount()).toBe(1);
    });
    
    test('should reuse object from pool', () => {
      const obj1 = pool.acquire();
      obj1.value = 42;
      pool.release(obj1);
      
      const obj2 = pool.acquire();
      expect(obj2).toBe(obj1);
      expect(obj2.value).toBe(0); // Should be reset
    });
    
    test('should track active objects', () => {
      const obj1 = pool.acquire();
      const obj2 = pool.acquire();
      
      expect(pool.getActiveCount()).toBe(2);
      expect(pool.getTotalCount()).toBe(2);
    });
  });
  
  describe('Release', () => {
    test('should return object to pool', () => {
      const obj = pool.acquire();
      pool.release(obj);
      
      expect(pool.getPoolSize()).toBe(1);
      expect(pool.getActiveCount()).toBe(0);
    });
    
    test('should reset object when released', () => {
      const obj = pool.acquire();
      obj.value = 100;
      obj.active = false;
      
      pool.release(obj);
      
      expect(obj.value).toBe(0);
      expect(obj.active).toBe(true);
    });
    
    test('should warn when releasing non-pool object', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const nonPoolObject = new TestObject();
      
      pool.release(nonPoolObject);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Attempting to release object not from this pool'
      );
      
      consoleSpy.mockRestore();
    });
    
    test('should respect max pool size', () => {
      const limitedPool = new ObjectPool(() => new TestObject(), {
        maxSize: 2
      });
      
      const objects = [
        limitedPool.acquire(),
        limitedPool.acquire(),
        limitedPool.acquire()
      ];
      
      objects.forEach(obj => limitedPool.release(obj));
      
      expect(limitedPool.getPoolSize()).toBe(2);
    });
  });
  
  describe('Release All', () => {
    test('should release all active objects', () => {
      const objects = [
        pool.acquire(),
        pool.acquire(),
        pool.acquire()
      ];
      
      objects[0].value = 1;
      objects[1].value = 2;
      objects[2].value = 3;
      
      pool.releaseAll();
      
      expect(pool.getActiveCount()).toBe(0);
      expect(pool.getPoolSize()).toBe(3);
      
      // Check all objects were reset
      objects.forEach(obj => {
        expect(obj.value).toBe(0);
      });
    });
  });
  
  describe('Clear', () => {
    test('should clear pool and active objects', () => {
      pool.acquire();
      pool.acquire();
      const obj = pool.acquire();
      pool.release(obj);
      
      pool.clear();
      
      expect(pool.getPoolSize()).toBe(0);
      expect(pool.getActiveCount()).toBe(0);
      expect(pool.getTotalCount()).toBe(0);
    });
  });
});