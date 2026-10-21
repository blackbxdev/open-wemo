/**
 * Tray Menu Implementation
 *
 * Defines the tray menu structure and handles menu actions.
 */

import { exec } from "node:child_process";
import { platform } from "node:os";
import type { MenuClickHandler, MenuItem } from "./index";

/**
 * Menu item IDs.
 */
export const MenuItemIds = {
  OPEN_BROWSER: "open-browser",
  SHOW_QR: "show-qr",
  SETUP_DEVICE: "setup-device",
  LINK_GOOGLE_HOME: "link-google-home",
  MATTER_TOGGLE: "matter-toggle",
  DISCOVER: "discover",
  START_ON_LOGIN: "start-on-login",
  QUIT: "quit",
} as const;

/**
 * Menu action handlers interface.
 */
export interface MenuHandlers {
  onOpenBrowser?: () => void;
  onShowQR?: () => void;
  onSetupDevice?: () => void;
  onLinkGoogleHome?: () => void;
  onMatterToggle?: (enabled: boolean) => void | Promise<void>;
  onDiscover?: () => Promise<void>;
  onStartOnLoginToggle?: (enabled: boolean) => void;
  onQuit?: () => void;
}

/**
 * Creates the default menu items.
 */
export function createMenuItems(startOnLogin = false, matterEnabled = false): MenuItem[] {
  return [
    {
      id: MenuItemIds.OPEN_BROWSER,
      title: "Open in Browser",
      tooltip: "Open the web interface in your browser",
    },
    {
      id: MenuItemIds.SHOW_QR,
      title: "Show QR Code",
      tooltip: "Display QR code for phone setup",
    },
    {
      id: MenuItemIds.SETUP_DEVICE,
      title: "Setup New Device",
      tooltip: "Configure a new WeMo device's WiFi",
    },
    {
      id: MenuItemIds.LINK_GOOGLE_HOME,
      title: "Link to Google Home",
      tooltip: "Show Matter pairing QR for Google Home",
    },
    {
      id: MenuItemIds.MATTER_TOGGLE,
      title: "Matter Bridge",
      tooltip: "Expose WeMo devices to Google Home via Matter",
      checked: matterEnabled,
    },
    {
      id: MenuItemIds.DISCOVER,
      title: "Discover Devices",
      tooltip: "Scan network for WeMo devices",
    },
    {
      id: MenuItemIds.START_ON_LOGIN,
      title: "Start on Login",
      tooltip: "Launch Open Wemo when you log in",
      checked: startOnLogin,
    },
  ];
}

/**
 * Opens a URL in the default browser.
 */
export function openInBrowser(url: string): void {
  const os = platform();
  let command: string;

  switch (os) {
    case "darwin":
      command = `open "${url}"`;
      break;
    case "win32":
      command = `start "" "${url}"`;
      break;
    default:
      command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.error("[Menu] Failed to open browser:", error);
    }
  });
}

/**
 * Creates a menu click handler that routes to the appropriate action.
 */
export function createMenuClickHandler(
  handlers: MenuHandlers,
  getStartOnLogin: () => boolean,
  setStartOnLogin: (value: boolean) => void,
  getMatterEnabled: () => boolean = () => false
): MenuClickHandler {
  return async (itemId: string) => {
    switch (itemId) {
      case MenuItemIds.OPEN_BROWSER:
        handlers.onOpenBrowser?.();
        break;

      case MenuItemIds.SHOW_QR:
        handlers.onShowQR?.();
        break;

      case MenuItemIds.SETUP_DEVICE:
        handlers.onSetupDevice?.();
        break;

      case MenuItemIds.LINK_GOOGLE_HOME:
        handlers.onLinkGoogleHome?.();
        break;

      case MenuItemIds.MATTER_TOGGLE: {
        const newValue = !getMatterEnabled();
        await handlers.onMatterToggle?.(newValue);
        break;
      }

      case MenuItemIds.DISCOVER:
        await handlers.onDiscover?.();
        break;

      case MenuItemIds.START_ON_LOGIN: {
        const newValue = !getStartOnLogin();
        setStartOnLogin(newValue);
        handlers.onStartOnLoginToggle?.(newValue);
        break;
      }

      case MenuItemIds.QUIT:
        handlers.onQuit?.();
        break;

      default:
        console.warn(`[Menu] Unknown menu item: ${itemId}`);
    }
  };
}

/**
 * Gets the server URL based on port.
 */
export function getServerUrl(port: number): string {
  return `http://localhost:${port}`;
}
