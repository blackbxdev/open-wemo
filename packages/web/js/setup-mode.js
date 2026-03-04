/**
 * Setup Mode Detection Module
 *
 * Detects when the phone is connected to a Wemo device's AP (Access Point)
 * for initial device setup, and provides CORS connectivity tests.
 *
 * Wemo devices in setup mode:
 * - Broadcast AP with SSID pattern: "Wemo.<DeviceType>.<XXX>" (e.g., "Wemo.Insight.123")
 * - Are reachable at 10.22.22.1:49152
 * - Respond to SOAP/HTTP requests for WiFi configuration
 */

import { log } from "./logger.js";

// ============================================
// Constants
// ============================================

/** IP address of Wemo device in AP mode */
export const WEMO_AP_IP = "10.22.22.1";

/** Port used by Wemo device in AP mode */
export const WEMO_AP_PORT = 49152;

/** Base URL for Wemo device in AP mode */
export const WEMO_SETUP_URL = `http://${WEMO_AP_IP}:${WEMO_AP_PORT}`;

/** Timeout for connectivity checks (ms) */
const CONNECTIVITY_TIMEOUT = 3000;

/**
 * Test names used by CORS connectivity tests.
 * Shared between setup-mode.js and app.js for consistency.
 * @readonly
 */
export const TEST_NAMES = {
  NO_CORS_GET: "GET /setup.xml (no-cors)",
  CORS_GET: "GET /setup.xml",
  FETCH_SCRIPT_TAG: "Load via <script> tag",
  FETCH_OBJECT_TAG: "Load via <object> tag",
  JSONP_CALLBACK: "JSONP callback attempt",
  SOAP_POST: "SOAP POST (BasicEvent)",
  SOAP_TEXT_PLAIN: "SOAP POST (text/plain hack)",
  SOAP_FORM_URLENCODED: "SOAP POST (form-urlencoded)",
  SEND_BEACON: "sendBeacon (fire-and-forget)",
  WEBSOCKET_PROBE: "WebSocket probe",
  WIFI_SETUP: "WiFiSetup.GetApList",
};

// ============================================
// Network Mode Detection
// ============================================

/**
 * Network modes the PWA can be in.
 * @readonly
 * @enum {string}
 */
export const NetworkMode = {
  /** Connected to home network with bridge accessible */
  NORMAL: "NORMAL",
  /** Connected to Wemo AP - device setup mode */
  SETUP_MODE: "SETUP_MODE",
  /** No network connectivity or bridge unreachable */
  OFFLINE: "OFFLINE",
};

/**
 * Attempts to reach the Wemo device at its AP address.
 * Uses a simple fetch to setup.xml which all Wemo devices serve.
 *
 * @returns {Promise<boolean>} True if Wemo AP is reachable
 */
export async function canReachWemoAP() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    // Try to fetch setup.xml - all Wemo devices serve this
    // Using no-cors mode since we just want to check reachability
    const response = await fetch(`${WEMO_SETUP_URL}/setup.xml`, {
      method: "GET",
      mode: "no-cors", // Will get opaque response but confirms reachability
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // In no-cors mode, we get an opaque response (type: "opaque")
    // A successful fetch means the device is reachable
    // response.ok will be false for opaque responses, but response.type tells us it worked
    return response.type === "opaque" || response.ok;
  } catch (error) {
    log("[SetupMode] Cannot reach Wemo AP:", error.message);
    return false;
  }
}

/**
 * Attempts to reach the Open Wemo bridge.
 *
 * @returns {Promise<boolean>} True if bridge is reachable
 */
export async function canReachBridge() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    const response = await fetch("/api/health", {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    log("[SetupMode] Cannot reach bridge:", error.message);
    return false;
  }
}

/**
 * Detects the current network mode.
 *
 * Priority:
 * 1. If bridge is reachable -> NORMAL (user is on home network)
 * 2. If Wemo AP is reachable -> SETUP_MODE (user connected to Wemo AP)
 * 3. Otherwise -> OFFLINE
 *
 * @returns {Promise<NetworkMode>} The detected network mode
 */
export async function detectNetworkMode() {
  log("[SetupMode] Detecting network mode...");

  // Check bridge first - if reachable, we're in normal mode
  const bridgeReachable = await canReachBridge();
  if (bridgeReachable) {
    log("[SetupMode] Bridge reachable - NORMAL mode");
    return NetworkMode.NORMAL;
  }

  // Bridge not reachable - check if we're on Wemo AP
  const wemoAPReachable = await canReachWemoAP();
  if (wemoAPReachable) {
    log("[SetupMode] Wemo AP reachable - SETUP_MODE");
    return NetworkMode.SETUP_MODE;
  }

  // Neither reachable - offline
  log("[SetupMode] Nothing reachable - OFFLINE mode");
  return NetworkMode.OFFLINE;
}

// ============================================
// CORS Connectivity Tests
// ============================================

/**
 * Test result structure.
 * @typedef {Object} TestResult
 * @property {string} name - Test name
 * @property {boolean} success - Whether the test passed
 * @property {string} message - Human-readable result message
 * @property {string} [details] - Additional details (e.g., response data)
 * @property {number} [duration] - Test duration in ms
 */

/**
 * Tests a simple GET request to /setup.xml.
 * This is the most basic connectivity test.
 *
 * @returns {Promise<TestResult>}
 */
export async function testGetSetupXml() {
  const startTime = performance.now();
  const testName = TEST_NAMES.CORS_GET;

  try {
    // First try with cors mode to see if we can read the response
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    const response = await fetch(`${WEMO_SETUP_URL}/setup.xml`, {
      method: "GET",
      mode: "cors",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - startTime);

    if (response.ok) {
      const text = await response.text();
      return {
        name: testName,
        success: true,
        message: "CORS allowed - can read response",
        details: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
        duration,
      };
    }

    return {
      name: testName,
      success: false,
      message: `HTTP ${response.status}: ${response.statusText}`,
      duration,
    };
  } catch (error) {
    // If CORS fails, try no-cors to see if at least reachable
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

      const response = await fetch(`${WEMO_SETUP_URL}/setup.xml`, {
        method: "GET",
        mode: "no-cors",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Math.round(performance.now() - startTime);

      if (response.type === "opaque") {
        return {
          name: testName,
          success: false,
          message: "CORS blocked - device reachable but cannot read response",
          details: "Browser security prevents reading cross-origin responses without CORS headers",
          duration,
        };
      }
    } catch {
      // Completely unreachable
    }

    const duration = Math.round(performance.now() - startTime);
    return {
      name: testName,
      success: false,
      message: `Network error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Tests loading setup.xml via a <script> tag.
 * Script tags bypass CORS but the content must be valid JavaScript.
 * If the XML triggers a syntax error, we know the content was fetched.
 * We try to capture the raw text via error handling.
 *
 * @returns {Promise<TestResult>}
 */
export async function testScriptTag() {
  const startTime = performance.now();
  const testName = TEST_NAMES.FETCH_SCRIPT_TAG;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        name: testName,
        success: false,
        message: "Timeout - no response from script tag",
        duration: CONNECTIVITY_TIMEOUT,
      });
    }, CONNECTIVITY_TIMEOUT);

    const script = document.createElement("script");
    script.type = "text/javascript";

    script.onload = () => {
      clearTimeout(timeout);
      const duration = Math.round(performance.now() - startTime);
      document.head.removeChild(script);
      resolve({
        name: testName,
        success: true,
        message: "Script loaded (unexpected for XML)",
        details: "The content was somehow valid JavaScript",
        duration,
      });
    };

    script.onerror = () => {
      clearTimeout(timeout);
      const duration = Math.round(performance.now() - startTime);
      document.head.removeChild(script);
      // An error here could mean:
      // 1. Network error (blocked)
      // 2. Content fetched but not valid JS (this is what we hope for!)
      resolve({
        name: testName,
        success: false,
        message: "Script load error",
        details:
          "Content was fetched but isn't valid JS (expected for XML). Unfortunately we cannot read the content.",
        duration,
      });
    };

    script.src = `${WEMO_SETUP_URL}/setup.xml`;
    document.head.appendChild(script);
  });
}

/**
 * Tests loading setup.xml via an <object> tag.
 * Object tags can sometimes load cross-origin content and expose it
 * through contentDocument (though usually blocked by same-origin policy).
 *
 * @returns {Promise<TestResult>}
 */
export async function testObjectTag() {
  const startTime = performance.now();
  const testName = TEST_NAMES.FETCH_OBJECT_TAG;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (object.parentNode) {
        document.body.removeChild(object);
      }
      resolve({
        name: testName,
        success: false,
        message: "Timeout",
        duration: CONNECTIVITY_TIMEOUT,
      });
    }, CONNECTIVITY_TIMEOUT);

    const object = document.createElement("object");
    object.type = "text/xml";
    object.data = `${WEMO_SETUP_URL}/setup.xml`;
    object.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;";

    object.onload = () => {
      clearTimeout(timeout);
      const duration = Math.round(performance.now() - startTime);

      // Try to read the content
      let content = null;
      try {
        // Try contentDocument (usually blocked by same-origin)
        if (object.contentDocument) {
          content = object.contentDocument.documentElement.outerHTML;
        }
      } catch {
        // Same-origin policy blocked access
      }

      try {
        // Try getSVGDocument (for SVG, but worth a shot)
        if (object.getSVGDocument?.()) {
          content = object.getSVGDocument().documentElement.outerHTML;
        }
      } catch {
        // Blocked
      }

      document.body.removeChild(object);

      if (content) {
        resolve({
          name: testName,
          success: true,
          message: "Object loaded AND content readable!",
          details: `${content.substring(0, 300)}...`,
          duration,
        });
      } else {
        resolve({
          name: testName,
          success: false,
          message: "Object loaded but content blocked",
          details: "Same-origin policy prevents reading cross-origin object content",
          duration,
        });
      }
    };

    object.onerror = () => {
      clearTimeout(timeout);
      const duration = Math.round(performance.now() - startTime);
      if (object.parentNode) {
        document.body.removeChild(object);
      }
      resolve({
        name: testName,
        success: false,
        message: "Object load error",
        duration,
      });
    };

    document.body.appendChild(object);
  });
}

/**
 * Tests JSONP-style callback.
 * Some embedded devices support a callback parameter that wraps the response
 * in a JavaScript function call, making it loadable via <script> tag.
 *
 * @returns {Promise<TestResult>}
 */
export async function testJsonpCallback() {
  const startTime = performance.now();
  const testName = TEST_NAMES.JSONP_CALLBACK;

  return new Promise((resolve) => {
    const callbackName = `wemoCallback_${Date.now()}`;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        delete window[callbackName];
        if (script.parentNode) {
          document.head.removeChild(script);
        }
        resolve({
          name: testName,
          success: false,
          message: "Timeout - device doesn't support JSONP",
          duration: CONNECTIVITY_TIMEOUT,
        });
      }
    }, CONNECTIVITY_TIMEOUT);

    // Create global callback function
    window[callbackName] = (data) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) {
          document.head.removeChild(script);
        }
        const duration = Math.round(performance.now() - startTime);
        resolve({
          name: testName,
          success: true,
          message: "JSONP callback received data!",
          details: JSON.stringify(data).substring(0, 300),
          duration,
        });
      }
    };

    const script = document.createElement("script");

    script.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) {
          document.head.removeChild(script);
        }
        const duration = Math.round(performance.now() - startTime);
        resolve({
          name: testName,
          success: false,
          message: "Script load failed (no JSONP support)",
          duration,
        });
      }
    };

    // Try common JSONP parameter names
    script.src = `${WEMO_SETUP_URL}/setup.xml?callback=${callbackName}&jsonp=${callbackName}`;
    document.head.appendChild(script);
  });
}

/**
 * Tests a SOAP POST request to the basicevent service.
 * This tests if we can send the Content-Type and SOAPAction headers.
 *
 * @returns {Promise<TestResult>}
 */
export async function testSoapRequest() {
  const startTime = performance.now();
  const testName = TEST_NAMES.SOAP_POST;

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"></u:GetBinaryState>
  </s:Body>
</s:Envelope>`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    const response = await fetch(`${WEMO_SETUP_URL}/upnp/control/basicevent1`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"urn:Belkin:service:basicevent:1#GetBinaryState"',
      },
      body: soapEnvelope,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - startTime);

    if (response.ok) {
      const text = await response.text();
      return {
        name: testName,
        success: true,
        message: "SOAP request succeeded",
        details: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
        duration,
      };
    }

    return {
      name: testName,
      success: false,
      message: `HTTP ${response.status}: ${response.statusText}`,
      duration,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);

    // Check if it's a CORS preflight failure
    if (error.message.includes("CORS") || error.message.includes("cross-origin")) {
      return {
        name: testName,
        success: false,
        message: "CORS preflight blocked",
        details: "Browser blocked the preflight OPTIONS request - custom headers not allowed",
        duration,
      };
    }

    return {
      name: testName,
      success: false,
      message: `Error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Tests the WiFiSetup service which is used for device configuration.
 * Attempts to call GetApList to retrieve available WiFi networks.
 *
 * @returns {Promise<TestResult>}
 */
export async function testWiFiSetupService() {
  const startTime = performance.now();
  const testName = TEST_NAMES.WIFI_SETUP;

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetApList xmlns:u="urn:Belkin:service:WiFiSetup:1"></u:GetApList>
  </s:Body>
</s:Envelope>`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    const response = await fetch(`${WEMO_SETUP_URL}/upnp/control/WiFiSetup1`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"urn:Belkin:service:WiFiSetup:1#GetApList"',
      },
      body: soapEnvelope,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - startTime);

    if (response.ok) {
      const text = await response.text();
      return {
        name: testName,
        success: true,
        message: "WiFiSetup service accessible",
        details: text.substring(0, 300) + (text.length > 300 ? "..." : ""),
        duration,
      };
    }

    return {
      name: testName,
      success: false,
      message: `HTTP ${response.status}: ${response.statusText}`,
      duration,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);

    if (error.message.includes("CORS") || error.message.includes("cross-origin")) {
      return {
        name: testName,
        success: false,
        message: "CORS preflight blocked",
        details: "Browser blocked the preflight OPTIONS request",
        duration,
      };
    }

    return {
      name: testName,
      success: false,
      message: `Error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Tests SOAP POST with text/plain Content-Type (bypasses preflight).
 * This is an experiment to see if Wemo accepts SOAP without proper headers.
 *
 * @returns {Promise<TestResult>}
 */
export async function testSoapWithTextPlain() {
  const startTime = performance.now();
  const testName = TEST_NAMES.SOAP_TEXT_PLAIN;

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"></u:GetBinaryState>
  </s:Body>
</s:Envelope>`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    // Try with text/plain - this is a "simple request" that won't trigger preflight
    const response = await fetch(`${WEMO_SETUP_URL}/upnp/control/basicevent1`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "text/plain",
        // Note: We can't set SOAPAction without triggering preflight
      },
      body: soapEnvelope,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - startTime);

    if (response.ok) {
      const text = await response.text();
      return {
        name: testName,
        success: true,
        message: "SOAP with text/plain WORKED! Device accepted it!",
        details: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
        duration,
      };
    }

    // Even a non-OK response means we got through without preflight block
    const text = await response.text();
    return {
      name: testName,
      success: false,
      message: `HTTP ${response.status} - but request reached device!`,
      details: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
      duration,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    return {
      name: testName,
      success: false,
      message: `Error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Tests SOAP with application/x-www-form-urlencoded Content-Type.
 * This is another "simple" Content-Type that doesn't trigger preflight.
 * The device might parse the XML body regardless of Content-Type.
 *
 * @returns {Promise<TestResult>}
 */
export async function testSoapFormUrlencoded() {
  const startTime = performance.now();
  const testName = TEST_NAMES.SOAP_FORM_URLENCODED;

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"></u:GetBinaryState>
  </s:Body>
</s:Envelope>`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    // Try with application/x-www-form-urlencoded - another "simple request" Content-Type
    const response = await fetch(`${WEMO_SETUP_URL}/upnp/control/basicevent1`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: soapEnvelope,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - startTime);

    if (response.ok) {
      const text = await response.text();
      return {
        name: testName,
        success: true,
        message: "SOAP with form-urlencoded WORKED!",
        details: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
        duration,
      };
    }

    const text = await response.text();
    return {
      name: testName,
      success: false,
      message: `HTTP ${response.status} - but request reached device!`,
      details: text.substring(0, 200) + (text.length > 200 ? "..." : ""),
      duration,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    return {
      name: testName,
      success: false,
      message: `Error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Tests navigator.sendBeacon() for fire-and-forget requests.
 * sendBeacon bypasses CORS entirely but we can't read the response.
 * Useful for sending commands (like toggle) where we don't need the response.
 *
 * @returns {Promise<TestResult>}
 */
export async function testSendBeacon() {
  const startTime = performance.now();
  const testName = TEST_NAMES.SEND_BEACON;

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"></u:GetBinaryState>
  </s:Body>
</s:Envelope>`;

  try {
    // sendBeacon returns true if the browser queued the request
    // We can't know if the device actually received/processed it
    const blob = new Blob([soapEnvelope], { type: "text/plain" });
    const queued = navigator.sendBeacon(`${WEMO_SETUP_URL}/upnp/control/basicevent1`, blob);

    const duration = Math.round(performance.now() - startTime);

    if (queued) {
      return {
        name: testName,
        success: true,
        message: "Request queued by browser",
        details:
          "sendBeacon queued the request. Cannot verify if device received it. Useful for fire-and-forget commands.",
        duration,
      };
    }

    return {
      name: testName,
      success: false,
      message: "Browser refused to queue request",
      duration,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    return {
      name: testName,
      success: false,
      message: `Error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Tests if the Wemo device has any WebSocket support.
 * WebSockets have different CORS rules - they only check Origin on handshake.
 * If the device has a WebSocket server and doesn't validate Origin, we could communicate.
 *
 * @returns {Promise<TestResult>}
 */
export async function testWebSocketProbe() {
  const startTime = performance.now();
  const testName = TEST_NAMES.WEBSOCKET_PROBE;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        name: testName,
        success: false,
        message: "Timeout - no WebSocket server found",
        duration: CONNECTIVITY_TIMEOUT,
      });
    }, CONNECTIVITY_TIMEOUT);

    try {
      // Try common WebSocket ports/paths
      const ws = new WebSocket(`ws://${WEMO_AP_IP}:${WEMO_AP_PORT}/`);

      ws.onopen = () => {
        clearTimeout(timeout);
        const duration = Math.round(performance.now() - startTime);
        ws.close();
        resolve({
          name: testName,
          success: true,
          message: "WebSocket connection opened!",
          details: "Device has WebSocket support! This could be a CORS bypass path.",
          duration,
        });
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        const duration = Math.round(performance.now() - startTime);
        resolve({
          name: testName,
          success: false,
          message: "WebSocket connection failed",
          details: "Device doesn't have WebSocket server on this port",
          duration,
        });
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        const duration = Math.round(performance.now() - startTime);
        if (event.wasClean) {
          resolve({
            name: testName,
            success: true,
            message: `WebSocket closed cleanly (code: ${event.code})`,
            details: "Device responded to WebSocket handshake!",
            duration,
          });
        }
      };
    } catch (error) {
      clearTimeout(timeout);
      const duration = Math.round(performance.now() - startTime);
      resolve({
        name: testName,
        success: false,
        message: `Error: ${error.message}`,
        duration,
      });
    }
  });
}

/**
 * Tests a simple GET with no-cors mode (always succeeds if device reachable).
 *
 * @returns {Promise<TestResult>}
 */
export async function testNoCorsGet() {
  const startTime = performance.now();
  const testName = TEST_NAMES.NO_CORS_GET;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);

    const response = await fetch(`${WEMO_SETUP_URL}/setup.xml`, {
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Math.round(performance.now() - startTime);

    if (response.type === "opaque") {
      return {
        name: testName,
        success: true,
        message: "Device reachable (opaque response)",
        details: "Request succeeded but response body is hidden due to no-cors mode",
        duration,
      };
    }

    return {
      name: testName,
      success: response.ok,
      message: response.ok ? "Success" : `HTTP ${response.status}`,
      duration,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    return {
      name: testName,
      success: false,
      message: `Error: ${error.message}`,
      duration,
    };
  }
}

/**
 * Runs all CORS connectivity tests.
 * Yields results as they complete for progressive UI updates.
 *
 * NOTE: Tests are disabled in production. To enable for development/debugging,
 * set ENABLE_CORS_TESTS to true below.
 *
 * @yields {TestResult} Test results as they complete
 */
export async function* runAllTests() {
  // Disabled in production - these tests are for development/debugging only
  const ENABLE_CORS_TESTS = false;

  if (!ENABLE_CORS_TESTS) {
    log("[SetupMode] CORS connectivity tests are disabled");
    yield {
      name: "Tests Disabled",
      success: true,
      message: "CORS connectivity tests are disabled in production",
      details: "These tests are for development/debugging purposes only",
      duration: 0,
    };
    return;
  }

  log("[SetupMode] Running CORS connectivity tests...");

  // Run tests in sequence for clearer results
  yield await testNoCorsGet();
  yield await testGetSetupXml();
  yield await testScriptTag(); // Experiment: script tags bypass CORS
  yield await testObjectTag(); // Experiment: object tags might allow access
  yield await testJsonpCallback(); // Experiment: JSONP-style callback
  yield await testSoapRequest();
  yield await testSoapWithTextPlain(); // Experiment: bypass preflight with text/plain
  yield await testSoapFormUrlencoded(); // Experiment: another simple Content-Type
  yield await testSendBeacon(); // Experiment: fire-and-forget (no response)
  yield await testWebSocketProbe(); // Experiment: WebSocket has different CORS rules
  yield await testWiFiSetupService();

  log("[SetupMode] All tests complete");
}

/**
 * Runs all tests and returns results as an array.
 * Convenience function when progressive updates aren't needed.
 *
 * @returns {Promise<TestResult[]>} All test results
 */
export async function runAllTestsSync() {
  const results = [];
  for await (const result of runAllTests()) {
    results.push(result);
  }
  return results;
}

// ============================================
// Device Info Display (CORS Bypass via Object Tag)
// ============================================

/**
 * Creates an object tag that displays setup.xml content.
 * The browser renders the XML visually but JS cannot read it due to CORS.
 * User must manually copy the visible text and paste it for parsing.
 *
 * @returns {HTMLObjectElement} The configured object element
 */
export function createDeviceInfoObjectTag() {
  const object = document.createElement("object");
  object.type = "text/xml";
  object.data = `${WEMO_SETUP_URL}/setup.xml`;

  // Style for visibility and mobile-friendly text selection
  // 20px margins on all sides so users can easily select text on mobile
  object.style.cssText = `
    display: block;
    width: calc(100% - 40px);
    height: 250px;
    margin: 20px;
    padding: 0;
    border: 2px solid var(--color-border, #374151);
    border-radius: 8px;
    background-color: #ffffff;
    overflow: auto;
  `;

  return object;
}

/**
 * Parses pasted plain text to extract device Serial Number and MAC Address.
 * When users copy text from the object tag, XML tags are stripped,
 * leaving plain text that we parse with regex patterns.
 *
 * Expected patterns in setup.xml:
 * - SerialNumber: alphanumeric, typically like "221424K1200BE7"
 * - MacAddress: 12 hex characters, typically like "94103E3A6FB4"
 *
 * @param {string} pastedText - The plain text pasted by user
 * @returns {{serial: string|null, mac: string|null, raw: object}} Extracted values
 */
export function parseDeviceInfoFromText(pastedText) {
  const result = {
    serial: null,
    mac: null,
    raw: {},
  };

  if (!pastedText || typeof pastedText !== "string") {
    return result;
  }

  // Normalize whitespace
  const text = pastedText.trim();

  // Try to find SerialNumber - typically alphanumeric, 10-20 chars
  // Look for patterns like "SerialNumber 221424K1200BE7" or just the serial itself
  const serialPatterns = [
    /SerialNumber\s*[:\s]*([A-Z0-9]{10,20})/i,
    /Serial\s*[:\s]*([A-Z0-9]{10,20})/i,
    // Standalone pattern: alphanumeric starting with digits, containing letters
    /\b(\d{6}[A-Z]\d{4}[A-Z0-9]{2,5})\b/i,
  ];

  for (const pattern of serialPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.serial = match[1];
      break;
    }
  }

  // Try to find MacAddress - 12 hex characters (may have colons/dashes)
  const macPatterns = [
    /MacAddress\s*[:\s]*([0-9A-Fa-f]{12})/i,
    /MacAddress\s*[:\s]*([0-9A-Fa-f]{2}[:\-]?){5}[0-9A-Fa-f]{2}/i,
    /MAC\s*[:\s]*([0-9A-Fa-f]{12})/i,
    // Standalone 12 hex chars
    /\b([0-9A-Fa-f]{12})\b/,
  ];

  for (const pattern of macPatterns) {
    const match = text.match(pattern);
    if (match) {
      // Remove any colons/dashes and uppercase
      result.mac = match[1].replace(/[:\-]/g, "").toUpperCase();
      break;
    }
  }

  // Also try to extract other useful fields
  const fieldPatterns = {
    friendlyName: /friendlyName\s*[:\s]*([^\n]+)/i,
    modelName: /modelName\s*[:\s]*([^\n]+)/i,
    modelNumber: /modelNumber\s*[:\s]*([^\n]+)/i,
    firmwareVersion: /firmwareVersion\s*[:\s]*([^\n]+)/i,
    binaryState: /BinaryState\s*[:\s]*(\d+)/i,
  };

  for (const [field, pattern] of Object.entries(fieldPatterns)) {
    const match = text.match(pattern);
    if (match) {
      result.raw[field] = match[1].trim();
    }
  }

  return result;
}

/**
 * Formats test results as a string for copying to clipboard.
 *
 * @param {TestResult[]} results - Test results to format
 * @returns {string} Formatted results string
 */
export function formatTestResults(results) {
  const timestamp = new Date().toISOString();
  const lines = [
    "Open Wemo - CORS Connectivity Test Results",
    `Timestamp: ${timestamp}`,
    `Target: ${WEMO_SETUP_URL}`,
    `User Agent: ${navigator.userAgent}`,
    "",
    "Results:",
    "─".repeat(50),
  ];

  for (const result of results) {
    const status = result.success ? "PASS" : "FAIL";
    const duration = result.duration ? ` (${result.duration}ms)` : "";
    lines.push(`[${status}] ${result.name}${duration}`);
    lines.push(`       ${result.message}`);
    if (result.details) {
      lines.push(`       Details: ${result.details}`);
    }
    lines.push("");
  }

  lines.push("─".repeat(50));

  const passCount = results.filter((r) => r.success).length;
  lines.push(`Summary: ${passCount}/${results.length} tests passed`);

  return lines.join("\n");
}

// ============================================
// WiFi Password Encryption (AES-128-CBC)
// ============================================

/**
 * Encryption method constants.
 * Based on pywemo's encryption logic.
 */
export const EncryptionMethod = {
  /** Original method: mac[:6] + serial + mac[6:12] */
  METHOD_1: 1,
  /** RTOS devices: method 1 + extra suffix */
  METHOD_2: 2,
  /** Binary option devices: complex mixing + base64 extra */
  METHOD_3: 3,
};

/**
 * Extra suffix for method 2 encryption.
 * @private
 */
const METHOD_2_SUFFIX = "b3{8t;80dIN{ra83eC1s?M70?683@2Yf";

/**
 * Generates keydata for WiFi password encryption.
 *
 * Based on pywemo's encrypt_aes128 function.
 *
 * @param {string} mac - Device MAC address (12 hex chars, no separators)
 * @param {string} serial - Device serial number
 * @param {number} method - Encryption method (1, 2, or 3)
 * @returns {string} Keydata for encryption
 */
export function generateKeydata(mac, serial, method) {
  if (!mac || mac.length < 12) {
    throw new Error("MAC address must be at least 12 characters");
  }
  if (!serial) {
    throw new Error("Serial number is required");
  }

  // Normalize MAC - remove any separators and uppercase
  const cleanMac = mac.replace(/[:\-]/g, "").toUpperCase();

  switch (method) {
    case EncryptionMethod.METHOD_1:
      // Original method: mac[:6] + serial + mac[6:12]
      return cleanMac.slice(0, 6) + serial + cleanMac.slice(6, 12);

    case EncryptionMethod.METHOD_2:
      // RTOS method: method 1 + extra suffix
      return cleanMac.slice(0, 6) + serial + cleanMac.slice(6, 12) + METHOD_2_SUFFIX;

    case EncryptionMethod.METHOD_3: {
      // Binary option method: complex mixing + base64 extra
      const characters = [
        "Onboard",
        "$",
        "Application",
        "@",
        "Device",
        "&",
        "Information",
        "#",
        "Wemo",
      ].join("");

      // Mix characters: odd indices go to end, even indices go to start
      let mixed = "";
      for (let i = 0; i < characters.length; i++) {
        if (i % 2) {
          mixed = mixed + characters[i];
        } else {
          mixed = characters[i] + mixed;
        }
      }

      // Base64 encode and take first 32 chars
      const extra = btoa(mixed).slice(0, 32);
      // Result: 'b2Ujb3Rtb24mY3ZEbmlhaXBBZGFiT25v'

      return (
        cleanMac.slice(0, 3) +
        cleanMac.slice(9, 12) +
        serial +
        extra +
        cleanMac.slice(6, 9) +
        cleanMac.slice(3, 6)
      );
    }

    default:
      throw new Error(`Invalid encryption method: ${method}. Must be 1, 2, or 3.`);
  }
}

/**
 * Detects which encryption method to use based on device flags.
 *
 * Based on pywemo's detection logic:
 * - binaryOption=1 -> method 3
 * - rtos=1 or new_algo=1 -> method 2
 * - otherwise -> method 1
 *
 * @param {object} deviceFlags - Flags from device config
 * @param {string} [deviceFlags.binaryOption] - "0" or "1"
 * @param {string} [deviceFlags.rtos] - "0" or "1"
 * @param {string} [deviceFlags.new_algo] - "0" or "1"
 * @returns {{method: number, addLengths: boolean}} Encryption method and whether to add lengths
 */
export function detectEncryptionMethod(deviceFlags = {}) {
  const binaryOption = deviceFlags.binaryOption === "1";
  const rtos = deviceFlags.rtos === "1";
  const newAlgo = deviceFlags.new_algo === "1";

  // pywemo logic from Android APK analysis
  if (binaryOption) {
    return { method: EncryptionMethod.METHOD_3, addLengths: true };
  }
  if (rtos || newAlgo) {
    // Note: pywemo's actual implementation uses addLengths=false for method 2
    // but the comment says "add_lengths = True for all 3 methods"
    // Using pywemo's actual behavior: method in (1, 3) gets lengths
    return { method: EncryptionMethod.METHOD_2, addLengths: false };
  }
  return { method: EncryptionMethod.METHOD_1, addLengths: true };
}

/**
 * Encrypts a WiFi password using AES-128-CBC with OpenSSL-compatible key derivation.
 *
 * Uses CryptoJS library which replicates OpenSSL's EVP_BytesToKey internally.
 * This matches pywemo's encrypt_aes128 function behavior.
 *
 * @param {string} password - WiFi password to encrypt
 * @param {string} mac - Device MAC address (12 hex chars)
 * @param {string} serial - Device serial number
 * @param {number} method - Encryption method (1, 2, or 3)
 * @param {boolean} addLengths - Whether to append length bytes
 * @returns {Promise<string>} Base64-encoded encrypted password
 */
export async function encryptWifiPassword(password, mac, serial, method, addLengths) {
  // Check CryptoJS is loaded
  if (typeof CryptoJS === "undefined") {
    throw new Error("CryptoJS library not loaded");
  }

  if (!password) {
    throw new Error("Password is required");
  }

  // Generate keydata based on method
  const keydata = generateKeydata(mac, serial, method);

  // Extract salt (first 8 chars) and IV (first 16 chars) from keydata
  const saltStr = keydata.slice(0, 8);
  const ivStr = keydata.slice(0, 16);

  if (saltStr.length !== 8 || ivStr.length !== 16) {
    console.warn("[Encryption] Device meta information may not be supported");
  }

  // Convert IV to CryptoJS format
  const iv = CryptoJS.enc.Utf8.parse(ivStr);

  // Use CryptoJS's OpenSSL-compatible encryption
  // This internally uses EVP_BytesToKey with MD5 (OpenSSL default)
  const encrypted = CryptoJS.AES.encrypt(password, keydata, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  // Get the ciphertext (without the "Salted__" prefix that OpenSSL adds)
  // CryptoJS.AES.encrypt returns an object; .ciphertext gives us raw encrypted bytes
  let encryptedPassword = encrypted.ciphertext.toString(CryptoJS.enc.Base64);

  // Optionally append length bytes (xxyy format)
  // xx: length of encrypted password as 2-digit hex
  // yy: length of original password as 2-digit hex
  if (addLengths) {
    const lenEncrypted = encryptedPassword.length;
    const lenOriginal = password.length;

    if (lenEncrypted > 255 || lenOriginal > 255) {
      throw new Error(
        `Password too long: ${lenOriginal} chars (${lenEncrypted} after encryption). Max is 255.`
      );
    }

    // Format as 2-digit lowercase hex
    const hexEncrypted = lenEncrypted.toString(16).padStart(2, "0");
    const hexOriginal = lenOriginal.toString(16).padStart(2, "0");
    encryptedPassword += hexEncrypted + hexOriginal;
  }

  log("[Encryption] Password encrypted successfully", {
    method,
    addLengths,
    originalLength: password.length,
    encryptedLength: encryptedPassword.length,
  });

  return encryptedPassword;
}

// ============================================
// SOAP Payload Building
// ============================================

/**
 * WiFi authentication modes supported by Wemo.
 */
export const AuthMode = {
  OPEN: "OPEN",
  WPA: "WPA",
  WPA2: "WPA2",
  WPA_WPA2: "WPA/WPA2",
};

/**
 * WiFi encryption methods supported by Wemo.
 */
export const EncryptType = {
  NONE: "NONE",
  AES: "AES",
  TKIP: "TKIP",
  TKIPAES: "TKIPAES",
};

/**
 * SOAP action URL for WiFiSetup service.
 */
export const WIFI_SETUP_ACTION_URL = `${WEMO_SETUP_URL}/upnp/control/WiFiSetup1`;

/**
 * Builds a SOAP envelope for ConnectHomeNetwork action.
 *
 * @param {object} params - Connection parameters
 * @param {string} params.ssid - WiFi network SSID
 * @param {string} params.auth - Authentication mode (OPEN, WPA, WPA2, WPA/WPA2)
 * @param {string} params.password - Encrypted password (from encryptWifiPassword)
 * @param {string} params.encrypt - Encryption type (NONE, AES, TKIP, TKIPAES)
 * @param {string|number} params.channel - WiFi channel (0 for auto)
 * @returns {string} SOAP XML envelope
 */
export function buildConnectHomeNetworkPayload({ ssid, auth, password, encrypt, channel }) {
  // Escape XML special characters in SSID (it could contain special chars)
  const escapeXml = (str) =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const escapedSsid = escapeXml(ssid);
  const escapedPassword = escapeXml(password);

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    '<u:ConnectHomeNetwork xmlns:u="urn:Belkin:service:WiFiSetup:1">',
    `<ssid>${escapedSsid}</ssid>`,
    `<auth>${auth}</auth>`,
    `<password>${escapedPassword}</password>`,
    `<encrypt>${encrypt}</encrypt>`,
    `<channel>${channel}</channel>`,
    "</u:ConnectHomeNetwork>",
    "</s:Body>",
    "</s:Envelope>",
  ].join("");
}

/**
 * Builds a SOAP envelope for CloseSetup action.
 *
 * @returns {string} SOAP XML envelope
 */
export function buildCloseSetupPayload() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    '<u:CloseSetup xmlns:u="urn:Belkin:service:WiFiSetup:1">',
    "</u:CloseSetup>",
    "</s:Body>",
    "</s:Envelope>",
  ].join("");
}

/**
 * Builds a SOAP envelope for GetNetworkStatus action.
 *
 * @returns {string} SOAP XML envelope
 */
export function buildGetNetworkStatusPayload() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
    "<s:Body>",
    '<u:GetNetworkStatus xmlns:u="urn:Belkin:service:WiFiSetup:1">',
    "</u:GetNetworkStatus>",
    "</s:Body>",
    "</s:Envelope>",
  ].join("");
}

// ============================================
// Send Setup Command via sendBeacon
// ============================================

/**
 * Sends a SOAP payload to the Wemo device using sendBeacon.
 *
 * sendBeacon is a fire-and-forget API that bypasses CORS restrictions.
 * We cannot read the response, but the command is sent.
 *
 * From pywemo: "success rate is much higher if the ConnectHomeNetwork
 * command is sent twice (not sure why!)"
 *
 * @param {string} payload - SOAP XML payload
 * @param {string} [url=WIFI_SETUP_ACTION_URL] - Target URL
 * @returns {boolean} True if sendBeacon accepted the request
 */
export function sendSetupCommand(payload, url = WIFI_SETUP_ACTION_URL) {
  // Use text/plain to avoid CORS preflight
  // Note: Wemo accepts the SOAP payload regardless of Content-Type
  const blob = new Blob([payload], { type: "text/plain" });

  const success = navigator.sendBeacon(url, blob);

  log(`[Setup] sendBeacon ${success ? "queued" : "FAILED"}`, {
    url,
    payloadLength: payload.length,
  });

  return success;
}

/**
 * Sends the ConnectHomeNetwork command to configure WiFi.
 *
 * This function:
 * 1. Encrypts the WiFi password
 * 2. Builds the SOAP payload
 * 3. Sends the command twice (for reliability, per pywemo)
 *
 * @param {object} params - Setup parameters
 * @param {string} params.ssid - WiFi network SSID
 * @param {string} params.password - WiFi password (plaintext)
 * @param {string} params.mac - Device MAC address
 * @param {string} params.serial - Device serial number
 * @param {string} [params.auth="WPA2"] - Auth mode
 * @param {string} [params.encrypt="AES"] - Encryption type
 * @param {number} [params.channel=0] - WiFi channel (0=auto)
 * @param {number} [params.method] - Encryption method override (1, 2, or 3)
 * @param {boolean} [params.addLengths] - Whether to add length bytes override
 * @returns {Promise<{success: boolean, message: string}>} Result
 */
export async function sendWifiSetupCommand({
  ssid,
  password,
  mac,
  serial,
  auth = AuthMode.WPA2,
  encrypt = EncryptType.AES,
  channel = 0,
  method,
  addLengths,
}) {
  try {
    // Validate required params
    if (!ssid) throw new Error("SSID is required");
    if (!password) throw new Error("Password is required");
    if (!mac) throw new Error("MAC address is required");
    if (!serial) throw new Error("Serial number is required");

    // Detect encryption method if not specified
    let encMethod = method;
    let encAddLengths = addLengths;
    if (encMethod === undefined) {
      // Default to method 1 with lengths (most common)
      // User's device had binaryOption=1, new_algo=1 which would be method 3
      // but we'll let them override via params
      const detected = detectEncryptionMethod({});
      encMethod = detected.method;
      encAddLengths = detected.addLengths;
    }
    if (encAddLengths === undefined) {
      encAddLengths = encMethod !== EncryptionMethod.METHOD_2;
    }

    log("[Setup] Encrypting WiFi password...", {
      method: encMethod,
      addLengths: encAddLengths,
    });

    // Encrypt the password
    const encryptedPassword = await encryptWifiPassword(
      password,
      mac,
      serial,
      encMethod,
      encAddLengths
    );

    // Build the SOAP payload
    const payload = buildConnectHomeNetworkPayload({
      ssid,
      auth,
      password: encryptedPassword,
      encrypt,
      channel,
    });

    log("[Setup] Sending ConnectHomeNetwork command...");

    // Send twice for reliability (per pywemo recommendation)
    const success1 = sendSetupCommand(payload);
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay between sends
    const success2 = sendSetupCommand(payload);

    if (success1 || success2) {
      log("[Setup] ConnectHomeNetwork command sent successfully");
      return {
        success: true,
        message: "Setup command sent. The device will attempt to connect to your WiFi network.",
      };
    }

    console.error("[Setup] sendBeacon failed for both attempts");
    return {
      success: false,
      message: "Failed to send setup command. Please try again.",
    };
  } catch (error) {
    console.error("[Setup] Error sending setup command:", error);
    return {
      success: false,
      message: `Setup failed: ${error.message}`,
    };
  }
}

/**
 * Sends the CloseSetup command to finalize device setup.
 *
 * @returns {boolean} True if sendBeacon accepted the request
 */
export function sendCloseSetupCommand() {
  const payload = buildCloseSetupPayload();
  return sendSetupCommand(payload);
}

// ============================================
// Curl Command Generator (Workaround for CORS)
// ============================================

/**
 * Generates a curl command for WiFi setup.
 *
 * Browser limitations (CORS, no custom headers in sendBeacon) prevent
 * sending proper SOAP requests. This generates a curl command that
 * can be run from a terminal on a device connected to the Wemo AP.
 *
 * @param {object} params - Setup parameters
 * @param {string} params.ssid - WiFi network SSID
 * @param {string} params.password - WiFi password (plaintext)
 * @param {string} params.mac - Device MAC address
 * @param {string} params.serial - Device serial number
 * @param {string} [params.auth="WPA2"] - Auth mode
 * @param {string} [params.encrypt="AES"] - Encryption type
 * @param {number} [params.channel=0] - WiFi channel
 * @param {number} [params.method] - Encryption method override
 * @param {boolean} [params.addLengths] - Whether to add length bytes
 * @returns {string} curl command string
 */
export function generateCurlCommand({
  ssid,
  password,
  mac,
  serial,
  auth = AuthMode.WPA2,
  encrypt = EncryptType.AES,
  channel = 0,
  method,
  addLengths,
}) {
  // Determine encryption method
  const encMethod = method ?? detectEncryptionMethod(null);
  const shouldAddLengths = addLengths ?? encMethod === EncryptionMethod.METHOD_3;

  // Encrypt the password
  const encryptedPassword = encryptWifiPassword(password, mac, serial, encMethod, shouldAddLengths);

  // Build the SOAP payload
  const payload = buildConnectHomeNetworkPayload({
    ssid,
    auth,
    password: encryptedPassword,
    encrypt,
    channel,
  });

  // Escape single quotes in payload for shell
  const escapedPayload = payload.replace(/'/g, "'\\''");

  // Build curl command
  const curlCmd = [
    "curl -X POST",
    `'${WIFI_SETUP_ACTION_URL}'`,
    "-H 'Content-Type: text/xml'",
    `-H 'SOAPACTION: "${WIFI_SETUP_SERVICE_TYPE}#ConnectHomeNetwork"'`,
    `-d '${escapedPayload}'`,
  ].join(" \\\n  ");

  return curlCmd;
}

/**
 * Generates a curl command for CloseSetup.
 *
 * @returns {string} curl command string
 */
export function generateCloseSetupCurlCommand() {
  const payload = buildCloseSetupPayload();
  const escapedPayload = payload.replace(/'/g, "'\\''");

  return [
    "curl -X POST",
    `'${WIFI_SETUP_ACTION_URL}'`,
    "-H 'Content-Type: text/xml'",
    `-H 'SOAPACTION: "${WIFI_SETUP_SERVICE_TYPE}#CloseSetup"'`,
    `-d '${escapedPayload}'`,
  ].join(" \\\n  ");
}
