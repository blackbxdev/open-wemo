/**
 * HTTP Server for Open Wemo Bridge
 *
 * Uses Hono (Bun-native) for fast, lightweight HTTP serving.
 * Serves the REST API and static PWA files.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getSavedAutostartPreference, setAutostart } from "../tray/autostart";
import { generateQRWindowHtml, getPreferredIp, getServerUrl } from "../tray/qr-window";
import { createSetupRoute } from "../tray/setup-window";
import {
  generateWelcomeHtml,
  markFirstLaunchComplete,
  setDontShowWelcome,
  shouldShowWelcome,
} from "../tray/welcome";
import { toApiError } from "./errors";
import { deviceRoutes } from "./routes/devices";
import { discoveryRoutes } from "./routes/discovery";
import { setupRoutes } from "./routes/setup";
import { timerRoutes } from "./routes/timers";
import { initStaticFiles, isDevMode, staticFileMiddleware } from "./static";

/**
 * Generates a debug page to preview install instructions modals.
 */
function generateDebugInstallPage(platform: "android" | "ios"): string {
  const isIOS = platform === "ios";
  const title = isIOS ? "iOS Install Instructions" : "Android Install Instructions";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Debug: ${title}</title>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .debug-info {
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.8);
      color: #fff;
      padding: 10px 15px;
      border-radius: 8px;
      font-size: 12px;
      z-index: 9999;
    }
    .debug-info a {
      color: #4ade80;
      margin-left: 10px;
    }
    /* Force modal to be visible */
    .modal {
      position: relative !important;
      display: flex !important;
    }
    .modal-backdrop {
      display: none !important;
    }
    .modal-content {
      position: relative !important;
      animation: none !important;
    }
    /* Arrow should be visible for Android */
    .install-menu-arrow {
      position: fixed !important;
    }
  </style>
</head>
<body data-theme="dark">
  <div class="debug-info">
    Debug: ${title} 
    <a href="/debug/android">Android</a>
    <a href="/debug/ios">iOS</a>
    <a href="/">Back to App</a>
  </div>
  
  ${
    isIOS
      ? `
  <!-- iOS Install Instructions Modal -->
  <div class="modal" role="dialog" aria-modal="true">
    <div class="modal-backdrop"></div>
    <div class="modal-content ios-install-content">
      <div class="modal-header">
        <h2 class="modal-title">Install Open Wemo</h2>
        <button class="btn btn-icon modal-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"/>
            <path d="M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p class="ios-install-intro">To install this app on your iPhone or iPad:</p>
        
        <ol class="ios-install-steps">
          <li class="ios-install-step">
            <div class="ios-install-step-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </div>
            <div class="ios-install-step-content">
              <div class="ios-install-step-title">Tap the Share button</div>
              <div class="ios-install-step-text">Find the share icon at the bottom of Safari (square with arrow pointing up)</div>
            </div>
          </li>
          <li class="ios-install-step">
            <div class="ios-install-step-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </div>
            <div class="ios-install-step-content">
              <div class="ios-install-step-title">Select "Add to Home Screen"</div>
              <div class="ios-install-step-text">Scroll down in the share menu and tap "Add to Home Screen"</div>
            </div>
          </li>
          <li class="ios-install-step">
            <div class="ios-install-step-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div class="ios-install-step-content">
              <div class="ios-install-step-title">Tap "Add"</div>
              <div class="ios-install-step-text">Confirm by tapping "Add" in the top right corner</div>
            </div>
          </li>
        </ol>
        
        <p class="ios-install-footer">The app will appear on your home screen!</p>
      </div>
    </div>
  </div>
  `
      : `
  <!-- Android Install Instructions Modal -->
  <div class="modal" role="dialog" aria-modal="true">
    <div class="modal-backdrop"></div>
    <!-- Bouncing arrow pointing to browser menu -->
    <div class="install-menu-arrow" aria-hidden="true">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5"/>
        <polyline points="5 12 12 5 19 12"/>
      </svg>
    </div>
    <div class="modal-content ios-install-content">
      <div class="modal-header">
        <h2 class="modal-title">Install Open Wemo</h2>
        <button class="btn btn-icon modal-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"/>
            <path d="M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <p class="ios-install-intro">To install this app on your device:</p>
        
        <ol class="ios-install-steps">
          <li class="ios-install-step">
            <div class="ios-install-step-icon">
              <!-- Vertical three dots for Android -->
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <div class="ios-install-step-content">
              <div class="ios-install-step-title">Open browser menu</div>
              <div class="ios-install-step-text">Tap the menu icon (⋮) in the top right corner</div>
            </div>
          </li>
          <li class="ios-install-step">
            <div class="ios-install-step-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </div>
            <div class="ios-install-step-content">
              <div class="ios-install-step-title">Select "Install app" or "Add to Home Screen"</div>
              <div class="ios-install-step-text">Look for the install option in the menu</div>
            </div>
          </li>
          <li class="ios-install-step">
            <div class="ios-install-step-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div class="ios-install-step-content">
              <div class="ios-install-step-title">Confirm installation</div>
              <div class="ios-install-step-text">Follow the prompts to complete installation</div>
            </div>
          </li>
        </ol>
        
        <p class="ios-install-footer">The app will appear on your home screen!</p>
      </div>
    </div>
  </div>
  `
  }
</body>
</html>`;
}

/**
 * Server configuration options.
 */
export interface ServerConfig {
  /** Port to listen on (default: 51515) */
  port?: number;
  /** Path to static files directory (default: ../web) */
  staticDir?: string;
  /** Enable request logging (default: true) */
  enableLogging?: boolean;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<ServerConfig> = {
  port: 51515,
  staticDir: "../web",
  enableLogging: true,
};

/**
 * Creates and configures the Hono application.
 */
export function createApp(config: ServerConfig = {}): Hono {
  const app = new Hono();
  const { enableLogging } = { ...DEFAULT_CONFIG, ...config };

  // Request logging
  if (enableLogging) {
    app.use("*", logger());
  }

  // CORS - allow all origins for local network access
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Length"],
      maxAge: 86400,
    })
  );

  // Health check endpoint
  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Server info endpoint (returns LAN IP for QR code generation)
  app.get("/api/info", (c) => {
    const ip = getPreferredIp();
    const port = DEFAULT_CONFIG.port;
    return c.json({
      ip,
      port,
      url: ip ? getServerUrl(port, ip) : null,
    });
  });

  // API info endpoint
  app.get("/api", (c) => {
    return c.json({
      name: "Open Wemo API",
      version: "0.3.0",
      endpoints: [
        "GET /api/health",
        "GET /api/info",
        "GET /api/discover",
        "GET /api/discover/:host",
        "GET /api/devices",
        "GET /api/devices/:id",
        "POST /api/devices",
        "DELETE /api/devices/:id",
        "POST /api/devices/:id/on",
        "POST /api/devices/:id/off",
        "POST /api/devices/:id/toggle",
        "GET /api/devices/:id/insight",
        "GET /api/devices/:id/timers",
        "POST /api/devices/:id/timers",
        "PATCH /api/devices/:id/timers/:ruleId",
        "DELETE /api/devices/:id/timers/:ruleId",
        "PATCH /api/devices/:id/timers/:ruleId/toggle",
      ],
    });
  });

  // Mount API routes
  app.route("/api/devices", deviceRoutes);
  app.route("/api/devices/:id/timers", timerRoutes);
  app.route("/api/discover", discoveryRoutes);
  app.route("/api/setup", setupRoutes);

  // QR code page for phone setup
  app.get("/qr", async (c) => {
    const port = DEFAULT_CONFIG.port;
    const html = await generateQRWindowHtml({ port });
    return c.html(html);
  });

  // Welcome page for first launch
  app.get("/welcome", async (c) => {
    const port = DEFAULT_CONFIG.port;
    const html = await generateWelcomeHtml({
      port,
      autoStartEnabled: getSavedAutostartPreference(),
    });
    return c.html(html);
  });

  // Device setup page (for configuring new Wemo devices' WiFi)
  // Debug mode shows diagnostics panel (only in dev)
  app.get("/setup", createSetupRoute(DEFAULT_CONFIG.port, isDevMode()));

  // API endpoint to save welcome preferences
  app.post("/api/welcome/complete", async (c) => {
    try {
      const body = await c.req.json();
      const { autostart, dontshow } = body as { autostart?: boolean; dontshow?: boolean };

      // Handle auto-start preference
      if (typeof autostart === "boolean") {
        await setAutostart(autostart);
      }

      // Handle "don't show again" preference
      if (typeof dontshow === "boolean") {
        setDontShowWelcome(dontshow);
      }

      // Mark first launch complete
      markFirstLaunchComplete();

      return c.json({ success: true });
    } catch (error) {
      console.error("[Welcome] Error saving preferences:", error);
      return c.json({ success: false, error: "Failed to save preferences" }, 500);
    }
  });

  // Check if welcome should be shown
  app.get("/api/welcome/status", (c) => {
    return c.json({
      shouldShow: shouldShowWelcome(),
      autoStartEnabled: getSavedAutostartPreference(),
    });
  });

  // Debug routes for styling install instructions
  app.get("/debug/android", (c) => {
    return c.html(generateDebugInstallPage("android"));
  });

  app.get("/debug/ios", (c) => {
    return c.html(generateDebugInstallPage("ios"));
  });

  // Error handling for API routes
  app.onError((err, c) => {
    const apiError = toApiError(err);

    // Log with appropriate severity
    if (apiError.status >= 500) {
      console.error(`[Error] ${apiError.code}: ${apiError.message}`);
    } else {
      console.warn(`[Warn] ${apiError.code}: ${apiError.message}`);
    }

    return c.json(apiError.toJSON(), apiError.status as ContentfulStatusCode);
  });

  // 404 handler
  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json(
        {
          error: true,
          message: `Not found: ${c.req.method} ${c.req.path}`,
          code: "NOT_FOUND",
        },
        404
      );
    }

    // For non-API routes, return a simple 404
    return new Response("Not Found", { status: 404 });
  });

  return app;
}

/**
 * Represents a running server instance.
 */
export interface ServerInstance {
  /** The Bun server instance */
  server: ReturnType<typeof Bun.serve>;
  /** The Hono app instance */
  app: Hono;
  /** Stop the server */
  stop: () => Promise<void>;
  /** Server port */
  port: number;
  /** Server URL */
  url: string;
}

/**
 * Starts the HTTP server.
 *
 * @param config - Server configuration
 * @returns Server instance with stop method
 */
export async function startServer(config: ServerConfig = {}): Promise<ServerInstance> {
  const { port } = { ...DEFAULT_CONFIG, ...config };

  // Initialize static files (loads and caches all web assets)
  await initStaticFiles();

  const app = createApp(config);

  // Serve static files from the cached web assets
  // This works both in development and when compiled
  app.use("/*", staticFileMiddleware());

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0", // Bind to all interfaces for LAN access
    fetch: app.fetch,
    idleTimeout: 30, // Allow longer requests (discovery can take 10-15s)
  });

  console.log(`[Server] Started on http://localhost:${server.port}`);

  const stop = async (): Promise<void> => {
    console.log("[Server] Shutting down...");
    server.stop();
    console.log("[Server] Stopped");
  };

  // Handle graceful shutdown
  const shutdownHandler = async () => {
    await stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  return {
    server,
    app,
    stop,
    port: server.port ?? port,
    url: `http://localhost:${server.port ?? port}`,
  };
}

/**
 * Gets the local IP address for network access.
 */
export function getLocalIpAddress(): string | null {
  const interfaces = require("node:os").networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== "IPv4") continue;

      // Prefer WiFi/WLAN interfaces
      if (name.toLowerCase().includes("wi-fi") || name.toLowerCase().includes("wlan")) {
        return iface.address;
      }
    }
  }

  // Fallback to first non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (!iface.internal && iface.family === "IPv4") {
        return iface.address;
      }
    }
  }

  return null;
}
