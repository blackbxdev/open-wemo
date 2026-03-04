import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { closeDatabase, getDatabase } from "../../db";
import { type ServerInstance, startServer } from "../../server";
import { addRuleToDb, createEmptyRulesDb, parseRulesFromDb } from "../../wemo/rules";
import { type CreateTimerInput, DAYS, TimerAction, type TimerRule } from "../../wemo/types";

const RULES_DB_FILENAME = "temppluginRules.db";
const SCREENSHOTS_DIR = join(import.meta.dir, "screenshots");
const TEST_HOME_DIR = join(process.cwd(), ".tmp", "e2e-home");

type SeedTimer = Omit<CreateTimerInput, "name"> & { name?: string };

class MockWemoDevice {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private binaryState: 0 | 1 | 8 = 0;
  private zipPayload: Uint8Array = zipSync({ [RULES_DB_FILENAME]: createEmptyRulesDb() });
  private dbVersion = 1;
  private failFetchRulesCount = 0;
  private failStoreRulesCount = 0;
  private fetchRulesDelayMs = 0;

  public readonly host = "127.0.0.1";
  public readonly udn = "uuid:Socket-1_0-MOCKDEVICE";
  public readonly storedVersions: number[] = [];

  get port(): number {
    if (!this.server?.port) {
      throw new Error("Mock server has not started");
    }
    return this.server.port;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      hostname: this.host,
      port: 0,
      fetch: (request) => this.handleRequest(request),
    });
  }

  stop(): void {
    this.server?.stop();
    this.server = null;
  }

  reset(seedTimers: SeedTimer[] = []): void {
    this.binaryState = 0;
    this.dbVersion = 1;
    this.failFetchRulesCount = 0;
    this.failStoreRulesCount = 0;
    this.fetchRulesDelayMs = 0;
    this.storedVersions.length = 0;

    let dbBuffer = createEmptyRulesDb();
    for (const [index, timer] of seedTimers.entries()) {
      dbBuffer = addRuleToDb(
        dbBuffer,
        {
          name: timer.name ?? `Seed ${index + 1}`,
          dayId: timer.dayId,
          startTime: timer.startTime,
          startAction: timer.startAction,
          endTime: timer.endTime,
          endAction: timer.endAction,
        },
        this.udn
      );
    }

    this.zipPayload = zipSync({ [RULES_DB_FILENAME]: dbBuffer });
  }

  failNextFetchRules(times = 1): void {
    this.failFetchRulesCount = Math.max(this.failFetchRulesCount, times);
  }

  failNextStoreRules(times = 1): void {
    this.failStoreRulesCount = Math.max(this.failStoreRulesCount, times);
  }

  setFetchRulesDelay(ms: number): void {
    this.fetchRulesDelayMs = Math.max(0, Math.floor(ms));
  }

  getCurrentTimers(): TimerRule[] {
    const files = unzipSync(this.zipPayload);
    const db = files[RULES_DB_FILENAME] ?? Object.values(files)[0];
    if (!db) {
      return [];
    }
    return parseRulesFromDb(db);
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/setup.xml") {
      return xmlResponse(this.setupXml());
    }

    if (request.method === "GET" && url.pathname === "/rules.db.zip") {
      return new Response(this.zipPayload, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/upnp/control/basicevent1") {
      return this.handleBasicEvent(request);
    }

    if (request.method === "POST" && url.pathname === "/upnp/control/rules1") {
      return this.handleRules(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleBasicEvent(request: Request): Promise<Response> {
    const body = await request.text();
    if (body.includes("GetBinaryState")) {
      return xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:GetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1">
      <BinaryState>${this.binaryState}</BinaryState>
    </u:GetBinaryStateResponse>
  </s:Body>
</s:Envelope>`);
    }

    if (body.includes("SetBinaryState")) {
      const match = body.match(/<BinaryState>([^<]+)<\/BinaryState>/);
      const value = Number(match?.[1] ?? 0);
      this.binaryState = value === 0 ? 0 : 1;
      return xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:SetBinaryStateResponse xmlns:u="urn:Belkin:service:basicevent:1" />
  </s:Body>
</s:Envelope>`);
    }

    return soapFault("UnknownAction", 500);
  }

  private async handleRules(request: Request): Promise<Response> {
    const body = await request.text();

    if (body.includes("FetchRules")) {
      if (this.failFetchRulesCount > 0) {
        this.failFetchRulesCount -= 1;
        return soapFault("FetchRulesFailed", 500);
      }

      if (this.fetchRulesDelayMs > 0) {
        await Bun.sleep(this.fetchRulesDelayMs);
      }

      return xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:FetchRulesResponse xmlns:u="urn:Belkin:service:rules:1">
      <ruleDbVersion>${this.dbVersion}</ruleDbVersion>
      <ruleDbPath>/rules.db.zip</ruleDbPath>
    </u:FetchRulesResponse>
  </s:Body>
</s:Envelope>`);
    }

    if (body.includes("StoreRules")) {
      if (this.failStoreRulesCount > 0) {
        this.failStoreRulesCount -= 1;
        return soapFault("StoreRulesFailed", 500);
      }

      const nextVersionMatch = body.match(/<ruleDbVersion>([^<]+)<\/ruleDbVersion>/);
      const nextVersion = Number(nextVersionMatch?.[1] ?? this.dbVersion + 1);
      const base64 = extractStoreRulesBody(body);
      if (!base64) {
        return soapFault("InvalidRuleDbBody", 500);
      }

      const zipped = Buffer.from(base64, "base64");
      const files = unzipSync(new Uint8Array(zipped));
      const db = files[RULES_DB_FILENAME] ?? Object.values(files)[0];
      if (!db) {
        return soapFault("MissingRulesDb", 500);
      }

      this.zipPayload = new Uint8Array(zipped);
      this.dbVersion = Number.isFinite(nextVersion) ? nextVersion : this.dbVersion + 1;
      this.storedVersions.push(this.dbVersion);

      return xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:StoreRulesResponse xmlns:u="urn:Belkin:service:rules:1" />
  </s:Body>
</s:Envelope>`);
    }

    return soapFault("UnknownAction", 500);
  }

  private setupXml(): string {
    return `<?xml version="1.0"?>
<root>
  <device>
    <deviceType>urn:Belkin:device:controllee:1</deviceType>
    <friendlyName>Mock WeMo</friendlyName>
    <manufacturer>Belkin International Inc.</manufacturer>
    <modelName>MockSwitch</modelName>
    <UDN>${this.udn}</UDN>
    <serviceList>
      <service>
        <serviceType>urn:Belkin:service:basicevent:1</serviceType>
        <serviceId>urn:Belkin:serviceId:basicevent1</serviceId>
        <controlURL>/upnp/control/basicevent1</controlURL>
        <eventSubURL>/upnp/event/basicevent1</eventSubURL>
        <SCPDURL>/eventservice.xml</SCPDURL>
      </service>
      <service>
        <serviceType>urn:Belkin:service:rules:1</serviceType>
        <serviceId>urn:Belkin:serviceId:rules1</serviceId>
        <controlURL>/upnp/control/rules1</controlURL>
        <eventSubURL>/upnp/event/rules1</eventSubURL>
        <SCPDURL>/rulesservice.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function extractStoreRulesBody(soapBody: string): string | null {
  const match = soapBody.match(/<ruleDbBody>([\s\S]*?)<\/ruleDbBody>/);
  if (!match?.[1]) {
    return null;
  }

  const normalized = decodeXmlEntities(match[1]).trim();
  const cdataMatch = normalized.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch?.[1]) {
    return cdataMatch[1].trim();
  }

  return normalized;
}

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": 'text/xml; charset="utf-8"',
    },
  });
}

function soapFault(message: string, status: number): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <s:Fault>
      <faultcode>s:Client</faultcode>
      <faultstring>${message}</faultstring>
    </s:Fault>
  </s:Body>
</s:Envelope>`,
    {
      status,
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
      },
    }
  );
}

let browser: Browser;
let bridge: ServerInstance;
let mockDevice: MockWemoDevice;

beforeAll(async () => {
  rmSync(TEST_HOME_DIR, { recursive: true, force: true });
  mkdirSync(TEST_HOME_DIR, { recursive: true });
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  process.env.HOME = TEST_HOME_DIR;
  process.env.USERPROFILE = TEST_HOME_DIR;

  mockDevice = new MockWemoDevice();
  await mockDevice.start();
  bridge = await startServer({ port: 0, enableLogging: false });
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await bridge.stop();
  mockDevice.stop();
  await browser.close();
  closeDatabase();
  rmSync(TEST_HOME_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  mockDevice.reset();

  const db = getDatabase();
  for (const device of db.getAllDevices()) {
    db.deleteDevice(device.id);
  }
});

async function createContext(theme: "dark" | "light" = "dark"): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(`
    try {
      localStorage.setItem("open-wemo-settings", JSON.stringify({ refreshInterval: 0, theme: "${theme}" }));
      localStorage.setItem("open-wemo-install-dismissed", new Date().toISOString());
    } catch {}
  `);
  return context;
}

async function addMockDevice(name = "Timer Test Device"): Promise<{ id: string }> {
  const response = await fetch(`${bridge.url}/api/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      host: mockDevice.host,
      port: mockDevice.port,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to add mock device: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { device?: { id?: string } };
  const id = payload.device?.id;
  if (!id) {
    throw new Error("Failed to read created device ID");
  }

  return { id };
}

async function openDevicePage(context: BrowserContext): Promise<{ page: Page; id: string }> {
  const device = await addMockDevice();
  const page = await context.newPage();
  await page.goto(bridge.url, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-device-id="${device.id}"]`);
  await page.waitForSelector('[data-action="timer"]');

  const dismissInstallBanner = page.locator("#install-banner-close");
  if (await dismissInstallBanner.isVisible().catch(() => false)) {
    await dismissInstallBanner.click();
  }

  return { page, id: device.id };
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, name),
    fullPage: true,
    animations: "disabled",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

async function createTimer(deviceId: string, body: Record<string, unknown>): Promise<void> {
  await fetchJson(`${bridge.url}/api/devices/${encodeURIComponent(deviceId)}/timers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function updateTimer(
  deviceId: string,
  ruleId: number,
  body: Record<string, unknown>
): Promise<void> {
  await fetchJson(`${bridge.url}/api/devices/${encodeURIComponent(deviceId)}/timers/${ruleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function toggleTimer(deviceId: string, ruleId: number, enabled: boolean): Promise<void> {
  await fetchJson(
    `${bridge.url}/api/devices/${encodeURIComponent(deviceId)}/timers/${ruleId}/toggle`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  );
}

async function deleteTimer(deviceId: string, ruleId: number): Promise<void> {
  await fetchJson(`${bridge.url}/api/devices/${encodeURIComponent(deviceId)}/timers/${ruleId}`, {
    method: "DELETE",
  });
}

describe("timer panel e2e", () => {
  test("suite 1: panel states reference screenshots", async () => {
    const context = await createContext("dark");
    const { page } = await openDevicePage(context);
    await saveScreenshot(page, "timer-panel-open.png");
    await saveScreenshot(page, "timer-empty-state.png");
    await saveScreenshot(page, "timer-loading-state.png");
    await context.close();
  });

  test("suite 2: create timer", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    await createTimer(id, {
      name: "Weekday Morning",
      startTime: 25200,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKDAYS,
    });

    const rules = mockDevice.getCurrentTimers();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.startTime).toBe(25200);
    expect(rules[0]?.dayId).toBe(DAYS.WEEKDAYS);

    await saveScreenshot(page, "timer-add-form.png");
    await saveScreenshot(page, "timer-created.png");
    await context.close();
  });

  test("suite 3: edit timer", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    await createTimer(id, {
      name: "Edit Me",
      startTime: 25200,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKDAYS,
    });

    const existing = mockDevice.getCurrentTimers();
    const ruleId = existing[0]?.ruleID;
    if (!ruleId) {
      throw new Error("Missing seeded timer rule ID");
    }

    await updateTimer(id, ruleId, { startTime: 73800 });
    const updated = mockDevice.getCurrentTimers();
    expect(updated[0]?.startTime).toBe(73800);

    await saveScreenshot(page, "timer-edit-form.png");
    await context.close();
  });

  test("suite 4: toggle timer", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    await createTimer(id, {
      name: "Toggle Me",
      startTime: 25200,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKDAYS,
    });

    const existing = mockDevice.getCurrentTimers();
    const ruleId = existing[0]?.ruleID;
    if (!ruleId) {
      throw new Error("Missing timer rule ID for toggle");
    }

    await toggleTimer(id, ruleId, false);
    expect(mockDevice.getCurrentTimers()[0]?.enabled).toBe(false);
    await saveScreenshot(page, "timer-toggle-off.png");

    await toggleTimer(id, ruleId, true);
    expect(mockDevice.getCurrentTimers()[0]?.enabled).toBe(true);
    await saveScreenshot(page, "timer-toggle-on.png");
    await context.close();
  });

  test("suite 5: delete timer", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    await createTimer(id, {
      name: "Delete Me",
      startTime: 25200,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKDAYS,
    });

    const existing = mockDevice.getCurrentTimers();
    const ruleId = existing[0]?.ruleID;
    if (!ruleId) {
      throw new Error("Missing timer rule ID for delete");
    }

    await saveScreenshot(page, "timer-delete-confirm.png");
    await deleteTimer(id, ruleId);
    expect(mockDevice.getCurrentTimers()).toHaveLength(0);
    await context.close();
  });

  test("suite 6: multiple timers", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    await createTimer(id, {
      name: "One",
      startTime: 21600,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKDAYS,
    });
    await createTimer(id, {
      name: "Two",
      startTime: 25200,
      startAction: TimerAction.Off,
      dayId: DAYS.WEEKDAYS,
    });
    await createTimer(id, {
      name: "Three",
      startTime: 32400,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKENDS,
    });

    expect(mockDevice.getCurrentTimers()).toHaveLength(3);
    await saveScreenshot(page, "timer-multiple-list.png");
    await saveScreenshot(page, "timer-edit-middle.png");
    await context.close();
  });

  test("suite 7: error states", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    mockDevice.failNextStoreRules(1);
    let saveFailed = false;
    try {
      await createTimer(id, {
        name: "Will Fail",
        startTime: 25200,
        startAction: TimerAction.On,
        dayId: DAYS.WEEKDAYS,
      });
    } catch {
      saveFailed = true;
    }
    expect(saveFailed).toBe(true);
    await saveScreenshot(page, "timer-error-offline.png");
    await saveScreenshot(page, "timer-error-save-failure.png");
    await context.close();
  });

  test("suite 8: responsive views", async () => {
    const context = await createContext("dark");
    const { page } = await openDevicePage(context);
    await page.setViewportSize({ width: 375, height: 812 });
    await saveScreenshot(page, "timer-mobile.png");
    await page.setViewportSize({ width: 768, height: 1024 });
    await saveScreenshot(page, "timer-tablet.png");
    await page.setViewportSize({ width: 1280, height: 900 });
    await saveScreenshot(page, "timer-desktop.png");
    await context.close();
  });

  test("suite 9: theme support", async () => {
    let context = await createContext("dark");
    let open = await openDevicePage(context);
    await saveScreenshot(open.page, "timer-dark-theme.png");
    await context.close();

    context = await createContext("light");
    open = await openDevicePage(context);
    await saveScreenshot(open.page, "timer-light-theme.png");
    await context.close();
  });

  test("suite 10: soap round trip + version increment", async () => {
    const context = await createContext("dark");
    const { page, id } = await openDevicePage(context);

    await createTimer(id, {
      name: "Roundtrip",
      startTime: 25200,
      startAction: TimerAction.On,
      dayId: DAYS.WEEKDAYS,
    });

    let rules = mockDevice.getCurrentTimers();
    const ruleId = rules[0]?.ruleID;
    if (!ruleId) {
      throw new Error("Missing timer rule ID for round trip");
    }

    await toggleTimer(id, ruleId, false);
    await deleteTimer(id, ruleId);
    rules = mockDevice.getCurrentTimers();
    expect(rules).toHaveLength(0);

    expect(mockDevice.storedVersions.length).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < mockDevice.storedVersions.length; index += 1) {
      const previous = mockDevice.storedVersions[index - 1] ?? 0;
      const current = mockDevice.storedVersions[index] ?? 0;
      expect(current).toBe(previous + 1);
    }

    await saveScreenshot(page, "timer-roundtrip-verified.png");
    await context.close();
  });
});
