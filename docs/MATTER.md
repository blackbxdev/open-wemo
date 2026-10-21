# Matter Bridge Component

This document describes how Open Wemo’s Matter integration works. For user setup (Google Home commissioning, Developer Console, troubleshooting), see [GOOGLE-HOME.md](./GOOGLE-HOME.md). For HTTP endpoints, see [API.md](./API.md).

## Purpose

Open Wemo runs an in-process **Matter aggregator bridge** that exposes saved WeMo on/off devices to controllers such as:

- Google Home
- Apple Home
- Amazon Alexa

Control stays on the LAN. There is no Belkin cloud and no Google Smart Home Action cloud fulfillment for device control.

## Architecture

```
WeMo devices (SOAP / UPnP)
        ▲
        │
 DeviceService  ←→  REST API / PWA
        │
        │ events (deviceAdded, stateChanged, …)
        ▼
 MatterBridge (ServerNode + AggregatorEndpoint)
        │
        │ Matter over IP (UDP 5540 + mDNS)
        ▼
 Google Home / Apple Home / Alexa
```

| Piece | Role |
|-------|------|
| `DeviceService` | Single boundary for discovery, persistence, and on/off control |
| `IntegrationManager` | Starts/stops Matter from the `matter_enabled` setting |
| `MatterBridge` | Owns the Matter `ServerNode`, aggregator, and bridged endpoints |
| PWA Settings → Google Home & Matter | Enable, QR pairing, identity, per-device kind overrides |

### Key files

```
packages/bridge/src/
├── device-service/          # Shared device API for REST + Matter
├── integrations/
│   ├── index.ts             # IntegrationManager
│   └── matter/
│       ├── bridge.ts        # ServerNode lifecycle + sync
│       ├── mapper.ts        # WeMo type → Matter kind
│       ├── kinds.ts         # Optional per-device kind overrides
│       ├── storage.ts       # Credentials + storage paths
│       └── commissioning.ts # QR / standalone /matter page HTML
└── server/routes/matter.ts  # REST API
```

## Device type mapping

Matter device type IDs determine which controls Google Home (and other controllers) show. Open Wemo maps WeMo types automatically:

| WeMo type | Matter kind | Matter device | Controller UI |
|-----------|-------------|---------------|---------------|
| Switch, Mini, Insight | `plug` | On/Off Plug-in Unit (`0x010A`) | Outlet / switch with on/off |
| LightSwitch, Bulb, Dimmer | `light` | On/Off Light (`0x0100`) | Light with on/off |
| Unknown | `plug` (default) | On/Off Plug-in Unit | On/off rather than dropping the device |
| Motion | `skip` | — | Not exposed |

**Never** use Matter’s On/Off Light Switch (`0x0103`) for WeMo actuators. In Google Home that type is a *controller* (binding), not an on/off device—so the app shows the device with **no controls**.

### Override resolution

1. Per-device user override (if set in Settings → Advanced, or when type is Unknown)
2. Else automatic map from `device.deviceType`
3. Unknown without override → `plug`

Overrides are stored in SQLite settings as JSON (`matter_device_kinds`). Changing a kind recreates the Matter endpoint (device type is fixed at endpoint creation). Controllers may need remove + re-pair (or hub resync) to pick up the new type.

## Lifecycle

1. **Enable** — `matter_enabled=true`; `MatterBridge.start()` creates `ServerNode`, aggregator, and one bridged endpoint per exposable device.
2. **Commission** — Controllers scan the QR / enter the setup code. Identity uses stored passcode, discriminator, vendor ID, and product ID.
3. **Control (controller → WeMo)** — Matter `onOff` changes call `DeviceService.setOn` / `setOff` with source `"matter"`.
4. **Control (PWA/API → controller)** — `stateChanged` events update the Matter endpoint (feedback loop ignored for `"matter"` source).
5. **Reset** — Running bridge uses `ServerNode.erase()`; offline path clears fabric storage and may defer locked files on Windows.
6. **Identity change** — Updates VID/PID, factory-resets fabrics, restarts if enabled.

## Storage

| Path | Contents |
|------|----------|
| `%APPDATA%/open-wemo/matter/` (Windows) | Matter root (`path.root`) |
| `credentials.json` | Passcode, discriminator, uniqueId, vendorId, productId |
| `open-wemo/storage.db` | matter.js SQLite fabric / node state |

The default matter.js **file** storage driver is not used: under Bun on Windows, write-tmp + rename intermittently fails with `EPERM`, which crashes the Matter environment so it cannot restart in-process. SQLite is selected via `StorageService.configuredDriver`.

## Google Home specifics

- Uncertified VID/PID pairs must be registered in the [Google Home Developer Console](https://console.home.google.com/projects). See [GOOGLE-HOME.md](./GOOGLE-HOME.md).
- A **Nest Matter hub** (Nest Mini, Nest Audio, Nest Hub, etc. on the same Wi‑Fi) is required for Matter control in the Google ecosystem.
- The Google Home **device settings** page (Name / Room / Remove) never shows an on/off toggle. Controls are on the **home/room tile** (tap or touch-and-hold).
- After changing a device’s Matter kind, remove the device from Google Home and re-pair if the tile still has no controls.

## Related docs

- [GOOGLE-HOME.md](./GOOGLE-HOME.md) — User setup and troubleshooting
- [API.md](./API.md) — `/api/integrations/matter/*`
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Bridge module layout
