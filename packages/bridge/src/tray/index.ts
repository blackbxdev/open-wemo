/**
 * System Tray Module
 *
 * Creates and manages the system tray icon and menu.
 * Uses systray2 for cross-platform support.
 */

import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// Use require() for systray2 to handle CommonJS default export correctly in bundled binary
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SysTray: typeof import("systray2").default =
  require("systray2").default || require("systray2");

import iconErrorIcoPath from "../../assets/icon-error.ico" with { type: "file" };
import iconErrorPngPath from "../../assets/icon-error.png" with { type: "file" };
import iconIcoPath from "../../assets/icon.ico" with { type: "file" };
// Embed icon files for compiled binary support
// These imports return paths that work both in dev and compiled modes
import iconPngPath from "../../assets/icon.png" with { type: "file" };

/**
 * Tray state for icon display.
 */
export type TrayState = "running" | "error" | "idle";

/**
 * Menu item click handler type.
 */
export type MenuClickHandler = (itemId: string) => void;

/**
 * Menu item definition.
 */
export interface MenuItem {
  id: string;
  title: string;
  tooltip?: string;
  enabled?: boolean;
  checked?: boolean;
}

/**
 * Tray configuration options.
 */
export interface TrayConfig {
  tooltip?: string;
  onReady?: () => void;
  onExit?: () => void;
  onClick?: MenuClickHandler;
}

/**
 * Icon paths map for embedded files.
 * Uses platform-specific icons (.ico for Windows, .png for others).
 */
const ICON_PATHS: Record<string, { windows: string; other: string }> = {
  icon: { windows: iconIcoPath, other: iconPngPath },
  "icon-error": { windows: iconErrorIcoPath, other: iconErrorPngPath },
};

/**
 * Ensures the systray2 tray binary has execute permissions on Linux.
 * systray2 extracts its binary to ~/.cache/node-systray/ but may not set +x.
 */
function ensureTrayBinaryPermissions(): void {
  if (platform() !== "linux") {
    return;
  }

  const cacheDir = join(homedir(), ".cache", "node-systray");
  if (!existsSync(cacheDir)) {
    return;
  }

  try {
    // Find all version directories
    const entries = readdirSync(cacheDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const trayBinary = join(cacheDir, entry.name, "tray_linux_release");
        if (existsSync(trayBinary)) {
          try {
            // Add execute permission (0o755 = rwxr-xr-x)
            chmodSync(trayBinary, 0o755);
          } catch {
            // Ignore errors - we tried our best
          }
        }
      }
    }
  } catch {
    // Ignore errors when listing cache directory
  }
}

/**
 * Load icon as base64 string.
 * Uses .ico on Windows, .png on macOS/Linux.
 * Icons are embedded in the binary via Bun's file embedding.
 */
function loadIcon(name: string): string {
  const isWindows = platform() === "win32";
  const paths = ICON_PATHS[name];

  if (!paths) {
    console.warn(`[Tray] Unknown icon name: ${name}`);
    // Return a minimal valid PNG (1x1 transparent) as fallback
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  }

  const iconPath = isWindows ? paths.windows : paths.other;

  try {
    const buffer = readFileSync(iconPath);
    return buffer.toString("base64");
  } catch (error) {
    console.warn(`[Tray] Failed to load icon: ${iconPath}`, error);
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  }
}

/**
 * System tray wrapper class.
 */
export class AppTray {
  private systray: InstanceType<typeof SysTray> | null = null;
  private config: TrayConfig;
  private currentState: TrayState = "idle";
  private menuItems: MenuItem[] = [];

  constructor(config: TrayConfig = {}) {
    this.config = config;
  }

  /**
   * Creates and shows the system tray icon.
   */
  async create(menuItems: MenuItem[]): Promise<void> {
    if (this.systray) {
      console.warn("[Tray] Tray already created");
      return;
    }

    // Fix tray binary permissions on Linux before creating systray
    ensureTrayBinaryPermissions();

    this.menuItems = menuItems;

    const items = menuItems.map((item) => ({
      title: item.title,
      tooltip: item.tooltip || item.title,
      enabled: item.enabled !== false,
      checked: item.checked || false,
    }));

    // Add separator and exit item
    items.push({ title: "", tooltip: "", enabled: false, checked: false }); // separator
    items.push({
      title: "Exit",
      tooltip: "Close Open Wemo",
      enabled: true,
      checked: false,
    });

    this.systray = new SysTray({
      menu: {
        icon: loadIcon("icon"),
        title: "",
        tooltip: this.config.tooltip || "Open Wemo",
        items,
      },
      debug: false,
      copyDir: true,
    });

    this.systray.onClick((action: { seq_id: number }) => {
      const index = action.seq_id;

      // Check if it's the exit item (last item)
      if (index === items.length - 1) {
        this.config.onExit?.();
        this.destroy();
        return;
      }

      // Handle menu item click
      if (index < this.menuItems.length) {
        const item = this.menuItems[index];
        if (item) {
          this.config.onClick?.(item.id);
        }
      }
    });

    // Wait a bit for the tray to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.currentState = "running";
    this.config.onReady?.();
    console.log("[Tray] System tray created");
  }

  /**
   * Updates the tray icon based on state.
   */
  updateState(state: TrayState): void {
    if (!this.systray) {
      console.warn("[Tray] Cannot update state - tray not created");
      return;
    }

    if (state === this.currentState) {
      return;
    }

    this.currentState = state;
    const iconName = state === "error" ? "icon-error" : "icon";

    // systray2 uses update-menu to update icon
    this.systray.sendAction({
      type: "update-menu",
      menu: {
        icon: loadIcon(iconName),
        title: "",
        tooltip: this.config.tooltip || "Open Wemo",
        items: this.menuItems.map((item) => ({
          title: item.title,
          tooltip: item.tooltip || item.title,
          enabled: item.enabled !== false,
          checked: item.checked || false,
        })),
      },
    });

    console.log(`[Tray] State updated to: ${state}`);
  }

  /**
   * Updates a menu item.
   */
  updateMenuItem(itemId: string, updates: Partial<MenuItem>): void {
    if (!this.systray) {
      return;
    }

    const index = this.menuItems.findIndex((i) => i.id === itemId);
    if (index === -1) {
      console.warn(`[Tray] Menu item not found: ${itemId}`);
      return;
    }

    const item = this.menuItems[index];
    if (!item) {
      return;
    }

    Object.assign(item, updates);

    this.systray.sendAction({
      type: "update-item",
      seq_id: index,
      item: {
        title: item.title,
        tooltip: item.tooltip || item.title,
        enabled: item.enabled !== false,
        checked: item.checked || false,
      },
    });
  }

  /**
   * Destroys the tray icon.
   */
  destroy(): void {
    if (this.systray) {
      this.systray.kill(false);
      this.systray = null;
      this.currentState = "idle";
      console.log("[Tray] System tray destroyed");
    }
  }

  /**
   * Gets the current tray state.
   */
  getState(): TrayState {
    return this.currentState;
  }

  /**
   * Checks if tray is active.
   */
  isActive(): boolean {
    return this.systray !== null;
  }
}

/**
 * Creates a new tray instance.
 */
export function createTray(config?: TrayConfig): AppTray {
  return new AppTray(config);
}
