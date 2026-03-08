/**
 * Timer Panel Module
 */

import { api } from "./api.js";

let currentOpenDeviceId = null;
const savingDeviceIds = new Set();

const timerPanelDeps = {
  showToast: () => {},
  announceToScreenReader: () => {},
  trapFocus: () => {},
};

const ACTION_LABELS = {
  0: "OFF",
  1: "ON",
};

const DAY_BITS = [
  { bit: 2, short: "M", label: "Mon" },
  { bit: 4, short: "T", label: "Tue" },
  { bit: 8, short: "W", label: "Wed" },
  { bit: 16, short: "T", label: "Thu" },
  { bit: 32, short: "F", label: "Fri" },
  { bit: 64, short: "S", label: "Sat" },
  { bit: 1, short: "S", label: "Sun" },
];

const ALL_DAYS_MASK = 127;
const WEEKDAYS_MASK = 62;
const WEEKENDS_MASK = 65;

/**
 * Initializes timer panel dependency callbacks.
 * @param {{showToast?: Function, announceToScreenReader?: Function, trapFocus?: Function}} deps - Dependency callbacks
 */
export function initTimerPanel(deps) {
  timerPanelDeps.showToast = deps?.showToast || (() => {});
  timerPanelDeps.announceToScreenReader = deps?.announceToScreenReader || (() => {});
  timerPanelDeps.trapFocus = deps?.trapFocus || (() => {});
}

/**
 * Renders the timer button for a device card.
 * @param {string} deviceId - Device ID
 * @returns {string} HTML string for timer button
 */
export function renderTimerButton(_deviceId) {
  return `
    <button class="timer-btn" data-action="timer" aria-label="Timers" aria-expanded="false">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </button>
  `;
}

/**
 * Opens the timer panel for a device.
 * @param {string} deviceId - Device ID
 * @param {HTMLElement} cardElement - Device card element
 */
export async function openTimerPanel(deviceId, cardElement) {
  if (currentOpenDeviceId && currentOpenDeviceId !== deviceId) {
    closeTimerPanel(currentOpenDeviceId);
  }

  const main = cardElement?.querySelector(".device-card-main");
  if (!main) {
    return;
  }

  const existingPanel = cardElement.querySelector(".timer-panel");
  let panel = existingPanel;

  if (!panel) {
    panel = document.createElement("div");
    panel.className = "timer-panel timer-panel-enter";
    panel.dataset.deviceId = deviceId;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = renderTimerLoading();
    main.insertAdjacentElement("afterend", panel);

    requestAnimationFrame(() => {
      panel.classList.add("timer-panel-enter-active");
      panel.classList.remove("timer-panel-enter");
    });
  } else {
    panel.innerHTML = renderTimerLoading();
  }

  updateTimerButtonState(cardElement, true);
  currentOpenDeviceId = deviceId;

  try {
    await loadAndRenderTimers(deviceId, panel);
    timerPanelDeps.announceToScreenReader("Timers loaded");
  } catch (error) {
    console.error("[TimerPanel] Failed to load timers:", error);
    panel.innerHTML = `
      <div class="timer-empty">Failed to load timers.</div>
      <button class="btn timer-add-btn" data-action="timer-retry">Retry</button>
    `;
    panel.querySelector('[data-action="timer-retry"]')?.addEventListener("click", async () => {
      try {
        await loadAndRenderTimers(deviceId, panel);
      } catch (retryError) {
        console.error("[TimerPanel] Retry load failed:", retryError);
        timerPanelDeps.showToast("Failed to load timers", "error");
      }
    });
    timerPanelDeps.showToast("Failed to load timers", "error");
    timerPanelDeps.announceToScreenReader("Failed to load timers");
  }
}

/**
 * Closes the timer panel for a device.
 * @param {string} deviceId - Device ID
 */
export function closeTimerPanel(deviceId) {
  const card = document.querySelector(`[data-device-id="${cssEscape(deviceId)}"]`);
  const panel = card?.querySelector(".timer-panel");

  if (panel) {
    panel.remove();
  }

  closeTimerFormModal();
  updateTimerButtonState(card, false);

  if (currentOpenDeviceId === deviceId) {
    currentOpenDeviceId = null;
  }
}

/**
 * Toggles the timer panel open/closed.
 * @param {string} deviceId - Device ID
 * @param {HTMLElement} cardElement - Device card element
 */
export function toggleTimerPanel(deviceId, cardElement) {
  const card = cardElement || document.querySelector(`[data-device-id="${cssEscape(deviceId)}"]`);
  if (!card) {
    return;
  }

  const panel = card.querySelector(".timer-panel");
  const isOpen = currentOpenDeviceId === deviceId && panel;

  if (isOpen) {
    closeTimerPanel(deviceId);
    return;
  }

  openTimerPanel(deviceId, card);
}

/**
 * Renders full timer panel content.
 * @param {string} deviceId - Device ID
 * @param {Array<Object>} timers - Timer rules
 * @param {number} dbVersion - Database version
 * @returns {string} HTML string
 */
function renderTimerPanel(deviceId, timers, dbVersion) {
  const timerRules = timers.filter((timer) => timer.type === "Timer");
  const nonTimerRules = timers.filter((timer) => timer.type !== "Timer");

  const timerListContent =
    timerRules.length > 0 ? timerRules.map(renderTimerItem).join("") : renderTimerEmpty();

  const nonTimerListContent = nonTimerRules
    .map(
      (rule) => `
        <div class="timer-item disabled" data-rule-id="${Number(rule.ruleID)}" data-rule-type="${escapeHtml(rule.type)}">
          <div class="timer-item-info">
            <div class="timer-item-time">${escapeHtml(rule.name || "Rule")} (${escapeHtml(rule.type)})</div>
            <div class="timer-item-days">${escapeHtml(formatTimerDisplay(rule))} - ${escapeHtml(formatDayDisplay(rule.dayId))}</div>
          </div>
        </div>
      `
    )
    .join("");

  return `
    <div class="timer-list" data-device-id="${escapeHtml(deviceId)}" data-db-version="${Number(dbVersion) || 0}">
      ${timerListContent}
      ${nonTimerListContent}
    </div>
    <button class="btn timer-add-btn" data-action="timer-add">+ Add Timer</button>
  `;
}

/**
 * Renders a timer list item.
 * @param {Object} timer - Timer rule
 * @returns {string} HTML string
 */
function renderTimerItem(timer) {
  const enabled = Boolean(timer.enabled);
  return `
    <div class="timer-item ${enabled ? "" : "disabled"}" data-rule-id="${Number(timer.ruleID)}" data-rule-type="Timer">
      <div class="timer-item-info">
        <div class="timer-item-time">${escapeHtml(formatTimerDisplay(timer))}</div>
        <div class="timer-item-days">${escapeHtml(formatDayDisplay(timer.dayId))}</div>
      </div>
      <div class="timer-item-actions">
        <label class="toggle">
          <input type="checkbox" data-action="timer-toggle" ${enabled ? "checked" : ""} aria-label="Enable timer">
          <span class="toggle-track"></span>
        </label>
        <button class="btn btn-icon" data-action="timer-edit" aria-label="Edit timer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn btn-icon" data-action="timer-delete" aria-label="Delete timer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/**
 * Renders timer create/edit form modal.
 * @param {string} deviceId - Device ID
 * @param {Object} existingTimer - Existing timer for edit mode
 * @returns {string} HTML string
 */
function renderTimerForm(deviceId, existingTimer = null) {
  const isEdit = Boolean(existingTimer);
  const startTime = Number.isFinite(existingTimer?.startTime)
    ? toTimeInputValue(existingTimer.startTime)
    : "07:00";
  const startAction = Number.isInteger(existingTimer?.startAction) ? existingTimer.startAction : 1;
  const dayId = normalizeDayId(existingTimer?.dayId);
  const hasEndTime =
    Number.isFinite(existingTimer?.endTime) && Number.isInteger(existingTimer?.endAction);
  const endTime = hasEndTime ? toTimeInputValue(existingTimer.endTime) : "22:00";
  const endAction = Number.isInteger(existingTimer?.endAction) ? existingTimer.endAction : 0;

  const activeMask = dayId === -1 ? ALL_DAYS_MASK : dayId;

  return `
    <div class="modal" id="timer-form-modal" role="dialog" aria-modal="true" aria-labelledby="timer-form-title" data-day-id="${dayId}">
      <div class="modal-backdrop"></div>
      <div class="modal-content" data-device-id="${escapeHtml(deviceId)}" data-rule-id="${isEdit ? Number(existingTimer.ruleID) : ""}">
        <div class="modal-header">
          <h2 class="modal-title" id="timer-form-title">${isEdit ? "Edit Timer" : "Add Timer"}</h2>
          <button class="btn btn-icon modal-close" data-action="timer-form-close" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <form class="timer-form" novalidate>
            <div class="timer-form-group">
              <label class="timer-form-label" for="timer-start-time">Start Time</label>
              <div class="time-input-group">
                <input id="timer-start-time" class="time-input" type="time" required value="${escapeHtml(startTime)}">
              </div>
            </div>

            <div class="timer-form-group">
              <span class="timer-form-label">Action</span>
              <div class="action-selector" data-action-group="start">
                ${renderActionButtons(startAction, "start")}
              </div>
            </div>

            <div class="timer-form-group">
              <span class="timer-form-label">Days</span>
              <div class="day-picker">
                <div class="day-picker-days">
                  ${DAY_BITS.map(
                    (day) => `
                      <button type="button" class="day-btn ${(activeMask & day.bit) !== 0 ? "active" : ""}" data-action="timer-day" data-bit="${day.bit}" aria-pressed="${(activeMask & day.bit) !== 0}">
                        ${day.short}
                      </button>
                    `
                  ).join("")}
                </div>
                <div class="day-quick-select">
                  <button type="button" class="day-quick-btn ${dayId === -1 ? "active" : ""}" data-action="timer-day-quick" data-value="daily">Daily</button>
                  <button type="button" class="day-quick-btn ${dayId === WEEKDAYS_MASK ? "active" : ""}" data-action="timer-day-quick" data-value="weekdays">Weekdays</button>
                  <button type="button" class="day-quick-btn ${dayId === WEEKENDS_MASK ? "active" : ""}" data-action="timer-day-quick" data-value="weekends">Weekends</button>
                </div>
              </div>
            </div>

            <div class="timer-form-group">
              <label class="end-time-toggle-label" for="timer-end-enabled">
                <input id="timer-end-enabled" type="checkbox" data-action="timer-end-enabled" ${hasEndTime ? "checked" : ""}>
                Add end time
              </label>
              <div class="end-time-section ${hasEndTime ? "" : "hidden"}" data-end-time-section>
                <label class="timer-form-label" for="timer-end-time">End Time</label>
                <div class="time-input-group">
                  <input id="timer-end-time" class="time-input" type="time" value="${escapeHtml(endTime)}">
                </div>

                <span class="timer-form-label">End Action</span>
                <div class="action-selector" data-action-group="end">
                  ${renderActionButtons(endAction, "end")}
                </div>
              </div>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn" id="timer-form-cancel" data-action="timer-form-cancel">Cancel</button>
          <button class="btn btn-primary" id="timer-form-save" data-action="timer-form-save">Save</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders timer empty state.
 * @returns {string} HTML string
 */
function renderTimerEmpty() {
  return '<div class="timer-empty">No timers set. Tap + to add one.</div>';
}

/**
 * Renders timer loading state.
 * @returns {string} HTML string
 */
function renderTimerLoading() {
  return `
    <div class="timer-loading">
      <div class="spinner"></div>
      <div>Loading timers, please wait.</div>
    </div>
  `;
}

/**
 * Formats timer info for display.
 * @param {Object} timer - Timer rule
 * @returns {string} Formatted display text
 */
function formatTimerDisplay(timer) {
  const startText = formatTime(timer.startTime);
  const startAction = ACTION_LABELS[Number(timer.startAction)] || "Action";

  if (Number.isFinite(timer.endTime) && Number.isInteger(timer.endAction)) {
    const endText = formatTime(timer.endTime);
    const endAction = ACTION_LABELS[Number(timer.endAction)] || "Action";
    return `${startText} ${startAction} - ${endText} ${endAction}`;
  }

  return `${startText} -> ${startAction}`;
}

/**
 * Formats day bitmask for display.
 * @param {number} dayId - Day bitmask
 * @returns {string} Day display text
 */
function formatDayDisplay(dayId) {
  const normalized = normalizeDayId(dayId);
  if (normalized === -1) {
    return "Daily";
  }
  if (normalized === WEEKDAYS_MASK) {
    return "Weekdays";
  }
  if (normalized === WEEKENDS_MASK) {
    return "Weekends";
  }
  if (normalized <= 0) {
    return "No days";
  }

  const selected = DAY_BITS.filter((day) => (normalized & day.bit) !== 0).map((day) => day.label);
  return selected.length > 0 ? selected.join(", ") : "No days";
}

/**
 * Formats seconds from midnight as 12-hour time.
 * @param {number} seconds - Seconds from midnight
 * @returns {string} Time display
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "--:--";
  }

  const totalMinutes = Math.floor(Number(seconds) / 60);
  const hours24 = ((Math.floor(totalMinutes / 60) % 24) + 24) % 24;
  const minutes = ((totalMinutes % 60) + 60) % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;

  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * Parses HH:MM input value into seconds.
 * @param {string} timeStr - Time input string
 * @returns {number|null} Seconds from midnight or null
 */
function parseTimeInput(timeStr) {
  if (typeof timeStr !== "string") {
    return null;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 3600 + minutes * 60;
}

async function loadAndRenderTimers(deviceId, panel) {
  const result = await api.getTimers(deviceId);
  panel.innerHTML = renderTimerPanel(deviceId, result.timers || [], result.dbVersion || 0);
  attachTimerPanelListeners(panel, deviceId, result.timers || []);
}

function attachTimerPanelListeners(panel, deviceId, timers) {
  panel.onchange = async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.matches('[data-action="timer-toggle"]')) {
      const item = target.closest(".timer-item");
      const ruleId = Number(item?.dataset.ruleId);
      if (!Number.isInteger(ruleId)) {
        return;
      }
      await handleToggleTimer(panel, deviceId, ruleId, target.checked);
    }
  };

  panel.onclick = async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const actionElement = target.closest("[data-action]");
    if (!(actionElement instanceof HTMLElement)) {
      return;
    }

    const action = actionElement.dataset.action;

    if (action === "timer-add") {
      openTimerFormModal(deviceId, panel, null);
      return;
    }

    if (action === "timer-edit") {
      const item = actionElement.closest(".timer-item");
      const ruleId = Number(item?.dataset.ruleId);
      if (!Number.isInteger(ruleId)) {
        return;
      }
      const timer = timers.find((rule) => Number(rule.ruleID) === ruleId && rule.type === "Timer");
      if (timer) {
        openTimerFormModal(deviceId, panel, timer);
      }
      return;
    }

    if (action === "timer-delete") {
      const item = actionElement.closest(".timer-item");
      const ruleId = Number(item?.dataset.ruleId);
      if (!Number.isInteger(ruleId)) {
        return;
      }
      showDeleteModal(panel, deviceId, ruleId);
      return;
    }
  };
}

async function handleToggleTimer(panel, deviceId, ruleId, enabled) {
  if (navigator.vibrate) {
    navigator.vibrate(10);
  }

  setPanelSaving(panel, true);
  try {
    await api.toggleTimer(deviceId, ruleId, enabled);
    await loadAndRenderTimers(deviceId, panel);
    timerPanelDeps.announceToScreenReader(`Timer ${enabled ? "enabled" : "disabled"}`);
  } catch (error) {
    console.error("[TimerPanel] Failed to toggle timer:", error);
    timerPanelDeps.showToast("Failed to save timer", "error");
  } finally {
    setPanelSaving(panel, false);
  }
}

async function handleDeleteTimer(panel, deviceId, ruleId) {
  setPanelSaving(panel, true);
  try {
    await api.deleteTimer(deviceId, ruleId);
    await loadAndRenderTimers(deviceId, panel);
    timerPanelDeps.showToast("Timer deleted", "success");
    timerPanelDeps.announceToScreenReader("Timer deleted");
    if (navigator.vibrate) {
      navigator.vibrate([10, 50, 10]);
    }
  } catch (error) {
    console.error("[TimerPanel] Failed to delete timer:", error);
    timerPanelDeps.showToast("Failed to delete timer", "error");
  } finally {
    setPanelSaving(panel, false);
  }
}

function showDeleteModal(panel, deviceId, ruleId) {
  closeDeleteModal();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal modal-centered" id="timer-delete-modal" role="dialog" aria-modal="true" aria-labelledby="timer-delete-title" style="align-items: center;">
      <div class="modal-backdrop"></div>
      <div class="modal-content" style="max-width: 360px; border-radius: var(--radius-xl); margin: var(--spacing-md);">
        <div class="modal-header">
          <h2 class="modal-title" id="timer-delete-title">Delete Timer</h2>
          <button class="btn btn-icon modal-close" data-action="timer-delete-cancel" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="margin: 0; color: var(--color-text-muted);">This timer will be permanently removed from the device.</p>
        </div>
        <div class="modal-footer">
          <button class="btn" data-action="timer-delete-cancel">Cancel</button>
          <button class="btn btn-danger" data-action="timer-delete-confirm">Delete</button>
        </div>
      </div>
    </div>
  `;

  const modal = wrapper.firstElementChild;
  if (!(modal instanceof HTMLElement)) return;
  document.body.appendChild(modal);

  const handleClick = async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest("[data-action]");
    if (!(actionEl instanceof HTMLElement)) return;

    const action = actionEl.dataset.action;
    if (action === "timer-delete-cancel") {
      closeDeleteModal();
    } else if (action === "timer-delete-confirm") {
      closeDeleteModal();
      await handleDeleteTimer(panel, deviceId, ruleId);
    }
  };

  modal.addEventListener("click", handleClick);
}

function closeDeleteModal() {
  const modal = document.getElementById("timer-delete-modal");
  if (modal) modal.remove();
}

function openTimerFormModal(deviceId, panel, existingTimer = null) {
  closeTimerFormModal();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderTimerForm(deviceId, existingTimer);
  const modal = wrapper.firstElementChild;

  if (!(modal instanceof HTMLElement)) {
    return;
  }

  document.body.appendChild(modal);
  timerPanelDeps.trapFocus(modal);
  timerPanelDeps.announceToScreenReader(
    existingTimer ? "Edit timer dialog opened" : "Add timer dialog opened"
  );

  setupTimerFormInteractions(modal, deviceId, panel, existingTimer);
}

function closeTimerFormModal() {
  document.getElementById("timer-form-modal")?.remove();
}

function setupTimerFormInteractions(modal, deviceId, panel, existingTimer) {
  const startTimeInput = modal.querySelector("#timer-start-time");
  const endEnabled = modal.querySelector("#timer-end-enabled");
  const endSection = modal.querySelector("[data-end-time-section]");

  const close = () => {
    closeTimerFormModal();
  };

  modal.querySelector(".modal-backdrop")?.addEventListener("click", close);
  modal.querySelector('[data-action="timer-form-close"]')?.addEventListener("click", close);
  modal.querySelector('[data-action="timer-form-cancel"]')?.addEventListener("click", close);

  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });

  endEnabled?.addEventListener("change", () => {
    if (endEnabled.checked) {
      endSection?.classList.remove("hidden");
    } else {
      endSection?.classList.add("hidden");
    }
  });

  modal.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionElement = target.closest("[data-action]");
    if (!(actionElement instanceof HTMLElement)) {
      return;
    }

    const action = actionElement.dataset.action;

    if (action === "timer-day") {
      handleDayButtonClick(modal, actionElement);
      return;
    }

    if (action === "timer-day-quick") {
      handleQuickDayClick(modal, actionElement.dataset.value || "");
      return;
    }

    if (action === "timer-action") {
      const group = actionElement.dataset.group;
      setActionSelection(modal, group, Number(actionElement.dataset.value));
      return;
    }

    if (action === "timer-form-save") {
      handleSaveTimer(modal, deviceId, panel, existingTimer);
    }
  });

  startTimeInput?.focus();
}

async function handleSaveTimer(modal, deviceId, panel, existingTimer) {
  const startTimeInput = modal.querySelector("#timer-start-time");
  const endEnabled = modal.querySelector("#timer-end-enabled");
  const endTimeInput = modal.querySelector("#timer-end-time");
  const saveButton = modal.querySelector('[data-action="timer-form-save"]');

  if (!(startTimeInput instanceof HTMLInputElement)) {
    return;
  }

  const startTime = parseTimeInput(startTimeInput.value);
  const dayId = Number(modal.dataset.dayId || "-1");
  const startAction = getSelectedAction(modal, "start");
  const includeEnd = Boolean(endEnabled instanceof HTMLInputElement && endEnabled.checked);

  if (startTime === null) {
    timerPanelDeps.showToast("Failed to save timer", "error");
    startTimeInput.focus();
    return;
  }

  if (!(dayId === -1 || dayId > 0)) {
    timerPanelDeps.showToast("Failed to save timer", "error");
    return;
  }

  if (![0, 1, 2].includes(startAction)) {
    timerPanelDeps.showToast("Failed to save timer", "error");
    return;
  }

  const payload = {
    name: existingTimer?.name || `Timer ${startTimeInput.value}`,
    type: "Timer",
    enabled: existingTimer?.enabled ?? true,
    startTime,
    startAction,
    dayId,
  };

  if (includeEnd) {
    if (!(endTimeInput instanceof HTMLInputElement)) {
      timerPanelDeps.showToast("Failed to save timer", "error");
      return;
    }

    const endTime = parseTimeInput(endTimeInput.value);
    const endAction = getSelectedAction(modal, "end");
    if (endTime === null || ![0, 1, 2].includes(endAction)) {
      timerPanelDeps.showToast("Failed to save timer", "error");
      return;
    }

    payload.endTime = endTime;
    payload.endAction = endAction;
  } else if (existingTimer) {
    payload.endTime = null;
    payload.endAction = null;
  }

  setPanelSaving(panel, true);
  setModalSaving(modal, true);

  if (saveButton instanceof HTMLButtonElement) {
    saveButton.disabled = true;
  }

  try {
    if (existingTimer) {
      await api.updateTimer(deviceId, Number(existingTimer.ruleID), payload);
      timerPanelDeps.showToast("Timer updated", "success");
      timerPanelDeps.announceToScreenReader("Timer updated");
    } else {
      await api.createTimer(deviceId, payload);
      timerPanelDeps.showToast("Timer created", "success");
      timerPanelDeps.announceToScreenReader("Timer created");
    }

    if (navigator.vibrate) {
      navigator.vibrate([10, 50, 10]);
    }

    closeTimerFormModal();
    await loadAndRenderTimers(deviceId, panel);
  } catch (error) {
    console.error("[TimerPanel] Failed to save timer:", error);
    timerPanelDeps.showToast("Failed to save timer", "error");
  } finally {
    setPanelSaving(panel, false);
    setModalSaving(modal, false);
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = false;
    }
  }
}

function setPanelSaving(panel, isSaving) {
  if (!panel) {
    return;
  }

  if (isSaving) {
    savingDeviceIds.add(String(panel.dataset.deviceId || ""));
    if (!panel.querySelector(".timer-saving")) {
      const overlay = document.createElement("div");
      overlay.className = "timer-saving";
      overlay.innerHTML = '<div class="spinner"></div><div>Saving to device...</div>';
      panel.appendChild(overlay);
    }
  } else {
    savingDeviceIds.delete(String(panel.dataset.deviceId || ""));
    panel.querySelector(".timer-saving")?.remove();
  }

  const controls = panel.querySelectorAll("button, input, select, textarea");
  for (const control of controls) {
    if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement)) {
      continue;
    }

    if (isSaving) {
      control.dataset.timerDisabled = control.disabled ? "1" : "0";
      control.disabled = true;
    } else {
      if (control.dataset.timerDisabled === "0") {
        control.disabled = false;
      }
      delete control.dataset.timerDisabled;
    }
  }
}

function setModalSaving(modal, isSaving) {
  const content = modal.querySelector(".modal-content");
  if (!(content instanceof HTMLElement)) {
    return;
  }

  if (isSaving) {
    if (!content.querySelector(".timer-saving")) {
      const overlay = document.createElement("div");
      overlay.className = "timer-saving";
      overlay.innerHTML = '<div class="spinner"></div><div>Saving to device...</div>';
      content.appendChild(overlay);
    }
  } else {
    content.querySelector(".timer-saving")?.remove();
  }

  const controls = modal.querySelectorAll("button, input, select, textarea");
  for (const control of controls) {
    if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement)) {
      continue;
    }
    if (isSaving) {
      control.dataset.timerDisabled = control.disabled ? "1" : "0";
      control.disabled = true;
    } else {
      if (control.dataset.timerDisabled === "0") {
        control.disabled = false;
      }
      delete control.dataset.timerDisabled;
    }
  }
}

function updateTimerButtonState(cardElement, isExpanded) {
  cardElement
    ?.querySelector('[data-action="timer"]')
    ?.setAttribute("aria-expanded", isExpanded ? "true" : "false");
}

function renderActionButtons(activeValue, group) {
  const values = [
    { value: 1, key: "on", label: "ON" },
    { value: 0, key: "off", label: "OFF" },
  ];

  return values
    .map(
      (entry) => `
        <button type="button" class="action-btn ${entry.value === activeValue ? "active" : ""}" data-action="timer-action" data-group="${group}" data-value="${entry.value}" data-action-name="${entry.key}" aria-pressed="${entry.value === activeValue}">
          ${entry.label}
        </button>
      `
    )
    .join("");
}

function getSelectedAction(modal, group) {
  const active = modal.querySelector(`[data-action="timer-action"][data-group="${group}"].active`);
  if (!(active instanceof HTMLElement)) {
    return Number.NaN;
  }

  return Number(active.dataset.value);
}

function setActionSelection(modal, group, value) {
  const actions = modal.querySelectorAll(`[data-action="timer-action"][data-group="${group}"]`);
  for (const action of actions) {
    if (!(action instanceof HTMLElement)) {
      continue;
    }
    const isActive = Number(action.dataset.value) === value;
    action.classList.toggle("active", isActive);
    action.setAttribute("aria-pressed", String(isActive));
  }
}

function handleDayButtonClick(modal, button) {
  const bit = Number(button.dataset.bit);
  if (!Number.isInteger(bit) || bit <= 0) {
    return;
  }

  const current = Number(modal.dataset.dayId || "-1");
  const currentMask = current === -1 ? ALL_DAYS_MASK : current;
  const nextMask = (currentMask ^ bit) & ALL_DAYS_MASK;
  const normalized = nextMask === ALL_DAYS_MASK ? -1 : nextMask;

  applyDaySelection(modal, normalized);
}

function handleQuickDayClick(modal, value) {
  if (value === "daily") {
    applyDaySelection(modal, -1);
    return;
  }
  if (value === "weekdays") {
    applyDaySelection(modal, WEEKDAYS_MASK);
    return;
  }
  if (value === "weekends") {
    applyDaySelection(modal, WEEKENDS_MASK);
  }
}

function applyDaySelection(modal, dayId) {
  const normalized = normalizeDayId(dayId);
  modal.dataset.dayId = String(normalized);

  const mask = normalized === -1 ? ALL_DAYS_MASK : normalized;

  for (const dayButton of modal.querySelectorAll('[data-action="timer-day"]')) {
    if (!(dayButton instanceof HTMLElement)) {
      continue;
    }
    const bit = Number(dayButton.dataset.bit);
    const active = (mask & bit) !== 0;
    dayButton.classList.toggle("active", active);
    dayButton.setAttribute("aria-pressed", String(active));
  }

  for (const quick of modal.querySelectorAll('[data-action="timer-day-quick"]')) {
    if (!(quick instanceof HTMLElement)) {
      continue;
    }

    const quickValue = quick.dataset.value;
    const active =
      (quickValue === "daily" && normalized === -1) ||
      (quickValue === "weekdays" && normalized === WEEKDAYS_MASK) ||
      (quickValue === "weekends" && normalized === WEEKENDS_MASK);
    quick.classList.toggle("active", active);
  }
}

function normalizeDayId(dayId) {
  const numeric = Number(dayId);
  if (numeric === -1 || numeric === ALL_DAYS_MASK) {
    return -1;
  }
  if (numeric > 0) {
    return numeric & ALL_DAYS_MASK;
  }
  return -1;
}

function toTimeInputValue(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const totalMinutes = Math.floor(safeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/(["\\])/g, "\\$1");
}
