/**
 * Brightness interaction activity.
 *
 * A poll that lands while a brightness interaction is active must not
 * replace the slider: applying it rebuilds the card, which detaches
 * the input mid-drag (the drag then sends only the value at detach
 * time) and re-enables a slider a pending write had disabled. So the
 * guard lives at poll APPLICATION, not poll start — a poll already in
 * flight when a drag begins is held until the interaction ends, then
 * applied. The auto-refresh tick's start guard alone cannot catch it.
 *
 * This module is DOM-free so it can be unit-tested; app.js wires it
 * into renderDevices and the slider handlers.
 */
export class BrightnessActivity {
  /**
   * @param {() => void} onIdle - Called when the last active device
   * clears and a render was held, so the held render can be applied.
   */
  constructor(onIdle) {
    // Devices being dragged or with a write in flight.
    this.active = new Set();
    // Devices with a write in flight. A drag-end handler must never
    // release a device that has a write in flight: a deferred poll
    // can have updated the confirmed state to the requested value,
    // which would make the value look unchanged and release the
    // device early, letting the held render detach the slider.
    this.writes = new Set();
    // A render was held while a device was active.
    this.pendingRender = false;
    this.onIdle = onIdle;
  }

  /** Number of devices with an interaction in flight. */
  get size() {
    return this.active.size;
  }

  /** Mark a device as being dragged or written. */
  markActive(deviceId) {
    this.active.add(deviceId);
  }

  /** Mark a device as having a write in flight (also marks it active). */
  beginWrite(deviceId) {
    this.writes.add(deviceId);
    this.active.add(deviceId);
  }

  /** Whether a write is in flight for a device. */
  isWriting(deviceId) {
    return this.writes.has(deviceId);
  }

  /**
   * Clear a write. Also clears the device's active flag, so a held
   * render is applied when the last active device clears.
   */
  endWrite(deviceId) {
    this.writes.delete(deviceId);
    this.clearActive(deviceId);
  }

  /**
   * Clear a device. When the last active device clears and a render
   * was held, the held render is applied via onIdle.
   */
  clearActive(deviceId) {
    this.active.delete(deviceId);
    if (this.active.size === 0 && this.pendingRender) {
      this.pendingRender = false;
      this.onIdle?.();
    }
  }

  /**
   * Asks whether a render may proceed now. Returns true when no device
   * is active. When a device is active, the render is held (recorded
   * for when the last active device clears) and false is returned.
   */
  mayRender() {
    if (this.active.size > 0) {
      this.pendingRender = true;
      return false;
    }
    return true;
  }
}
