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
 * Two layers, because neither alone is enough. The epoch drops a poll
 * whose data predates the interaction (it started before the latest
 * drag or write), so stale data never lands in the device list. The
 * render guard holds a poll that started during the interaction (its
 * data is current, but rebuilding the card would still detach the
 * slider). A write that times out discards the held render instead of
 * flushing it: the held data predates the write, and flushing it would
 * revert the slider to the pre-write value even though the write's
 * outcome is unknown. The next poll then reconciles.
 *
 * This module is DOM-free so it can be unit-tested; app.js wires it
 * into renderDevices, loadDevices, and the slider handlers.
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
    // Interaction epoch. Advances whenever a drag or write starts, so
    // a poll can tell whether its data predates the latest interaction.
    this.epoch = 0;
    this.onIdle = onIdle;
  }

  /** Number of devices with an interaction in flight. */
  get size() {
    return this.active.size;
  }

  /** Mark a device as being dragged or written. */
  markActive(deviceId) {
    this.active.add(deviceId);
    this.epoch++;
  }

  /** Mark a device as having a write in flight (also marks it active). */
  beginWrite(deviceId) {
    this.writes.add(deviceId);
    this.active.add(deviceId);
    this.epoch++;
  }

  /** Whether a write is in flight for a device. */
  isWriting(deviceId) {
    return this.writes.has(deviceId);
  }

  /**
   * Whether a poll that captured `pollEpoch` at its start is stale:
   * an interaction started while it was in flight, so its data
   * predates the interaction and must be dropped, not applied.
   */
  isStale(pollEpoch) {
    return pollEpoch !== this.epoch;
  }

  /**
   * Clear a write. Also clears the device's active flag, so a held
   * render is applied when the last active device clears.
   *
   * @param {{ flush?: boolean }} [options] - When `flush` is false,
   * the held render is discarded instead of applied. Use that when
   * the write timed out: its outcome is unknown, and the held data
   * predates the write, so flushing it would revert the slider to
   * the pre-write value. The next poll fetches fresh data instead.
   */
  endWrite(deviceId, { flush = true } = {}) {
    this.writes.delete(deviceId);
    if (!flush) {
      this.pendingRender = false;
    }
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
   * When a render proceeds, nothing is pending anymore.
   */
  mayRender() {
    if (this.active.size > 0) {
      this.pendingRender = true;
      return false;
    }
    this.pendingRender = false;
    return true;
  }
}
