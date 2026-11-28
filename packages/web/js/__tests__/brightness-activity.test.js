/**
 * Tests for BrightnessActivity: the poll-application guard.
 *
 * Regression for the reviewer's blocking repro: a poll already in
 * flight replaces the active slider, detaching a drag (dragging from
 * 64% toward 79% sends only 64) and re-enabling a disabled slider
 * while a write is pending. The guard must live at poll application,
 * not poll start.
 */
import { describe, expect, test } from "bun:test";
import { BrightnessActivity } from "../brightness-activity.js";

describe("BrightnessActivity", () => {
  test("a poll may proceed when no device is active", () => {
    const activity = new BrightnessActivity(() => {});
    expect(activity.mayRender()).toBe(true);
    expect(activity.pendingRender).toBe(false);
  });

  test("a poll in flight during a drag is held, then applied when the drag ends", () => {
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.markActive("dimmer-1");
    // A poll lands mid-drag: held, not applied.
    expect(activity.mayRender()).toBe(false);
    expect(activity.pendingRender).toBe(true);
    expect(applied).toBe(0);
    // The drag ends with no write: the held poll is applied once.
    activity.clearActive("dimmer-1");
    expect(applied).toBe(1);
    expect(activity.pendingRender).toBe(false);
  });

  test("a poll in flight during a pending write is held until the write confirms", () => {
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.markActive("dimmer-1");
    expect(activity.mayRender()).toBe(false);
    expect(applied).toBe(0);
    // The write confirms: the held poll is applied.
    activity.clearActive("dimmer-1");
    expect(applied).toBe(1);
  });

  test("a held poll is applied only once, when the last active device clears", () => {
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.markActive("dimmer-1");
    activity.markActive("dimmer-2");
    expect(activity.mayRender()).toBe(false);
    activity.clearActive("dimmer-1");
    expect(applied).toBe(0); // dimmer-2 still active
    activity.clearActive("dimmer-2");
    expect(applied).toBe(1);
  });

  test("a poll that lands while idle applies immediately and is not re-applied", () => {
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    expect(activity.mayRender()).toBe(true);
    activity.clearActive("dimmer-1"); // nothing active; a no-op
    expect(applied).toBe(0);
  });

  test("beginWrite/endWrite track a write separately from a drag", () => {
    // The drag-end handler releases a device whose value looks
    // unchanged, but a deferred poll can have updated the confirmed
    // state to the requested value while a write is still pending.
    // So the handler checks isWriting() before releasing a device;
    // the module must track the write flag independently.
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.beginWrite("dimmer-1");
    expect(activity.isWriting("dimmer-1")).toBe(true);
    expect(activity.size).toBe(1);
    expect(activity.mayRender()).toBe(false);
    // The write confirms: endWrite clears the write flag and the
    // active flag, so the held poll is applied.
    activity.endWrite("dimmer-1");
    expect(activity.isWriting("dimmer-1")).toBe(false);
    expect(activity.size).toBe(0);
    expect(applied).toBe(1);
  });

  test("isWriting is false for a drag with no write", () => {
    const activity = new BrightnessActivity(() => {});
    activity.markActive("dimmer-1");
    expect(activity.isWriting("dimmer-1")).toBe(false);
    activity.clearActive("dimmer-1");
    expect(activity.isWriting("dimmer-1")).toBe(false);
  });

  test("a poll that started before the latest drag or write is stale", () => {
    const activity = new BrightnessActivity(() => {});
    const pollEpoch = activity.epoch;
    expect(activity.isStale(pollEpoch)).toBe(false);
    // A drag starts while the poll is in flight: its data predates
    // the interaction and must be dropped, not applied.
    activity.markActive("dimmer-1");
    expect(activity.isStale(pollEpoch)).toBe(true);
    // A poll that starts after the interaction is current.
    expect(activity.isStale(activity.epoch)).toBe(false);
  });

  test("a poll that started before the latest write is stale", () => {
    const activity = new BrightnessActivity(() => {});
    const pollEpoch = activity.epoch;
    activity.beginWrite("dimmer-1");
    expect(activity.isStale(pollEpoch)).toBe(true);
    expect(activity.isStale(activity.epoch)).toBe(false);
  });

  test("ending a timed-out write discards the held render instead of flushing it", () => {
    // The held render's data predates the write; flushing it would
    // revert the slider to the pre-write value even though the
    // write's outcome is unknown. The next poll reconciles instead.
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.beginWrite("dimmer-1");
    expect(activity.mayRender()).toBe(false);
    activity.endWrite("dimmer-1", { flush: false });
    expect(applied).toBe(0);
    expect(activity.pendingRender).toBe(false);
    expect(activity.size).toBe(0);
    // The next poll applies immediately (nothing is pending).
    expect(activity.mayRender()).toBe(true);
  });

  test("a render that proceeds clears the pending flag", () => {
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.markActive("dimmer-1");
    expect(activity.mayRender()).toBe(false);
    activity.clearActive("dimmer-1");
    expect(applied).toBe(1);
    expect(activity.pendingRender).toBe(false);
  });

  test("marking the same device twice still clears on one clear", () => {
    let applied = 0;
    const activity = new BrightnessActivity(() => {
      applied++;
    });
    activity.markActive("dimmer-1");
    activity.markActive("dimmer-1");
    expect(activity.size).toBe(1);
    expect(activity.mayRender()).toBe(false);
    activity.clearActive("dimmer-1");
    expect(applied).toBe(1);
  });
});
