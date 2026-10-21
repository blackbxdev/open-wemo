# Google Home (Matter Bridge)

Open Wemo can expose your WeMo switches and plugs to **Google Home** by running a local **Matter bridge**. Control stays on your LAN — no Belkin cloud is required.

The same Matter bridge also works with **Apple Home** and **Amazon Alexa**.

> **Read this first if you use Google Home.** Google refuses to commission *uncertified* Matter devices unless the device's Vendor ID / Product ID pair is registered as a Matter integration in the [Google Home Developer Console](https://console.home.google.com/projects). This is a one-time, free setup — see [Register with Google](#register-with-google-required-once) below. Apple Home and Alexa do not require it.

## Requirements

- Open Wemo Bridge running on a computer on the same Wi‑Fi as your phone and WeMo devices
- Google Home app (Android or iOS)
- A **Nest Matter hub** on the same Wi‑Fi (Nest Mini, Nest Audio, Nest Hub, Nest Wifi Pro, Google TV Streamer, etc.) — required for Matter control in Google Home
- WeMo devices already discovered and saved in Open Wemo
- A Google Home Developer Console project (Google Home only — see below)

## Setup

1. Start Open Wemo on your computer.
2. Turn on the bridge in either place:
   - **PWA:** open `http://localhost:51515`, tap the gear icon → **Google Home & Matter**, then flip the switch.
   - **Tray menu:** **Link to Google Home**, or check **Matter Bridge**. The standalone page lives at `http://localhost:51515/matter`.
3. Complete the [Google registration](#register-with-google-required-once) with the Vendor ID and Product ID shown in that panel.
4. In the Google Home app:
   - Tap **Devices** → **Add** → **Matter-enabled device**
   - Scan the QR code shown in Open Wemo (or enter the setup code)
5. Assign rooms to your devices in Google Home.

**Where is the on/off toggle?** Google Home’s **device settings** page (Name / Room / Linked Matter / Remove) never shows controls. Use the **home or room tile**: tap to toggle, or touch-and-hold for the control sheet. Voice (“Hey Google, turn on Salt lamp”) also works once a Nest hub is online.

Keep the Open Wemo Bridge running whenever you want voice or Google Home control. If the bridge is offline, Matter devices become unreachable until it starts again.

For how the bridge maps WeMo types to Matter plugs/lights, see [MATTER.md](./MATTER.md).

## Register with Google (required once)

Google Home only commissions test/uncertified Matter devices when a matching integration exists in the Developer Console and you commission with an account tied to that project. Without it, the Google Home app discovers Open Wemo, then fails with **"Couldn't find device"** or **"Something went wrong"**.

1. Go to the [Google Home Developer Console](https://console.home.google.com/projects) and sign in with the same Google account your Google Home uses.
2. **Create a project**, then **Add integration** → **Matter**.
3. In Setup, enter the IDs shown in Open Wemo's Matter panel:
   - Vendor ID: `0xFFF1` (a CSA test VID)
   - Product ID: `0x8001`
4. Save the integration. Every VID/PID pair can only be used by one integration, so pick a different Product ID in both places if that pair is already taken.
5. Commission from the Google Home app signed in as a project member (or a Field Trial user you added).

If you need different IDs, change them in **Google Home & Matter → Advanced → Vendor ID / Product ID**. Saving restarts the bridge and clears the existing pairing, since the identity is baked into commissioned fabrics.

## What is supported

| WeMo type | Google Home / Matter |
|-----------|----------------------|
| Switch, Mini, Insight | On/Off plug |
| LightSwitch, Bulb, Dimmer | On/Off light (brightness later) |
| Unknown | On/Off plug (default; override in Settings if needed) |
| Motion | Not exposed |

Insight power monitoring is not exposed to Matter yet. Types are chosen automatically; see [MATTER.md](./MATTER.md).

## How it works

```
Google Home / Nest
        │  Matter (local Wi‑Fi)
        ▼
Open Wemo Matter Bridge  (UDP port 5540 + mDNS)
        │
        ▼
DeviceService → WeMo SOAP (existing protocol)
```

- Pairing credentials and fabric data are stored under your app data directory in a `matter/` folder (for example `%APPDATA%\open-wemo\matter` on Windows).
- Enabling Matter sets the SQLite setting `matter_enabled=true` so the bridge auto-starts next launch.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/integrations/matter/status` | Enabled/running/commissioned, device count, identity, port |
| POST | `/api/integrations/matter/enable` | Enable and start the Matter bridge |
| POST | `/api/integrations/matter/disable` | Stop and disable the Matter bridge |
| POST | `/api/integrations/matter/reset` | Clear commissioned fabrics so the bridge can pair again |
| PUT | `/api/integrations/matter/identity` | Set vendor/product IDs (`{"vendorId":"0xFFF1","productId":"0x8001"}`) |
| PUT | `/api/integrations/matter/devices/:id/kind` | Override Matter kind (`plug` / `light` / `skip` / `null`) |
| GET | `/api/integrations/matter/pairing` | QR / manual pairing codes |

## Troubleshooting

**Google Home finds something, then says "Couldn't find device"**
The VID/PID is not registered in the Google Home Developer Console, or you are commissioning with an account that is not a member of that project. See [Register with Google](#register-with-google-required-once).

**Android shows "Something went wrong" partway through**
A long-standing Google bug omits the mandatory Matter country code on some Android builds. Commission once from the Google Home app on an iPhone; afterwards the devices work normally from Android and Nest speakers.

**Nothing is discovered at all**
Phone and computer must be on the same subnet with mDNS allowed. Guest networks, "client isolation"/AP isolation (common on apartment and campus Wi‑Fi), VPNs, and separate 2.4/5 GHz SSIDs all block commissioning. Also allow `bun.exe` (dev) or `open-wemo.exe` through the firewall for the active network profile:

```powershell
New-NetFirewallRule -DisplayName "Open Wemo Matter" -Direction Inbound -Protocol UDP -LocalPort 5540 -Action Allow
Get-NetConnectionProfile   # confirm the profile your Wi-Fi uses is covered
```

**"Already linked" / can't re-pair**
Remove "Open Wemo" from Google Home, then use **Advanced → Reset pairing** in the Matter panel (or `POST /api/integrations/matter/reset`) and scan the QR again.

**Devices don't appear after a successful pairing**
Confirm Open Wemo lists the devices and the Matter panel reports them as exposed. Motion sensors are intentionally skipped.

**Device appears but has no on/off control**
1. Open the **home/room tile**, not the settings page (settings never has a toggle).
2. Confirm a Nest Matter hub is on the same network and online.
3. In Open Wemo → Google Home & Matter, check the device is listed as **Plug** or **Light** (not Skipped). Unknown WeMo types default to Plug; you can override under Advanced if needed.
4. If you changed the Matter type after pairing, remove the device from Google Home and pair again.

**Commands fail**
The WeMo device may be offline. Check it in the Open Wemo PWA. Matter marks the endpoint unreachable when SOAP fails.

**Port conflict**
The Matter bridge listens on UDP **5540**. Ensure nothing else binds that port.

## Development

Phase 0 compatibility spike (Bun + `@matter/nodejs`):

```bash
cd packages/bridge
bun scripts/matter-spike.ts
```
