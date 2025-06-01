export class EventEmitter {
  private events: Map<string, Array<(...args: any[]) => void>> = new Map();

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    if (!this.events.has(event)) {
      return false;
    }
    
    const listeners = this.events.get(event)!;
    for (const listener of listeners) {
      listener(...args);
    }
    return true;
  }

  off(event: string, listenerToRemove: (...args: any[]) => void): this {
    if (!this.events.has(event)) {
      return this;
    }
    
    const listeners = this.events.get(event)!;
    this.events.set(
      event, 
      listeners.filter(listener => listener !== listenerToRemove)
    );
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }
}