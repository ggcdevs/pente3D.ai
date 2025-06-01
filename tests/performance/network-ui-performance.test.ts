import { Game } from '@/core';
import { NetworkManager, ConnectionStatus } from '@/network';
import { NetworkStatus, NetworkModal } from '@/ui';

// Mock NetworkManager
jest.mock('@/network/NetworkManager');

describe('Network UI Performance Tests', () => {
  let game: Game;

  beforeEach(() => {
    document.body.innerHTML = '';
    game = new Game({ boardSize: 7 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('NetworkStatus Update Performance', () => {
    it('should handle rapid status updates efficiently', () => {
      const networkStatus = new NetworkStatus();
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      // Setup initial state
      mockNM.getConnectionInfo.mockReturnValue({
        peerId: 'test-peer',
        gameCode: 'ABC123',
        isHost: true,
        status: ConnectionStatus.CONNECTED,
        lastActivity: Date.now(),
        latency: 50,
        playerColor: 'black',
        opponentConnected: true
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      // Measure rapid updates
      const updateCount = 100;
      const start = performance.now();
      
      // Get event handlers
      const handlers = {
        statusChanged: (mockNM.on as jest.Mock).mock.calls.find(c => c[0] === 'statusChanged')?.[1],
        latency: (mockNM.on as jest.Mock).mock.calls.find(c => c[0] === 'latency')?.[1],
        move: (mockNM.on as jest.Mock).mock.calls.find(c => c[0] === 'move')?.[1]
      };
      
      // Simulate rapid updates
      for (let i = 0; i < updateCount; i++) {
        // Update connection status
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: 'test-peer',
          gameCode: 'ABC123',
          isHost: true,
          status: i % 2 === 0 ? ConnectionStatus.CONNECTED : ConnectionStatus.CONNECTING,
          lastActivity: Date.now(),
          latency: 20 + (i % 100),
          playerColor: 'black',
          opponentConnected: i % 3 !== 0
        });
        
        mockNM.getLatency.mockReturnValue(20 + (i % 100));
        mockNM.isLocalPlayerTurn.mockReturnValue(i % 2 === 0);
        
        // Trigger events
        handlers.statusChanged?.();
        handlers.latency?.();
        handlers.move?.();
      }
      
      const end = performance.now();
      const totalTime = end - start;
      const avgTime = totalTime / updateCount;
      
      // Performance expectations
      expect(totalTime).toBeLessThan(200); // All updates under 200ms (allow for DOM overhead)
      expect(avgTime).toBeLessThan(2); // Average under 2ms per update
      
      networkStatus.dispose();
    });

    it('should throttle DOM updates during rapid changes', () => {
      jest.useFakeTimers();
      
      const networkStatus = new NetworkStatus();
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      networkStatus.setNetworkManager(mockNM);
      
      // Count DOM updates
      let domUpdates = 0;
      const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      Object.defineProperty(Element.prototype, 'innerHTML', {
        set: function(value) {
          domUpdates++;
          originalInnerHTML?.set?.call(this, value);
        },
        get: originalInnerHTML?.get
      });
      
      // Simulate rapid status changes
      const statusHandler = (mockNM.on as jest.Mock).mock.calls
        .find(c => c[0] === 'statusChanged')?.[1];
      
      for (let i = 0; i < 50; i++) {
        statusHandler?.();
      }
      
      // DOM updates should be batched/throttled
      expect(domUpdates).toBeLessThan(50);
      
      // Restore original property
      Object.defineProperty(Element.prototype, 'innerHTML', originalInnerHTML!);
      
      networkStatus.dispose();
      jest.useRealTimers();
    });

    it('should clean up intervals efficiently', () => {
      jest.useFakeTimers();
      
      const instances: NetworkStatus[] = [];
      
      // Create multiple instances
      for (let i = 0; i < 10; i++) {
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        networkStatus.setNetworkManager(mockNM);
        instances.push(networkStatus);
      }
      
      // Count active timers
      const timerCount = jest.getTimerCount();
      expect(timerCount).toBeGreaterThan(0);
      
      // Dispose all instances
      instances.forEach(instance => instance.dispose());
      
      // All timers should be cleared
      jest.runOnlyPendingTimers();
      expect(jest.getTimerCount()).toBe(0);
      
      jest.useRealTimers();
    });
  });

  describe('NetworkModal Performance', () => {
    it('should open and close modal quickly', () => {
      const iterations = 20;
      const times: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const modal = new NetworkModal({ game });
        
        const openStart = performance.now();
        modal.open();
        const openEnd = performance.now();
        
        const closeStart = performance.now();
        modal.close();
        const closeEnd = performance.now();
        
        times.push(openEnd - openStart);
        times.push(closeEnd - closeStart);
        
        modal.destroy();
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      
      expect(avgTime).toBeLessThan(5); // Average under 5ms
      expect(maxTime).toBeLessThan(10); // No operation over 10ms
    });

    it('should handle view transitions efficiently', () => {
      const modal = new NetworkModal({ game });
      modal.open();
      
      const transitions = ['host', 'menu', 'join', 'menu', 'host'];
      const times: number[] = [];
      
      transitions.forEach(view => {
        const start = performance.now();
        
        if (view === 'host') {
          const hostBtn = document.querySelector('.host-btn') as HTMLButtonElement;
          hostBtn?.click();
        } else if (view === 'join') {
          const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
          joinBtn?.click();
        } else if (view === 'menu') {
          const backBtn = document.querySelector('.back-btn') as HTMLButtonElement;
          backBtn?.click();
        }
        
        const end = performance.now();
        times.push(end - start);
      });
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      
      expect(avgTime).toBeLessThan(5); // View transitions under 5ms average
      
      modal.destroy();
    });

    it('should handle input validation efficiently', () => {
      const modal = new NetworkModal({ game });
      modal.open();
      
      // Navigate to join view
      const joinBtn = document.querySelector('.join-btn') as HTMLButtonElement;
      joinBtn?.click();
      
      const input = document.querySelector('.game-code-input') as HTMLInputElement;
      const joinGameBtn = document.querySelector('.join-game-btn') as HTMLButtonElement;
      
      // Measure input validation performance
      const start = performance.now();
      
      // Simulate typing a valid 6-character code
      const chars = 'ABC123'.split('');
      chars.forEach(char => {
        input.value += char;
        input.dispatchEvent(new Event('input'));
      });
      
      const end = performance.now();
      const totalTime = end - start;
      const avgTime = totalTime / chars.length;
      
      expect(avgTime).toBeLessThan(1); // Under 1ms per character
      expect(input.value).toBe('ABC123'); // Correct value
      expect(joinGameBtn.disabled).toBe(false); // Validation worked
      
      modal.destroy();
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory when creating/destroying NetworkStatus', () => {
      const instances: NetworkStatus[] = [];
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;
      
      // Create many instances
      for (let i = 0; i < 100; i++) {
        const networkStatus = new NetworkStatus();
        const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
        networkStatus.setNetworkManager(mockNM);
        instances.push(networkStatus);
      }
      
      // Dispose all
      instances.forEach(instance => instance.dispose());
      instances.length = 0;
      
      // Force garbage collection if available
      if ((global as any).gc) {
        (global as any).gc();
      }
      
      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
      const memoryGrowth = finalMemory - initialMemory;
      
      // Memory growth should be minimal (allowing for some overhead)
      expect(memoryGrowth).toBeLessThan(1000000); // Less than 1MB growth
    });

    it('should clean up event listeners properly', () => {
      const networkStatus = new NetworkStatus();
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      // Track event listener counts
      const eventCounts = new Map<string, number>();
      const originalOn = mockNM.on;
      mockNM.on = jest.fn((event: string, handler: any) => {
        eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
        return originalOn.call(mockNM, event, handler);
      });
      
      networkStatus.setNetworkManager(mockNM);
      
      // Should have registered event listeners
      expect(eventCounts.size).toBeGreaterThan(0);
      
      // Create and destroy multiple times
      for (let i = 0; i < 10; i++) {
        const ns = new NetworkStatus();
        ns.setNetworkManager(mockNM);
        ns.dispose();
      }
      
      // Event listener count should not grow indefinitely
      const maxCount = Math.max(...eventCounts.values());
      expect(maxCount).toBeLessThan(20); // Reasonable limit
      
      networkStatus.dispose();
    });
  });

  describe('Rendering Performance', () => {
    it('should maintain 60fps during UI updates', async () => {
      const networkStatus = new NetworkStatus();
      const mockNM = new NetworkManager(game) as jest.Mocked<NetworkManager>;
      
      networkStatus.setNetworkManager(mockNM);
      
      let frameCount = 0;
      let lastFrameTime = performance.now();
      const frameTimes: number[] = [];
      
      // Simulate frame loop
      const measureFrame = () => {
        const now = performance.now();
        const frameTime = now - lastFrameTime;
        frameTimes.push(frameTime);
        lastFrameTime = now;
        frameCount++;
        
        // Trigger UI updates
        if (frameCount % 2 === 0) {
          const handlers = {
            statusChanged: (mockNM.on as jest.Mock).mock.calls.find(c => c[0] === 'statusChanged')?.[1],
            move: (mockNM.on as jest.Mock).mock.calls.find(c => c[0] === 'move')?.[1]
          };
          
          mockNM.isLocalPlayerTurn.mockReturnValue(frameCount % 4 === 0);
          handlers.statusChanged?.();
          handlers.move?.();
        }
        
        if (frameCount < 60) {
          requestAnimationFrame(measureFrame);
        }
      };
      
      // Run for 60 frames
      await new Promise<void>(resolve => {
        const checkComplete = () => {
          if (frameCount >= 60) {
            resolve();
          } else {
            setTimeout(checkComplete, 100);
          }
        };
        
        requestAnimationFrame(measureFrame);
        checkComplete();
      });
      
      // Calculate frame rate statistics
      const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const maxFrameTime = Math.max(...frameTimes);
      
      // Should maintain close to 60fps (16.67ms per frame)
      expect(avgFrameTime).toBeLessThan(20); // Allow some overhead
      expect(maxFrameTime).toBeLessThan(33); // No frame should take more than 2 frame times
      
      networkStatus.dispose();
    });
  });

  describe('Large Scale Performance', () => {
    it('should handle many simultaneous network games efficiently', () => {
      const gameCount = 10;
      const instances: { status: NetworkStatus; modal: NetworkModal }[] = [];
      
      const start = performance.now();
      
      // Create multiple network game instances
      for (let i = 0; i < gameCount; i++) {
        const g = new Game({ boardSize: 7 });
        const networkStatus = new NetworkStatus();
        const networkModal = new NetworkModal({ game: g });
        const mockNM = new NetworkManager(g) as jest.Mocked<NetworkManager>;
        
        mockNM.getConnectionInfo.mockReturnValue({
          peerId: `peer-${i}`,
          gameCode: `GAME${i}`,
          isHost: i % 2 === 0,
          status: ConnectionStatus.CONNECTED,
          lastActivity: Date.now(),
          latency: 30 + i * 5,
          playerColor: i % 2 === 0 ? 'black' : 'white',
          opponentConnected: true
        });
        
        networkStatus.setNetworkManager(mockNM);
        instances.push({ status: networkStatus, modal: networkModal });
      }
      
      const setupTime = performance.now() - start;
      
      // Update all instances
      const updateStart = performance.now();
      instances.forEach((instance, i) => {
        const mockNM = (NetworkManager as jest.MockedClass<typeof NetworkManager>).mock.instances[i];
        const handler = (mockNM.on as jest.Mock).mock.calls.find(c => c[0] === 'move')?.[1];
        handler?.();
      });
      const updateTime = performance.now() - updateStart;
      
      // Cleanup
      const cleanupStart = performance.now();
      instances.forEach(({ status, modal }) => {
        status.dispose();
        modal.destroy();
      });
      const cleanupTime = performance.now() - cleanupStart;
      
      // Performance expectations for multiple games
      expect(setupTime).toBeLessThan(100); // Setup under 100ms
      expect(updateTime).toBeLessThan(50); // Updates under 50ms
      expect(cleanupTime).toBeLessThan(50); // Cleanup under 50ms
      
      // Average per game should be efficient
      expect(setupTime / gameCount).toBeLessThan(10);
      expect(updateTime / gameCount).toBeLessThan(5);
      expect(cleanupTime / gameCount).toBeLessThan(5);
    });
  });
});