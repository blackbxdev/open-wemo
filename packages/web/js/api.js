/**
 * Open Wemo API Client
 *
 * Handles all communication with the bridge REST API.
 */

/**
 * API configuration
 */
const API_BASE = "/api";
const DEFAULT_TIMEOUT = 10000;

/**
 * Custom error class for API errors.
 */
export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Makes an API request with timeout and error handling.
 *
 * @param {string} endpoint - API endpoint (without /api prefix)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function request(endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.message || "Request failed",
        data.code || "UNKNOWN_ERROR",
        response.status
      );
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      throw new ApiError("Request timed out", "TIMEOUT", 408);
    }

    if (error instanceof ApiError) {
      throw error;
    }

    // Network error
    throw new ApiError("Unable to connect to bridge. Is it running?", "NETWORK_ERROR", 0);
  }
}

/**
 * API client object with all available methods.
 */
export const api = {
  /**
   * Health check - verify bridge is running.
   * @returns {Promise<{status: string, timestamp: string, uptime: number}>}
   */
  async health() {
    return request("/health");
  },

  /**
   * Get all saved devices.
   * @param {boolean} includeState - Include current device state (slower)
   * @returns {Promise<{devices: Array}>}
   */
  async getDevices(includeState = false) {
    const query = includeState ? "?includeState=true" : "";
    return request(`/devices${query}`);
  },

  /**
   * Get a single device by ID.
   * @param {string} id - Device ID
   * @returns {Promise<{device: Object}>}
   */
  async getDevice(id) {
    return request(`/devices/${encodeURIComponent(id)}`);
  },

  /**
   * Get device state only (lightweight).
   * @param {string} id - Device ID
   * @returns {Promise<{id: string, state: number, isOn: boolean}>}
   */
  async getDeviceState(id) {
    return request(`/devices/${encodeURIComponent(id)}/state`);
  },

  /**
   * Add or update a device.
   * @param {Object} device - Device data
   * @returns {Promise<{device: Object, created: boolean}>}
   */
  async saveDevice(device) {
    return request("/devices", {
      method: "POST",
      body: JSON.stringify(device),
    });
  },

  /**
   * Update device properties.
   * @param {string} id - Device ID
   * @param {Object} updates - Properties to update
   * @returns {Promise<{device: Object}>}
   */
  async updateDevice(id, updates) {
    return request(`/devices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  },

  /**
   * Delete a device.
   * @param {string} id - Device ID
   * @returns {Promise<{deleted: boolean, id: string}>}
   */
  async deleteDevice(id) {
    return request(`/devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  /**
   * Turn device on.
   * @param {string} id - Device ID
   * @returns {Promise<{id: string, action: string, state: number, isOn: boolean}>}
   */
  async turnOn(id) {
    return request(`/devices/${encodeURIComponent(id)}/on`, {
      method: "POST",
    });
  },

  /**
   * Turn device off.
   * @param {string} id - Device ID
   * @returns {Promise<{id: string, action: string, state: number, isOn: boolean}>}
   */
  async turnOff(id) {
    return request(`/devices/${encodeURIComponent(id)}/off`, {
      method: "POST",
    });
  },

  /**
   * Toggle device state.
   * @param {string} id - Device ID
   * @returns {Promise<{id: string, action: string, state: number, isOn: boolean}>}
   */
  async toggle(id) {
    return request(`/devices/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
    });
  },

  /**
   * Get Insight power data.
   * @param {string} id - Device ID (must be Insight device)
   * @returns {Promise<{id: string, power: Object, raw: Object}>}
   */
  async getInsightData(id) {
    return request(`/devices/${encodeURIComponent(id)}/insight`);
  },

  /**
   * Discover devices on the network.
   * @param {number} timeout - Discovery timeout in seconds (default: 5)
   * @returns {Promise<{devices: Array, duration: number}>}
   */
  async discover(timeout = 5) {
    return request(`/discover?timeout=${timeout}`, {
      timeout: (timeout + 5) * 1000, // Add buffer to request timeout
    });
  },

  /**
   * Get device at specific address.
   * @param {string} host - Device IP address
   * @param {number} port - Device port (default: 49153)
   * @returns {Promise<{device: Object}>}
   */
  async getDeviceAtAddress(host, port = 49153) {
    return request(`/discover/${encodeURIComponent(host)}?port=${port}`);
  },

  /**
   * Get all timer rules for a device.
   * @param {string} id - Device ID
   * @returns {Promise<{timers: Array, dbVersion: number}>}
   */
  async getTimers(id) {
    return request(`/devices/${encodeURIComponent(id)}/timers`);
  },

  /**
   * Create a new timer rule.
   * @param {string} id - Device ID
   * @param {Object} timer - Timer data (name, startTime, startAction, dayId, etc.)
   * @returns {Promise<{timer: Object}>}
   */
  async createTimer(id, timer) {
    return request(`/devices/${encodeURIComponent(id)}/timers`, {
      method: "POST",
      body: JSON.stringify(timer),
    });
  },

  /**
   * Update a timer rule.
   * @param {string} id - Device ID
   * @param {number} ruleId - Rule ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<{timer: Object}>}
   */
  async updateTimer(id, ruleId, updates) {
    return request(`/devices/${encodeURIComponent(id)}/timers/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  },

  /**
   * Delete a timer rule.
   * @param {string} id - Device ID
   * @param {number} ruleId - Rule ID
   * @returns {Promise<{deleted: boolean, ruleId: number}>}
   */
  async deleteTimer(id, ruleId) {
    return request(`/devices/${encodeURIComponent(id)}/timers/${ruleId}`, {
      method: "DELETE",
    });
  },

  /**
   * Toggle a timer rule enabled/disabled.
   * @param {string} id - Device ID
   * @param {number} ruleId - Rule ID
   * @param {boolean} enabled - Desired enabled state
   * @returns {Promise<{timer: Object}>}
   */
  async toggleTimer(id, ruleId, enabled) {
    return request(`/devices/${encodeURIComponent(id)}/timers/${ruleId}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  },
};

export default api;
