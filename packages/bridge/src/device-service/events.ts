/**
 * Lightweight typed event emitter for DeviceService.
 */

import type { DeviceServiceEventMap } from "./types";

type Handler<T> = (payload: T) => void;

/**
 * Minimal event bus used by DeviceService so integrations can subscribe
 * without depending on Node's EventEmitter.
 */
export class DeviceEventBus {
  private listeners = new Map<keyof DeviceServiceEventMap, Set<Handler<unknown>>>();

  on<K extends keyof DeviceServiceEventMap>(
    event: K,
    handler: Handler<DeviceServiceEventMap[K]>
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => {
      set?.delete(handler as Handler<unknown>);
    };
  }

  emit<K extends keyof DeviceServiceEventMap>(event: K, payload: DeviceServiceEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[DeviceService] Event handler error for ${event}:`, error);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
