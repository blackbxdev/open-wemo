/**
 * Open Wemo PWA - Main Application
 */

import { api } from "./api.js";
// Note: PWA-based setup mode has been disabled due to browser CORS limitations.
// Device setup must now be done from the bridge (tray menu → "Setup New Device").
// The following imports are kept for network detection only.
import { NetworkMode, detectNetworkMode } from "./setup-mode.js";
import {
  closeTimerPanel,
  initTimerPanel,
  renderTimerButton,
  toggleTimerPanel,
} from "./timer-panel.js";

// ============================================
// State Management
// ============================================

const state = {
  devices: [],
  loading: true,
  error: null,
  isOffline: false,
  lastUpdated: null,
  networkMode: NetworkMode.NORMAL,
  // Note: testResults, testsRunning, deviceInfo, and wifiSetup state removed
  // PWA-based setup mode has been deprecated due to CORS limitations
  settings: {
    refreshInterval: 30000,
    theme: "dark",
  },
};

// ============================================
// PWA Install State
// ============================================

const pwaState = {
  deferredPrompt: null,
  isInstalled: false,
  isIOS: false,
  isStandalone: false,
  installBannerDismissed: false,
};

const INSTALL_BANNER_DISMISSED_KEY = "open-wemo-install-dismissed";
const INSTALL_BANNER_DISMISS_DAYS = 14;
const APP_INSTALLED_KEY = "open-wemo-app-installed";

// ============================================
// DOM Elements
// ============================================

const $app = document.getElementById("app");
const $initialLoading = document.getElementById("initial-loading");
const $refreshBtn = document.getElementById("refresh-btn");
const $toastContainer = document.getElementById("toast-container");
const $addDeviceBtn = document.getElementById("add-device-btn");
const $discoveryModal = document.getElementById("discovery-modal");
const $discoveryContent = document.getElementById("discovery-content");
const $discoveryFooter = document.getElementById("discovery-footer");
const $discoveryClose = document.getElementById("discovery-close");
const $settingsBtn = document.getElementById("settings-btn");
const $settingsModal = document.getElementById("settings-modal");
const $settingsClose = document.getElementById("settings-close");
const $bridgeStatus = document.getElementById("bridge-status");
const $installBanner = document.getElementById("install-banner");
const $installBannerBtn = document.getElementById("install-banner-btn");
const $installBannerClose = document.getElementById("install-banner-close");
const $iosModal = document.getElementById("ios-install-modal");
const $iosModalClose = document.getElementById("ios-install-close");
const $settingsInstallBtn = document.getElementById("settings-install-btn");
const $settingsInstallRow = document.getElementById("settings-install-row");
const $settingsShareBtn = document.getElementById("settings-share-btn");
const $qrModal = document.getElementById("qr-modal");
const $qrModalClose = document.getElementById("qr-modal-close");
const $qrCodeContainer = document.getElementById("qr-code-container");
const $qrModalUrl = document.getElementById("qr-modal-url");
const $setupInstructionsModal = document.getElementById("setup-instructions-modal");
const $setupInstructionsClose = document.getElementById("setup-instructions-close");
const $setupInstructionsCancel = document.getElementById("setup-instructions-cancel");

// ============================================
// Service Worker Registration
// ============================================

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      console.log("[App] Service worker registered:", registration.scope);

      // Handle updates
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showToast("App update available. Refresh to update.", "info");
          }
        });
      });
    } catch (error) {
      console.error("[App] Service worker registration failed:", error);
    }
  }
}

// ============================================
// PWA Install Detection & Handling
// ============================================

/**
 * Checks if the app was previously installed (persisted in localStorage).
 */
function wasAppInstalled() {
  try {
    return localStorage.getItem(APP_INSTALLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Marks the app as installed in localStorage.
 */
function markAppAsInstalled() {
  try {
    localStorage.setItem(APP_INSTALLED_KEY, "true");
  } catch {
    // Ignore storage errors
  }
}

/**
 * Detects if the app is running in standalone mode (already installed).
 */
function isRunningStandalone() {
  // Check display-mode media query (works on most browsers)
  const standaloneMedia = window.matchMedia("(display-mode: standalone)").matches;

  // Check iOS Safari standalone property
  const iosStandalone = window.navigator.standalone === true;

  // Check Android TWA
  const androidTWA = document.referrer.includes("android-app://");

  // Check fullscreen mode (some PWAs use this)
  const fullscreenMedia = window.matchMedia("(display-mode: fullscreen)").matches;

  // Check minimal-ui mode
  const minimalUIMedia = window.matchMedia("(display-mode: minimal-ui)").matches;

  // Check if we previously recorded a successful installation
  const previouslyInstalled = wasAppInstalled();

  const isStandalone =
    standaloneMedia ||
    iosStandalone ||
    androidTWA ||
    fullscreenMedia ||
    minimalUIMedia ||
    previouslyInstalled;

  console.log("[PWA] Standalone detection:", {
    standaloneMedia,
    iosStandalone,
    androidTWA,
    fullscreenMedia,
    minimalUIMedia,
    previouslyInstalled,
    result: isStandalone,
  });

  return isStandalone;
}

/**
 * Detects if the device is running iOS (iPhone, iPad, iPod).
 */
function isIOSDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Checks if the install banner was recently dismissed.
 */
function wasInstallBannerDismissed() {
  try {
    const dismissed = localStorage.getItem(INSTALL_BANNER_DISMISSED_KEY);
    if (!dismissed) return false;

    const dismissedDate = new Date(dismissed);
    const now = new Date();
    const daysSinceDismissed = (now - dismissedDate) / (1000 * 60 * 60 * 24);

    return daysSinceDismissed < INSTALL_BANNER_DISMISS_DAYS;
  } catch {
    return false;
  }
}

/**
 * Marks the install banner as dismissed.
 */
function dismissInstallBanner() {
  try {
    localStorage.setItem(INSTALL_BANNER_DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Ignore storage errors
  }
  pwaState.installBannerDismissed = true;
  hideInstallBanner();
}

/**
 * Shows the install banner (for Android/Chrome).
 */
function showInstallBanner() {
  if ($installBanner && !pwaState.isStandalone && !pwaState.installBannerDismissed) {
    $installBanner.classList.remove("hidden");
    console.log("[PWA] Showing install banner");
  }
}

/**
 * Hides the install banner.
 */
function hideInstallBanner() {
  if ($installBanner) {
    $installBanner.classList.add("hidden");
  }
}

/**
 * Shows the iOS install instructions modal.
 */
function showIOSInstallModal() {
  if ($iosModal) {
    $iosModal.classList.remove("hidden");
    trapFocus($iosModal);
    announceToScreenReader("iOS installation instructions opened");
  }
}

/**
 * Hides the iOS install instructions modal.
 */
function hideIOSInstallModal() {
  if ($iosModal) {
    $iosModal.classList.add("hidden");
  }
}

/**
 * Shows generic install instructions modal (for browsers without beforeinstallprompt).
 */
function showGenericInstallModal() {
  const $genericModal = document.getElementById("generic-install-modal");
  if ($genericModal) {
    $genericModal.classList.remove("hidden");
    trapFocus($genericModal);
    announceToScreenReader("Installation instructions opened");
  }
}

/**
 * Hides the generic install instructions modal.
 */
function hideGenericInstallModal() {
  const $genericModal = document.getElementById("generic-install-modal");
  if ($genericModal) {
    $genericModal.classList.add("hidden");
  }
}

/**
 * Triggers the native install prompt (Android/Chrome).
 */
async function triggerInstallPrompt() {
  if (!pwaState.deferredPrompt) {
    console.log("[PWA] No deferred prompt available");
    // If on iOS, show the iOS modal instead
    if (pwaState.isIOS) {
      showIOSInstallModal();
    }
    return;
  }

  try {
    // Show the install prompt
    pwaState.deferredPrompt.prompt();

    // Wait for the user to respond
    const { outcome } = await pwaState.deferredPrompt.userChoice;
    console.log(`[PWA] User response to install prompt: ${outcome}`);

    if (outcome === "accepted") {
      showToast("Installing app...", "success");
    }

    // Clear the deferred prompt - it can only be used once
    pwaState.deferredPrompt = null;
    hideInstallBanner();
    updateSettingsInstallButton();
  } catch (error) {
    console.error("[PWA] Install prompt failed:", error);
    showToast("Installation failed. Please try again.", "error");
  }
}

/**
 * Updates the install button visibility in Settings.
 */
function updateSettingsInstallButton() {
  if (!$settingsInstallRow) return;

  // Hide only if already installed in standalone mode
  if (pwaState.isStandalone) {
    $settingsInstallRow.classList.add("hidden");
  } else {
    // Always show install option - we'll handle the appropriate action based on platform
    $settingsInstallRow.classList.remove("hidden");
  }
}

/**
 * Sets up PWA install event listeners.
 */
function setupPWAInstall() {
  // Check current state
  pwaState.isStandalone = isRunningStandalone();
  pwaState.isIOS = isIOSDevice();
  pwaState.installBannerDismissed = wasInstallBannerDismissed();

  console.log("[PWA] State:", {
    isStandalone: pwaState.isStandalone,
    isIOS: pwaState.isIOS,
    installBannerDismissed: pwaState.installBannerDismissed,
  });

  // If already installed, nothing more to do
  if (pwaState.isStandalone) {
    console.log("[PWA] App is already installed (standalone mode)");
    hideInstallBanner();
    return;
  }

  // Listen for display mode changes (in case standalone is detected late)
  window.matchMedia("(display-mode: standalone)").addEventListener("change", (e) => {
    if (e.matches) {
      console.log("[PWA] Display mode changed to standalone");
      pwaState.isStandalone = true;
      hideInstallBanner();
      updateSettingsInstallButton();
    }
  });

  // Listen for beforeinstallprompt (Chrome/Edge/Samsung Internet)
  window.addEventListener("beforeinstallprompt", (e) => {
    // Prevent the mini-infobar from appearing
    e.preventDefault();

    // Store the event for later use
    pwaState.deferredPrompt = e;
    console.log("[PWA] beforeinstallprompt event captured");

    // Show our custom install banner (if not dismissed)
    if (!pwaState.installBannerDismissed) {
      showInstallBanner();
    }

    // Update settings button
    updateSettingsInstallButton();
  });

  // Listen for successful installation
  window.addEventListener("appinstalled", () => {
    console.log("[PWA] App was installed successfully");
    pwaState.isInstalled = true;
    pwaState.isStandalone = true;
    pwaState.deferredPrompt = null;
    markAppAsInstalled();
    hideInstallBanner();
    updateSettingsInstallButton();
    showToast("App installed successfully!", "success");
  });

  // Show banner for first-time users (regardless of platform)
  // For iOS: Shows immediately with instructions
  // For Android/Chrome: Shows immediately, native prompt triggers on Install click
  // For other browsers: Shows with generic instructions
  if (!pwaState.installBannerDismissed) {
    showInstallBanner();
  }

  // Set up banner button handlers
  if ($installBannerBtn) {
    $installBannerBtn.addEventListener("click", () => {
      // Always hide the banner first
      hideInstallBanner();

      if (pwaState.isIOS) {
        // Mark as installed since they're following instructions
        markAppAsInstalled();
        showIOSInstallModal();
      } else if (pwaState.deferredPrompt) {
        triggerInstallPrompt();
      } else {
        // No native prompt - show generic instructions
        // Mark as installed since they're following instructions
        markAppAsInstalled();
        showGenericInstallModal();
      }
    });
  }

  if ($installBannerClose) {
    $installBannerClose.addEventListener("click", dismissInstallBanner);
  }

  // Set up iOS modal close
  if ($iosModalClose) {
    $iosModalClose.addEventListener("click", hideIOSInstallModal);
  }

  // Close iOS modal on backdrop click
  $iosModal?.querySelector(".modal-backdrop")?.addEventListener("click", hideIOSInstallModal);

  // Set up generic install modal close handlers
  const $genericModal = document.getElementById("generic-install-modal");
  const $genericModalClose = document.getElementById("generic-install-close");
  if ($genericModalClose) {
    $genericModalClose.addEventListener("click", hideGenericInstallModal);
  }
  $genericModal
    ?.querySelector(".modal-backdrop")
    ?.addEventListener("click", hideGenericInstallModal);

  // Set up settings install button
  if ($settingsInstallBtn) {
    $settingsInstallBtn.addEventListener("click", () => {
      if (pwaState.isIOS) {
        markAppAsInstalled();
        closeSettingsModal();
        showIOSInstallModal();
      } else if (pwaState.deferredPrompt) {
        triggerInstallPrompt();
      } else {
        // No native prompt available - show generic instructions
        markAppAsInstalled();
        closeSettingsModal();
        showGenericInstallModal();
      }
    });
  }

  // Initial settings button state
  updateSettingsInstallButton();
}

// ============================================
// Toast Notifications
// ============================================

let toastTimeout = null;

function showToast(message, type = "info") {
  // Clear existing toast
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  // Clear container and add new toast
  $toastContainer.innerHTML = "";
  $toastContainer.appendChild(toast);

  // Auto-remove after 4 seconds
  toastTimeout = setTimeout(() => {
    toast.remove();
  }, 4000);
}

// ============================================
// Rendering Functions
// ============================================

/**
 * Renders the device list.
 */
function renderDevices() {
  if (state.loading) {
    return; // Keep showing initial loading
  }

  for (const card of $app.querySelectorAll(".device-card[data-device-id]")) {
    if (card.querySelector(".timer-panel")) {
      const deviceId = card.dataset.deviceId;
      if (deviceId) {
        closeTimerPanel(deviceId);
      }
    }
  }

  // Hide initial loading
  $initialLoading.classList.add("hidden");

  // Note: Setup mode rendering removed - PWA setup doesn't work due to CORS
  // If user is on Wemo AP, they'll see the bridge-required modal via handleDiscover()

  // If offline with no cached data, show offline state
  if (state.isOffline && state.devices.length === 0) {
    $app.innerHTML = renderOfflineState();
    startRetryTimer();
    return;
  }

  // Show devices (possibly with offline banner)
  let offlineBanner = "";
  if (state.isOffline) {
    offlineBanner = renderOfflineBanner();
    startRetryTimer();
  } else {
    stopRetryTimer();
  }

  if (state.devices.length === 0) {
    $app.innerHTML = renderEmptyState();
    attachDeviceListeners();
    return;
  }

  $app.innerHTML = `
    ${offlineBanner}
    <div class="device-list">
      ${state.devices.map(renderDeviceCard).join("")}
    </div>
  `;

  // Attach event listeners
  attachDeviceListeners();

  // Fetch power stats for Insight devices (only if online)
  if (!state.isOffline) {
    fetchInsightStats();
  }
}

/**
 * Renders a single device card.
 */
function renderDeviceCard(device) {
  const isOn = device.state === 1;
  const isStandby = device.state === 8;
  const isOffline = !device.isOnline;
  const isInsight = device.deviceType === "Insight";

  let statusText = "Off";
  let statusClass = "";

  if (isOffline) {
    statusText = "Offline";
    statusClass = "is-offline";
  } else if (isOn) {
    statusText = "On";
    statusClass = "is-on";
  } else if (isStandby) {
    statusText = "Standby";
    statusClass = "";
  }

  const iconClass = isOn ? "is-on" : isStandby ? "is-standby" : "";

  // Power stats section for Insight devices
  const powerStatsHtml =
    isInsight && !isOffline
      ? `
      <div class="power-stats" data-power-stats="${escapeHtml(device.id)}">
        <div class="power-stat">
          <div class="power-stat-value" data-power-current>--</div>
          <div class="power-stat-label">Watts</div>
        </div>
        <div class="power-stat">
          <div class="power-stat-value" data-power-today>--</div>
          <div class="power-stat-label">kWh Today</div>
        </div>
      </div>
    `
      : "";

  const thresholdHtml =
    isInsight && !isOffline
      ? `
      <div class="threshold-control" data-threshold-control="${escapeHtml(device.id)}">
        <div class="threshold-label">Standby Threshold</div>
        <div class="threshold-input-group">
          <input type="number" min="0" max="50" step="0.5"
                 data-threshold-input="${escapeHtml(device.id)}"
                 placeholder="--" disabled>
          <span class="threshold-unit">W</span>
          <button class="threshold-reset" data-threshold-reset="${escapeHtml(device.id)}"
                  title="Reset to default" disabled>Reset</button>
        </div>
      </div>
    `
      : "";

  return `
    <div class="card device-card ${isInsight ? "device-card-insight" : ""}" data-device-id="${escapeHtml(device.id)}" data-device-type="${escapeHtml(device.deviceType)}">
      <div class="device-card-main">
        <div class="device-icon ${iconClass}">
          ${getDeviceIcon(device.deviceType)}
        </div>
        <div class="device-info">
          <div class="device-name">${escapeHtml(device.name)}</div>
          <div class="device-status ${statusClass}">${statusText}</div>
        </div>
        ${renderTimerButton(device.id)}
        <label class="toggle">
          <input 
            type="checkbox" 
            ${isOn ? "checked" : ""} 
            ${isOffline ? "disabled" : ""}
            data-action="toggle"
          >
          <span class="toggle-track"></span>
        </label>
      </div>
      ${powerStatsHtml}
      ${thresholdHtml}
    </div>
  `;
}

/**
 * Gets the icon SVG for a device type.
 */
function getDeviceIcon(_deviceType) {
  // Power plug icon for all types
  return `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2v10"/>
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>
    </svg>
  `;
}

/**
 * Renders the empty state with first-run setup options.
 */
function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v10"/>
          <path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>
        </svg>
      </div>
      <h2 class="empty-state-title">Welcome to Open Wemo</h2>
      <p class="empty-state-text">
        Get started by adding your WeMo devices.
      </p>
      <div class="empty-state-actions">
        <button class="btn btn-primary" id="discover-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          Find Devices on Network
        </button>
        <button class="btn" id="setup-new-device-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          Set Up New Device
        </button>
      </div>
      <p class="empty-state-hint">
        <strong>Find Devices</strong> - For WeMo devices already on your WiFi<br>
        <strong>Set Up New Device</strong> - For brand new or factory-reset devices
      </p>
    </div>
  `;
}

/**
 * Renders an error state.
 * @param {Error|{message?: string}} error - The error to display
 * @returns {string} HTML string for the error state
 */
// biome-ignore lint/correctness/noUnusedVariables: May be used for error boundary expansion
function renderError(error) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon text-error">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h2 class="empty-state-title">Connection Error</h2>
      <p class="empty-state-text">
        ${escapeHtml(error.message || "Unable to connect to the bridge.")}
      </p>
      <button class="btn btn-primary" id="retry-btn">
        Try Again
      </button>
    </div>
  `;
}

/**
 * Renders the offline state (no cached data).
 */
function renderOfflineState() {
  return `
    <div class="empty-state offline-state">
      <div class="empty-state-icon text-error">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
          <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
      </div>
      <h2 class="empty-state-title">Bridge Offline</h2>
      <p class="empty-state-text">
        Make sure Open Wemo is running on your computer and connected to the same network.
      </p>
      <button class="btn btn-primary" id="retry-connection-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        Retry Connection
      </button>
      <p class="offline-retry-hint">Automatically retrying every 10 seconds...</p>
    </div>
  `;
}

/**
 * Renders the offline banner (when we have cached data).
 */
function renderOfflineBanner() {
  const timeAgo = formatRelativeTime(state.lastUpdated);

  return `
    <div class="offline-banner">
      <div class="offline-banner-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
        </svg>
      </div>
      <div class="offline-banner-text">
        <strong>Bridge Offline</strong>
        <span>Last updated ${timeAgo}</span>
      </div>
      <button class="btn btn-sm" id="retry-connection-btn">Retry</button>
    </div>
  `;
}

// ============================================
// Setup Mode (DEPRECATED)
// ============================================
// Note: PWA-based device setup has been disabled due to browser CORS limitations.
// The browser cannot send the required SOAPACTION header needed for Wemo SOAP commands.
// Device setup must now be done from the bridge application:
//   1. Right-click the tray icon
//   2. Select "Setup New Device"
//   3. Follow the on-screen wizard
//
// The functions below are kept minimal - only enterSetupMode is used to show
// the bridge-required message when a user accidentally connects to a Wemo AP.

/**
 * Shows the bridge-required message when user is on Wemo AP.
 * Previously this entered a PWA-based setup mode, but browser CORS restrictions
 * prevent proper SOAP communication, so setup must be done from the bridge.
 * @deprecated PWA setup mode removed - use bridge "Setup New Device" menu instead
 */
function enterSetupMode() {
  // Show the bridge-required instructions modal instead of entering setup mode
  showSetupInstructionsModal();
}

// ============================================
// Power Stats (Insight Devices)
// ============================================

/**
 * Fetches power stats for all Insight devices.
 */
async function fetchInsightStats() {
  const insightDevices = state.devices.filter((d) => d.deviceType === "Insight" && d.isOnline);

  // Fetch in parallel
  await Promise.all(insightDevices.map(fetchDevicePowerStats));
}

/**
 * Fetches and displays power stats for a single device.
 */
async function fetchDevicePowerStats(device) {
  const statsEl = document.querySelector(`[data-power-stats="${device.id}"]`);
  if (!statsEl) return;

  try {
    const result = await api.getInsightData(device.id);
    const { power } = result;

    // Update the display
    const currentEl = statsEl.querySelector("[data-power-current]");
    const todayEl = statsEl.querySelector("[data-power-today]");

    if (currentEl) {
      currentEl.textContent = formatPower(power.currentWatts);
    }
    if (todayEl) {
      todayEl.textContent = formatEnergy(power.todayKwh);
    }

    const thresholdInput = document.querySelector(`[data-threshold-input="${device.id}"]`);
    if (thresholdInput && result.raw?.standbyThreshold != null) {
      thresholdInput.value = (result.raw.standbyThreshold / 1000).toFixed(1);
      thresholdInput.disabled = false;
      thresholdInput._lastGoodValue = thresholdInput.value;
      const resetBtn = document.querySelector(`[data-threshold-reset="${device.id}"]`);
      if (resetBtn) resetBtn.disabled = false;
    }
  } catch (error) {
    console.warn(`[App] Failed to fetch power stats for ${device.id}:`, error);
    // Leave as "--" on error
  }
}

/**
 * Formats power value (watts) for display.
 */
function formatPower(watts) {
  if (watts < 1) {
    return "< 1";
  }
  if (watts < 10) {
    return watts.toFixed(1);
  }
  return Math.round(watts).toString();
}

/**
 * Formats energy value (kWh) for display.
 */
function formatEnergy(kwh) {
  if (kwh < 0.01) {
    return "< 0.01";
  }
  if (kwh < 1) {
    return kwh.toFixed(2);
  }
  if (kwh < 10) {
    return kwh.toFixed(1);
  }
  return Math.round(kwh).toString();
}

// ============================================
// Event Handlers
// ============================================

/**
 * Attaches event listeners to device cards.
 */
function attachDeviceListeners() {
  // Toggle switches
  for (const toggle of $app.querySelectorAll('[data-action="toggle"]')) {
    toggle.addEventListener("change", handleToggle);
  }

  for (const timerBtn of $app.querySelectorAll('[data-action="timer"]')) {
    const card = timerBtn.closest("[data-device-id]");
    const isOffline = card?.querySelector(".device-status")?.classList.contains("is-offline");
    if (isOffline) {
      timerBtn.disabled = true;
    }
    timerBtn.addEventListener("click", handleTimerClick);
  }

  // Threshold change handlers (Insight devices)
  for (const input of $app.querySelectorAll("[data-threshold-input]")) {
    input.addEventListener("change", handleThresholdChange);
  }
  for (const btn of $app.querySelectorAll("[data-threshold-reset]")) {
    btn.addEventListener("click", handleThresholdReset);
  }

  // Discover button
  const discoverBtn = document.getElementById("discover-btn");
  if (discoverBtn) {
    discoverBtn.addEventListener("click", handleDiscover);
  }

  // Setup new device button (for devices in AP mode)
  const setupNewDeviceBtn = document.getElementById("setup-new-device-btn");
  if (setupNewDeviceBtn) {
    setupNewDeviceBtn.addEventListener("click", handleSetupNewDevice);
  }

  // Retry button (error state)
  const retryBtn = document.getElementById("retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", loadDevices);
  }

  // Retry connection button (offline state)
  const retryConnectionBtn = document.getElementById("retry-connection-btn");
  if (retryConnectionBtn) {
    retryConnectionBtn.addEventListener("click", handleRetryConnection);
  }
}

/**
 * Handles device toggle.
 */
async function handleToggle(event) {
  const toggle = event.target;
  const card = toggle.closest("[data-device-id]");
  const deviceId = card.dataset.deviceId;

  // Haptic feedback on mobile
  if (navigator.vibrate) {
    navigator.vibrate(10);
  }

  // Disable toggle while processing
  toggle.disabled = true;

  try {
    const result = await api.toggle(deviceId);

    // Update local state
    const device = state.devices.find((d) => d.id === deviceId);
    if (device) {
      device.state = result.state;
      device.isOnline = true;
    }

    // Update UI
    toggle.checked = result.isOn;
    updateDeviceCardState(card, result.state);

    // Success haptic
    if (navigator.vibrate) {
      navigator.vibrate([10, 50, 10]);
    }
  } catch (error) {
    console.error("[App] Toggle failed:", error);

    // Revert toggle state
    toggle.checked = !toggle.checked;

    // Error haptic
    if (navigator.vibrate) {
      navigator.vibrate([50, 50, 50]);
    }

    showToast(error.message || "Failed to toggle device", "error");
  } finally {
    toggle.disabled = false;
  }
}

async function handleThresholdChange(event) {
  const input = event.target;
  const card = input.closest("[data-device-id]");
  const deviceId = card.dataset.deviceId;
  const watts = Number.parseFloat(input.value);

  if (Number.isNaN(watts) || watts < 0 || watts > 50) {
    input.value = input._lastGoodValue || "";
    showToast("Threshold must be between 0 and 50 watts", "error");
    return;
  }

  try {
    const result = await api.setThreshold(deviceId, watts);
    input.value = result.thresholdWatts.toFixed(1);
    input._lastGoodValue = input.value;
  } catch (error) {
    input.value = input._lastGoodValue || "";
    showToast(error.message || "Failed to update threshold", "error");
  }
}

async function handleThresholdReset(event) {
  const btn = event.currentTarget;
  const deviceId = btn.dataset.thresholdReset;
  const input = document.querySelector(`[data-threshold-input="${deviceId}"]`);

  btn.disabled = true;
  try {
    const result = await api.resetThreshold(deviceId);
    if (input) {
      input.value = result.thresholdWatts.toFixed(1);
      input._lastGoodValue = input.value;
    }
  } catch (error) {
    showToast(error.message || "Failed to reset threshold", "error");
  } finally {
    btn.disabled = false;
  }
}

function handleTimerClick(event) {
  const btn = event.currentTarget;
  const card = btn.closest("[data-device-id]");
  if (!card) return;
  const deviceId = card.dataset.deviceId;
  toggleTimerPanel(deviceId, card);
}

/**
 * Updates a device card's visual state.
 */
function updateDeviceCardState(card, binaryState) {
  const isOn = binaryState === 1;
  const isStandby = binaryState === 8;

  const icon = card.querySelector(".device-icon");
  const status = card.querySelector(".device-status");

  icon.classList.remove("is-on", "is-standby");
  status.classList.remove("is-on", "is-offline");

  if (isOn) {
    icon.classList.add("is-on");
    status.classList.add("is-on");
    status.textContent = "On";
  } else if (isStandby) {
    icon.classList.add("is-standby");
    status.textContent = "Standby";
  } else {
    status.textContent = "Off";
  }
}

// ============================================
// Discovery Modal
// ============================================

let discoveredDevices = [];
const selectedDeviceIds = new Set();

/**
 * Opens the discovery modal.
 */
function openDiscoveryModal() {
  discoveredDevices = [];
  selectedDeviceIds.clear();
  renderDiscoveryScanning();
  $discoveryModal.classList.remove("hidden");
  trapFocus($discoveryModal);
  startDiscovery();
  announceToScreenReader("Device discovery started");
}

/**
 * Closes the discovery modal.
 */
function closeDiscoveryModal() {
  $discoveryModal.classList.add("hidden");
}

/**
 * Renders the scanning state.
 */
function renderDiscoveryScanning() {
  $discoveryContent.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Scanning network for WeMo devices...</p>
    </div>
  `;
  $discoveryFooter.innerHTML = `
    <button class="btn" id="discovery-cancel">Cancel</button>
  `;
  document.getElementById("discovery-cancel")?.addEventListener("click", closeDiscoveryModal);
}

/**
 * Renders the discovery results.
 */
function renderDiscoveryResults() {
  if (discoveredDevices.length === 0) {
    $discoveryContent.innerHTML = `
      <div class="empty-state">
        <p class="text-muted">No devices found on the network.</p>
        <p class="text-muted" style="font-size: var(--font-size-sm);">
          Make sure your WeMo devices are powered on and connected to the same network.
        </p>
      </div>
    `;
    $discoveryFooter.innerHTML = `
      <button class="btn" id="discovery-retry">Scan Again</button>
      <button class="btn" id="discovery-close-btn">Close</button>
    `;
    document.getElementById("discovery-retry")?.addEventListener("click", () => {
      renderDiscoveryScanning();
      startDiscovery();
    });
    document.getElementById("discovery-close-btn")?.addEventListener("click", closeDiscoveryModal);
    return;
  }

  const savedIds = new Set(state.devices.map((d) => d.id));

  $discoveryContent.innerHTML = `
    <div class="discovery-list">
      ${discoveredDevices
        .map((device) => {
          const isSaved = savedIds.has(device.id);
          return `
          <label class="discovery-item ${isSaved ? "is-saved" : ""}">
            <input 
              type="checkbox" 
              class="discovery-checkbox"
              data-device-id="${escapeHtml(device.id)}"
              ${isSaved ? "disabled" : ""}
              ${selectedDeviceIds.has(device.id) ? "checked" : ""}
            >
            <div class="discovery-info">
              <div class="discovery-name">${escapeHtml(device.name)}</div>
              <div class="discovery-details">${escapeHtml(device.host)} - ${escapeHtml(device.deviceType)}</div>
            </div>
            ${isSaved ? '<span class="discovery-badge is-saved">Saved</span>' : ""}
          </label>
        `;
        })
        .join("")}
    </div>
  `;

  const newDevices = discoveredDevices.filter((d) => !savedIds.has(d.id));
  const hasNewDevices = newDevices.length > 0;

  $discoveryFooter.innerHTML = `
    <button class="btn" id="discovery-retry">Scan Again</button>
    <button class="btn btn-primary" id="discovery-add" ${!hasNewDevices ? "disabled" : ""}>
      Add Selected
    </button>
  `;

  // Attach listeners
  document.getElementById("discovery-retry")?.addEventListener("click", () => {
    renderDiscoveryScanning();
    startDiscovery();
  });
  document.getElementById("discovery-add")?.addEventListener("click", handleAddSelected);

  // Checkbox listeners
  for (const checkbox of $discoveryContent.querySelectorAll(".discovery-checkbox")) {
    checkbox.addEventListener("change", (e) => {
      const id = e.target.dataset.deviceId;
      if (e.target.checked) {
        selectedDeviceIds.add(id);
      } else {
        selectedDeviceIds.delete(id);
      }
      updateAddButton();
    });
  }
}

/**
 * Updates the Add Selected button state.
 */
function updateAddButton() {
  const addBtn = document.getElementById("discovery-add");
  if (addBtn) {
    addBtn.disabled = selectedDeviceIds.size === 0;
  }
}

/**
 * Starts the discovery process.
 */
async function startDiscovery() {
  try {
    const result = await api.discover(10);
    discoveredDevices = result.devices;

    // Auto-select all new devices
    const savedIds = new Set(state.devices.map((d) => d.id));
    for (const device of discoveredDevices) {
      if (!savedIds.has(device.id)) {
        selectedDeviceIds.add(device.id);
      }
    }

    renderDiscoveryResults();
  } catch (error) {
    console.error("[App] Discovery failed:", error);
    $discoveryContent.innerHTML = `
      <div class="empty-state">
        <p class="text-error">${escapeHtml(error.message || "Discovery failed")}</p>
      </div>
    `;
    $discoveryFooter.innerHTML = `
      <button class="btn" id="discovery-retry">Try Again</button>
      <button class="btn" id="discovery-close-btn">Close</button>
    `;
    document.getElementById("discovery-retry")?.addEventListener("click", () => {
      renderDiscoveryScanning();
      startDiscovery();
    });
    document.getElementById("discovery-close-btn")?.addEventListener("click", closeDiscoveryModal);
  }
}

/**
 * Handles adding selected devices.
 */
async function handleAddSelected() {
  const addBtn = document.getElementById("discovery-add");
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.innerHTML = '<span class="spinner spinner-sm"></span> Adding...';
  }

  try {
    const devicesToAdd = discoveredDevices.filter((d) => selectedDeviceIds.has(d.id));

    for (const device of devicesToAdd) {
      await api.saveDevice({
        id: device.id,
        name: device.name,
        host: device.host,
        port: device.port,
        deviceType: device.deviceType,
      });
    }

    showToast(`Added ${devicesToAdd.length} device(s)`, "success");
    closeDiscoveryModal();
    await loadDevices();
  } catch (error) {
    console.error("[App] Failed to add devices:", error);
    showToast(error.message || "Failed to add devices", "error");
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.textContent = "Add Selected";
    }
  }
}

/**
 * Handles device discovery (from empty state button or Add Device button).
 * First checks if we're connected to a Wemo AP for setup mode.
 */
async function handleDiscover() {
  // Check if we might be on a Wemo AP
  const networkMode = await detectNetworkMode();

  if (networkMode === NetworkMode.SETUP_MODE) {
    // User is connected to Wemo AP - show bridge-required message
    // PWA cannot do setup due to browser CORS restrictions
    showToast("Connected to WeMo AP - setup must be done from the bridge", "info");
    showSetupInstructionsModal();
    return;
  }

  // Normal discovery flow
  openDiscoveryModal();
}

// ============================================
// Setup Instructions Modal
// ============================================

/**
 * Handles "Set Up New Device" button click.
 * Shows instructions that device setup must be done from the bridge.
 * Browser CORS restrictions prevent PWA from doing direct setup.
 */
function handleSetupNewDevice() {
  showSetupInstructionsModal();
}

/**
 * Shows the setup instructions modal.
 */
function showSetupInstructionsModal() {
  if ($setupInstructionsModal) {
    $setupInstructionsModal.classList.remove("hidden");
    trapFocus($setupInstructionsModal);
    announceToScreenReader("Setup instructions opened");
  }
}

/**
 * Hides the setup instructions modal.
 */
function hideSetupInstructionsModal() {
  if ($setupInstructionsModal) {
    $setupInstructionsModal.classList.add("hidden");
  }
}

/**
 * Sets up setup instructions modal event listeners.
 * Now just shows informational message about using bridge for setup.
 */
function setupSetupInstructionsListeners() {
  if ($setupInstructionsClose) {
    $setupInstructionsClose.addEventListener("click", hideSetupInstructionsModal);
  }
  if ($setupInstructionsCancel) {
    // "Got It" button now dismisses the modal
    $setupInstructionsCancel.addEventListener("click", hideSetupInstructionsModal);
  }
  // Close on backdrop click
  $setupInstructionsModal
    ?.querySelector(".modal-backdrop")
    ?.addEventListener("click", hideSetupInstructionsModal);
}

/**
 * Handles refresh button click.
 */
async function handleRefresh() {
  $refreshBtn.disabled = true;
  $refreshBtn.classList.add("animate-pulse");

  try {
    await loadDevices();
    showToast("Devices refreshed", "success");
  } catch (_error) {
    // Error already shown by loadDevices
  } finally {
    $refreshBtn.disabled = false;
    $refreshBtn.classList.remove("animate-pulse");
  }
}

// ============================================
// Data Loading
// ============================================

/**
 * Loads devices from the API.
 */
async function loadDevices() {
  state.loading = true;
  state.error = null;

  try {
    const result = await api.getDevices(true);
    state.devices = result.devices;
    state.error = null;
    state.isOffline = false;
    state.networkMode = NetworkMode.NORMAL;
    state.lastUpdated = Date.now();

    // Cache devices to localStorage
    cacheDevices(result.devices);
  } catch (error) {
    console.error("[App] Failed to load devices:", error);
    state.error = error;
    state.isOffline = true;

    // Detect network mode - are we on Wemo AP?
    const networkMode = await detectNetworkMode();
    state.networkMode = networkMode;

    if (networkMode === NetworkMode.SETUP_MODE) {
      // User is on Wemo AP - show bridge-required message
      // PWA cannot do setup due to browser CORS restrictions
      console.log("[App] Detected Wemo AP - showing bridge-required message");
      state.loading = false;
      renderDevices();
      showSetupInstructionsModal();
      return;
    }

    // Try to load from cache
    const cached = loadCachedDevices();
    if (cached) {
      state.devices = cached.devices;
      state.lastUpdated = cached.timestamp;
      console.log("[App] Loaded cached devices from", new Date(cached.timestamp).toLocaleString());
    } else {
      state.devices = [];
    }
  } finally {
    state.loading = false;
    renderDevices();
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Escapes HTML special characters.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Auto-Refresh
// ============================================

let autoRefreshTimer = null;

/**
 * Starts auto-refresh timer.
 */
function startAutoRefresh() {
  stopAutoRefresh();

  const interval = state.settings.refreshInterval;
  if (interval <= 0) {
    console.log("[App] Auto-refresh disabled");
    return;
  }

  autoRefreshTimer = setInterval(async () => {
    // Skip refresh in setup mode - user is selecting text
    if (state.networkMode === NetworkMode.SETUP_MODE) {
      console.log("[App] Auto-refresh skipped (setup mode)");
      return;
    }
    // Only refresh if page is visible
    if (document.visibilityState === "visible" && !state.loading) {
      console.log("[App] Auto-refreshing devices...");
      await loadDevices();
    }
  }, interval);

  console.log(`[App] Auto-refresh started (${interval / 1000}s)`);
}

/**
 * Stops auto-refresh timer.
 */
function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// ============================================
// Settings Management
// ============================================

const SETTINGS_KEY = "open-wemo-settings";

/**
 * Loads settings from localStorage.
 */
function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state.settings = { ...state.settings, ...parsed };
    }
  } catch (error) {
    console.warn("[App] Failed to load settings:", error);
  }

  // Apply settings
  applyTheme(state.settings.theme);
  updateSettingsUI();
}

/**
 * Saves settings to localStorage.
 */
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (error) {
    console.warn("[App] Failed to save settings:", error);
  }
}

/**
 * Updates the settings UI to reflect current state.
 */
function updateSettingsUI() {
  // Update refresh interval radios
  const refreshRadios = document.querySelectorAll('input[name="refresh-interval"]');
  for (const radio of refreshRadios) {
    radio.checked = Number.parseInt(radio.value, 10) === state.settings.refreshInterval;
  }

  // Update theme radios
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  for (const radio of themeRadios) {
    radio.checked = radio.value === state.settings.theme;
  }
}

/**
 * Applies the selected theme.
 */
function applyTheme(theme) {
  const html = document.documentElement;

  if (theme === "system") {
    // Check system preference
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    html.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    html.setAttribute("data-theme", theme);
  }

  // Update meta theme-color for mobile browsers
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    const isDark = html.getAttribute("data-theme") === "dark";
    metaTheme.setAttribute("content", isDark ? "#1a1a2e" : "#ffffff");
  }
}

/**
 * Opens the settings modal.
 */
function openSettingsModal() {
  updateSettingsUI();
  updateBridgeStatus();
  $settingsModal.classList.remove("hidden");
}

/**
 * Closes the settings modal.
 */
function closeSettingsModal() {
  $settingsModal.classList.add("hidden");
}

/**
 * Handles refresh interval change.
 */
function handleRefreshIntervalChange(event) {
  const value = Number.parseInt(event.target.value, 10);
  state.settings.refreshInterval = value;
  saveSettings();

  // Restart auto-refresh with new interval
  stopAutoRefresh();
  if (value > 0) {
    startAutoRefresh();
  }

  showToast(`Auto-refresh ${value > 0 ? "updated" : "disabled"}`, "success");
}

/**
 * Handles theme change.
 */
function handleThemeChange(event) {
  const theme = event.target.value;
  state.settings.theme = theme;
  saveSettings();
  applyTheme(theme);
  showToast("Theme updated", "success");
}

/**
 * Updates the bridge status display.
 */
async function updateBridgeStatus() {
  try {
    const response = await fetch("/api/health");
    if (response.ok) {
      $bridgeStatus.innerHTML = `
        <span class="status-dot status-dot-connected"></span>
        Connected
      `;
    } else {
      throw new Error("Not OK");
    }
  } catch {
    $bridgeStatus.innerHTML = `
      <span class="status-dot status-dot-disconnected"></span>
      Disconnected
    `;
  }
}

// ============================================
// Offline Support & Caching
// ============================================

const DEVICES_CACHE_KEY = "open-wemo-devices-cache";
const RETRY_INTERVAL = 10000; // 10 seconds
let retryTimer = null;

/**
 * Caches devices to localStorage.
 */
function cacheDevices(devices) {
  try {
    const cache = {
      devices,
      timestamp: Date.now(),
    };
    localStorage.setItem(DEVICES_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("[App] Failed to cache devices:", error);
  }
}

/**
 * Loads cached devices from localStorage.
 */
function loadCachedDevices() {
  try {
    const cached = localStorage.getItem(DEVICES_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn("[App] Failed to load cached devices:", error);
  }
  return null;
}

/**
 * Formats a relative time string.
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return "never";

  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 120) return "1 minute ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 7200) return "1 hour ago";
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return "a while ago";
}

/**
 * Starts the auto-retry timer for offline state.
 */
function startRetryTimer() {
  stopRetryTimer();

  retryTimer = setInterval(async () => {
    if (state.isOffline && document.visibilityState === "visible") {
      console.log("[App] Attempting to reconnect...");
      await loadDevices();

      if (!state.isOffline) {
        showToast("Reconnected to bridge", "success");
        stopRetryTimer();
      }
    }
  }, RETRY_INTERVAL);
}

/**
 * Stops the auto-retry timer.
 */
function stopRetryTimer() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

/**
 * Handles manual retry button click.
 */
async function handleRetryConnection() {
  showToast("Attempting to reconnect...", "info");
  await loadDevices();

  if (!state.isOffline) {
    showToast("Reconnected!", "success");
  } else {
    showToast("Still offline. Will keep trying.", "error");
  }
}

// ============================================
// Accessibility Helpers
// ============================================

/**
 * Traps focus within a modal dialog.
 */
function trapFocus(modal) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  // Focus first element
  firstFocusable?.focus();

  modal.addEventListener("keydown", function handleTabKey(e) {
    if (e.key === "Tab") {
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }
  });
}

/**
 * Handles Escape key to close modals.
 */
function setupEscapeKeyHandler() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$settingsModal.classList.contains("hidden")) {
        closeSettingsModal();
      }
      if (!$discoveryModal.classList.contains("hidden")) {
        closeDiscoveryModal();
      }
      if ($iosModal && !$iosModal.classList.contains("hidden")) {
        hideIOSInstallModal();
      }
      const $genericModal = document.getElementById("generic-install-modal");
      if ($genericModal && !$genericModal.classList.contains("hidden")) {
        hideGenericInstallModal();
      }
      if ($qrModal && !$qrModal.classList.contains("hidden")) {
        hideQRModal();
      }
      if ($setupInstructionsModal && !$setupInstructionsModal.classList.contains("hidden")) {
        hideSetupInstructionsModal();
      }
      const $timerFormModal = document.getElementById("timer-form-modal");
      if ($timerFormModal) {
        $timerFormModal.remove();
      }
    }
  });
}

/**
 * Announces message to screen readers.
 */
function announceToScreenReader(message) {
  const announcement = document.createElement("div");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");
  announcement.className = "sr-only";
  announcement.textContent = message;
  document.body.appendChild(announcement);

  setTimeout(() => announcement.remove(), 1000);
}

/**
 * Sets up settings event listeners.
 */
function setupSettingsListeners() {
  // Open/close modal
  $settingsBtn.addEventListener("click", () => {
    openSettingsModal();
    trapFocus($settingsModal);
  });
  $settingsClose.addEventListener("click", closeSettingsModal);
  $settingsModal.querySelector(".modal-backdrop")?.addEventListener("click", closeSettingsModal);

  // Refresh interval change
  const refreshRadios = document.querySelectorAll('input[name="refresh-interval"]');
  for (const radio of refreshRadios) {
    radio.addEventListener("change", handleRefreshIntervalChange);
  }

  // Theme change
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  for (const radio of themeRadios) {
    radio.addEventListener("change", handleThemeChange);
  }

  // Listen for system theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.settings.theme === "system") {
      applyTheme("system");
    }
  });

  // Share button (QR code)
  if ($settingsShareBtn) {
    $settingsShareBtn.addEventListener("click", () => {
      closeSettingsModal();
      showQRModal();
    });
  }

  // QR modal close
  if ($qrModalClose) {
    $qrModalClose.addEventListener("click", hideQRModal);
  }
  $qrModal?.querySelector(".modal-backdrop")?.addEventListener("click", hideQRModal);
}

// ============================================
// QR Code Modal
// ============================================

/**
 * Shows the QR code modal and generates the QR code.
 */
function showQRModal() {
  if (!$qrModal) return;

  $qrModal.classList.remove("hidden");
  trapFocus($qrModal);
  generateQRCode();
}

/**
 * Hides the QR code modal.
 */
function hideQRModal() {
  if ($qrModal) {
    $qrModal.classList.add("hidden");
  }
}

/**
 * Generates a QR code for the server's LAN URL.
 * Fetches the actual LAN IP from the server to ensure the QR code
 * works when accessed via localhost.
 */
async function generateQRCode() {
  if (!$qrCodeContainer || !$qrModalUrl) return;

  // Show loading state
  $qrCodeContainer.innerHTML = '<div class="qr-code-loading">Loading...</div>';

  // Get the LAN URL from the server (handles localhost -> LAN IP conversion)
  let url = window.location.origin; // fallback
  try {
    const response = await fetch("/api/info");
    if (response.ok) {
      const info = await response.json();
      if (info.url) {
        url = info.url;
      }
    }
  } catch (error) {
    console.warn("[App] Could not fetch server info, using current origin:", error);
  }

  $qrModalUrl.textContent = url;

  // Clear previous QR code
  $qrCodeContainer.innerHTML = "";

  try {
    // Check if qrcode library is loaded
    if (typeof qrcode === "undefined") {
      throw new Error("QR code library not loaded");
    }

    // Generate QR code using qrcode-generator library
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();

    // Create the QR code as an image
    const img = document.createElement("img");
    img.src = qr.createDataURL(6, 0);
    img.alt = "QR code to install Open Wemo";
    $qrCodeContainer.appendChild(img);
  } catch (error) {
    console.error("[App] Failed to generate QR code:", error);
    $qrCodeContainer.innerHTML = `
      <div class="qr-code-error">
        <p>Could not generate QR code</p>
        <p class="text-muted">${url}</p>
      </div>
    `;
  }
}

// ============================================
// Initialization
// ============================================

async function init() {
  console.log("[App] Initializing Open Wemo...");

  // Load settings from localStorage
  loadSettings();

  // Register service worker
  await registerServiceWorker();

  // Set up PWA install handling
  setupPWAInstall();

  // Attach global event listeners
  $refreshBtn.addEventListener("click", handleRefresh);
  $addDeviceBtn.addEventListener("click", openDiscoveryModal);
  $discoveryClose.addEventListener("click", closeDiscoveryModal);

  // Close modal on backdrop click
  $discoveryModal.querySelector(".modal-backdrop")?.addEventListener("click", closeDiscoveryModal);

  // Set up settings listeners
  setupSettingsListeners();

  // Set up setup instructions modal listeners
  setupSetupInstructionsListeners();

  // Set up accessibility handlers
  setupEscapeKeyHandler();

  initTimerPanel({ showToast, announceToScreenReader, trapFocus });

  // Handle visibility change (pause auto-refresh when tab hidden)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // Refresh immediately when becoming visible
      loadDevices();
    }
  });

  // Initial load
  await loadDevices();

  // Start auto-refresh (if enabled)
  startAutoRefresh();

  console.log("[App] Initialization complete");
}

// Start the app
init();
