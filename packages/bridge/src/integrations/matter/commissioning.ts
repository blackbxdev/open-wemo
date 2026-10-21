/**
 * Matter commissioning page / QR helpers.
 */

import QRCode from "qrcode";
import type { MatterIdentity, MatterPairingInfo } from "./bridge";

/**
 * Generates a data-URL QR code for a Matter pairing payload.
 */
export async function generatePairingQrDataUrl(qrPairingCode: string): Promise<string> {
  return QRCode.toDataURL(qrPairingCode, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 280,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * HTML page for linking Open Wemo to Google Home via Matter.
 */
export async function generateMatterPageHtml(options: {
  enabled: boolean;
  running: boolean;
  pairing: MatterPairingInfo | null;
  error?: string;
  deviceCount: number;
  identity: MatterIdentity;
}): Promise<string> {
  const { enabled, running, pairing, error, deviceCount, identity } = options;

  let qrImg = "";
  if (pairing?.qrPairingCode) {
    const dataUrl = await generatePairingQrDataUrl(pairing.qrPairingCode);
    qrImg = `<img class="qr" src="${dataUrl}" alt="Matter pairing QR code" width="280" height="280" />`;
  }

  const statusBadge = !enabled
    ? `<span class="badge badge-off">Disabled</span>`
    : running
      ? `<span class="badge badge-on">Running</span>`
      : `<span class="badge badge-warn">Starting / Error</span>`;

  const commissionedBadge = pairing?.commissioned
    ? `<span class="badge badge-on">Linked to a controller</span>`
    : `<span class="badge badge-warn">Not commissioned yet</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Link to Google Home — Open Wemo</title>
  <link rel="stylesheet" href="/css/style.css" />
  <style>
    .matter-page { max-width: 520px; margin: 0 auto; padding: 24px 16px 48px; }
    .matter-page h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .matter-page .lead { color: var(--text-secondary, #9ca3af); margin-bottom: 20px; }
    .status-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .badge-on { background: #14532d; color: #86efac; }
    .badge-off { background: #3f3f46; color: #d4d4d8; }
    .badge-warn { background: #713f12; color: #fde68a; }
    .card {
      background: var(--card-bg, #1f2937);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .qr-wrap { text-align: center; margin: 16px 0; }
    .qr { border-radius: 8px; background: #fff; padding: 8px; }
    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 1.25rem;
      letter-spacing: 0.08em;
      text-align: center;
      padding: 12px;
      background: #111827;
      border-radius: 8px;
      margin: 8px 0 0;
      word-break: break-all;
    }
    .steps { padding-left: 1.2rem; line-height: 1.6; }
    .steps li { margin-bottom: 8px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .error { color: #fca5a5; margin: 12px 0; }
    .muted { color: var(--text-secondary, #9ca3af); font-size: 0.9rem; }
    button.btn-primary, a.btn-primary {
      background: #2563eb; color: #fff; border: none; border-radius: 8px;
      padding: 10px 16px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block;
    }
    button.btn-danger {
      background: #7f1d1d; color: #fecaca; border: none; border-radius: 8px;
      padding: 10px 16px; font-weight: 600; cursor: pointer;
    }
  </style>
</head>
<body data-theme="dark">
  <main class="matter-page">
    <h1>Link to Google Home</h1>
    <p class="lead">
      Open Wemo can appear in Google Home as a Matter bridge.
      Control stays on your local network — no cloud account required.
    </p>

    <div class="status-row">
      ${statusBadge}
      ${commissionedBadge}
      <span class="badge badge-off">${deviceCount} device(s) exposed</span>
    </div>

    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}

    <div class="card">
      <h2 style="margin-top:0;font-size:1.1rem;">Enable Matter Bridge</h2>
      <p class="muted">When enabled, Open Wemo advertises itself on your LAN for Matter commissioning.</p>
      <div class="actions">
        ${
          enabled
            ? `<button class="btn-danger" id="btn-disable">Disable Matter</button>
               <a class="btn-primary" href="/matter">Refresh status</a>`
            : `<button class="btn-primary" id="btn-enable">Enable Matter</button>`
        }
      </div>
    </div>

    ${
      enabled && pairing
        ? `
    <div class="card">
      <h2 style="margin-top:0;font-size:1.1rem;">Pairing</h2>
      ${
        pairing.commissioned
          ? `<p>This bridge is already commissioned to a Matter fabric (e.g. Google Home).
             Devices should appear in the Google Home app. To re-pair, remove “Open Wemo”
             from Google Home first, then scan the QR again.</p>`
          : `<p>In the <strong>Google Home</strong> app: Devices → Add → Matter-enabled device → Scan QR code.</p>
             <div class="qr-wrap">${qrImg}</div>
             <p class="muted" style="text-align:center">Or enter this setup code manually:</p>
             <div class="code">${escapeHtml(pairing.manualPairingCode)}</div>`
      }
    </div>`
        : ""
    }

    <div class="card">
      <h2 style="margin-top:0;font-size:1.1rem;">Google Home requires a one-time registration</h2>
      <p>
        Google only commissions <em>uncertified</em> Matter devices that are registered as a
        Matter integration in the
        <a href="https://console.home.google.com/projects" target="_blank" rel="noopener">Google Home Developer Console</a>.
        Without it, Google Home finds the bridge but stops with “Couldn’t find device”.
      </p>
      <ol class="steps">
        <li>Create a project → <strong>Add integration</strong> → <strong>Matter</strong>.</li>
        <li>Enter Vendor ID <code>${escapeHtml(identity.vendorIdHex)}</code> and Product ID <code>${escapeHtml(identity.productIdHex)}</code>.</li>
        <li>Save, then sign in to Google Home with the same account that owns the project.</li>
      </ol>
      <p class="muted">
        Apple Home and Amazon Alexa pair without this step — they just show an “uncertified accessory” warning.
      </p>
    </div>

    <div class="card">
      <h2 style="margin-top:0;font-size:1.1rem;">Steps</h2>
      <ol class="steps">
        <li>Make sure your phone is on the same Wi‑Fi as this computer (2.4/5 GHz on one LAN, no guest/AP isolation).</li>
        <li>Enable the Matter bridge above (and keep Open Wemo running).</li>
        <li>Open Google Home → Add → Matter-enabled device.</li>
        <li>Scan the QR code (or type the setup code).</li>
        <li>Assign rooms to your WeMo switches and plugs.</li>
      </ol>
      <p class="muted">
        Android commissioning can fail with “Something went wrong” due to a Google bug that omits
        the country code — pairing once from the Google Home app on an iPhone works around it.
      </p>
      <div class="actions">
        <button class="btn-danger" id="btn-reset">Reset pairing</button>
      </div>
      <p class="muted">
        Reset clears saved fabrics so you can commission again after a failed attempt.
      </p>
    </div>

    <p><a href="/">← Back to Open Wemo</a></p>
  </main>
  <script>
    async function post(path) {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || data.error || "Request failed");
        return;
      }
      location.reload();
    }
    document.getElementById("btn-enable")?.addEventListener("click", () => post("/api/integrations/matter/enable"));
    document.getElementById("btn-disable")?.addEventListener("click", () => post("/api/integrations/matter/disable"));
    document.getElementById("btn-reset")?.addEventListener("click", () => {
      if (confirm("Clear Matter pairing? You will need to remove Open Wemo from Google Home and pair again.")) {
        post("/api/integrations/matter/reset");
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
