# Configurable Standby Threshold for WeMo Insight Devices

## TL;DR

> **Quick Summary**: Expose the Insight device's standby power threshold (GetPowerThreshold / SetPowerThreshold / ResetPowerThreshold SOAP actions) through the bridge API and web UI, so users can adjust when their device classifies a load as "standby" instead of "on."
>
> **Deliverables**:
> - 3 new methods on `InsightDeviceClient` (getPowerThreshold, setPowerThreshold, resetPowerThreshold)
> - 3 new API endpoints (GET / PUT / POST threshold)
> - Threshold number input on Insight device cards in web UI
> - TDD test coverage for SOAP methods and API routes
>
> **Estimated Effort**: Medium
> **Parallel Execution**: NO - sequential (Wave 1 -> 2 -> 3 -> 4)
> **Critical Path**: SOAP Methods -> API Routes -> Web UI -> Final Verification

---

## Context

### Original Request

WeMo Insight devices auto-classify loads as "standby" (state 8) when power draw falls below a firmware threshold (default 8W / 8000 mW). Low-draw devices like LED bulbs (~7W) permanently sit in standby, causing false-positive "Standby" status in the UI. Expose the device's SetPowerThreshold / GetPowerThreshold SOAP actions through the bridge API and web UI.

### Interview Summary

**Key Discussions**:
- **Test Strategy**: TDD (Red-Green-Refactor) chosen by user
- **UI Control**: Number input with stepper (step 0.5W, range 0-50W) chosen over slider
- **SOAP Protocol**: Service `urn:Belkin:service:insight:1`, control URL `/upnp/control/insight1`, milliwatt values
- **No database storage**: Device firmware persists the threshold value across reboots

**Research Findings**:
- `InsightDeviceClient` uses `soapRequest()` directly (NOT `executeWithRetry()` which is private and hardcoded to BASIC_EVENT_SERVICE)
- `extractNumericValue()` in soap.ts is the correct response parser for numeric SOAP values (NOT `extractTextValue()`)
- The existing `GET /api/devices/:id/insight` response already contains `raw.standbyThreshold` from InsightParams parsing (position 10) — the UI can pre-populate from this without an extra fetch
- No PUT endpoints exist in the codebase (all POST/GET/DELETE/PATCH), but the spec explicitly calls for PUT which is semantically correct for idempotent value replacement
- `getInsightClient()` helper in devices.ts handles device-not-found (404), device-offline (503), and not-Insight (400) errors in one call
- Validation pattern: collect missing fields in array, throw `ValidationError` with message + field names
- Frontend uses `data-*` attribute selectors for DOM targeting, `api.request()` for fetch calls
- Power stats show `--` placeholder initially, update async from `fetchInsightStats()`
- Tests use `bun:test` with `mock.module()` for SOAP mocking (see scheduler.test.ts pattern)

### Metis Review

**Identified Gaps** (all addressed in plan):
- `soapRequest()` vs `executeWithRetry()` — Critical: must use direct `soapRequest()` like `getInsightParams()` does
- `extractNumericValue()` vs `extractTextValue()` — Must use numeric extractor for milliwatt response
- Float math edge case — `Math.round(watts * 1000)` needed to avoid JavaScript float imprecision
- ResetPowerThreshold semantics — After reset, call `getPowerThreshold()` to confirm actual device value (don't assume 8000)
- UI initialization — Pre-populate from already-fetched `/insight` data, not a separate API call
- `change` event (not `input`) on number input — Prevents rapid-fire SOAP calls
- Error recovery — Toast + revert input value (follows existing toggle revert pattern)
- Test file organization — Separate `threshold.test.ts` to avoid polluting existing pure-function tests with mock setup

---

## Work Objectives

### Core Objective

Allow users to view and adjust the standby power threshold on WeMo Insight devices, through a clean API and inline UI control, so low-draw devices aren't permanently misclassified as "standby."

### Concrete Deliverables

- `packages/bridge/src/wemo/insight.ts` — 3 new methods on `InsightDeviceClient`
- `packages/bridge/src/wemo/__tests__/threshold.test.ts` — TDD tests for SOAP methods
- `packages/bridge/src/server/routes/devices.ts` — 3 new route handlers
- `packages/bridge/src/server/__tests__/threshold-routes.test.ts` — TDD tests for API routes
- `packages/web/js/api.js` — 3 new API client methods
- `packages/web/js/app.js` — Threshold control rendering + event handling
- `packages/web/css/style.css` — Threshold control styling

### Definition of Done

- [ ] `bun test` — all existing + new tests pass (exit code 0)
- [ ] `bun run typecheck` — clean (ignore pre-existing playwright e2e error)
- [ ] `bun run lint` — clean
- [ ] `bun run build` — succeeds
- [ ] GET /api/devices/:id/threshold returns `{ thresholdWatts, thresholdMilliwatts }` for Insight devices
- [ ] PUT /api/devices/:id/threshold accepts `{ watts: number }` (0-50) and sets device threshold via SOAP
- [ ] POST /api/devices/:id/threshold/reset calls ResetPowerThreshold then confirms with GetPowerThreshold
- [ ] Number input visible on online Insight device cards, pre-populated from existing Insight data
- [ ] Reset button restores device default and updates input
- [ ] Non-Insight devices return 400, offline devices return 503, missing devices return 404

### Must Have

- All 3 SOAP actions: GetPowerThreshold, SetPowerThreshold, ResetPowerThreshold
- API validation: watts must be a finite number >= 0 and <= 50
- API returns both watts AND milliwatts in responses (`thresholdWatts`, `thresholdMilliwatts`)
- `Math.round(watts * 1000)` for all watts-to-milliwatts conversions (JavaScript float precision)
- Confirm-after-reset: POST /reset calls `resetPowerThreshold()` then `getPowerThreshold()` to return actual device value
- UI pre-populates from existing `/insight` response's `raw.standbyThreshold / 1000` (no extra fetch)
- UI fires SOAP on `change` event only (not `input`)
- Error toast + input value revert on failed SOAP call

### Must NOT Have (Guardrails)

- **Do NOT use `executeWithRetry()`** — it's `private` on WemoDeviceClient and hardcoded to BASIC_EVENT_SERVICE. Use `soapRequest()` directly like `getInsightParams()` does.
- **Do NOT use `extractTextValue()`** for GetPowerThreshold — use `extractNumericValue()` (soap.ts:324-328)
- **Do NOT create a separate route file** — add 3 routes to existing `devices.ts` near the `/insight` endpoint
- **Do NOT modify the existing `/insight` endpoint response** — `raw.standbyThreshold` is already there
- **Do NOT add threshold to auto-refresh polling** — threshold changes are rare and user-initiated
- **Do NOT add retry logic** — consistent with `getInsightParams()` pattern (zero retries)
- **Do NOT use `input` event** on the number control — use `change` only (fires on commit, not per keystroke)
- **Do NOT modify InsightParams parsing** or state 0/1/8 interpretation
- **Do NOT add database storage** — device firmware persists the value
- **Do NOT add "apply to all devices"** bulk operation — per-device only
- **Do NOT add debounce/throttle** — `change` event on number input is naturally rate-limited
- **Do NOT add live state refresh** after threshold change — next auto-refresh cycle handles it

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks are verifiable WITHOUT any human action.
> Every criterion is an executable command or agent-driven Playwright/curl assertion.

### Test Decision

- **Infrastructure exists**: YES (bun:test, 6 existing test files)
- **Automated tests**: TDD (Red-Green-Refactor)
- **Framework**: bun:test (built-in)
- **Test command**: `bun test`

### TDD Workflow Per Task

Each TODO follows RED-GREEN-REFACTOR:

1. **RED**: Write failing test first
   - Test file created with describe/test blocks
   - Test command: `bun test [file]`
   - Expected: FAIL (test exists, implementation doesn't yet)
2. **GREEN**: Implement minimum code to pass
   - Command: `bun test [file]`
   - Expected: PASS
3. **REFACTOR**: Clean up while staying green
   - Command: `bun test [file]`
   - Expected: PASS (still)

### Agent-Executed QA Scenarios

Every task includes QA scenarios using these tools:

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| SOAP Methods | Bash (`bun test`) | Run tests, assert pass count and zero failures |
| API Endpoints | Bash (`curl`) | Send requests, parse JSON, assert status codes and fields |
| Frontend UI | Playwright (playwright skill) | Navigate, interact, assert DOM, screenshot |

---

## Execution Strategy

### Sequential Waves (No Parallelization)

```
Wave 1: SOAP Methods
└── Task 1: TDD getPowerThreshold, setPowerThreshold, resetPowerThreshold

Wave 2: API Endpoints (depends on Wave 1)
└── Task 2: TDD GET/PUT/POST threshold routes

Wave 3: Web UI (depends on Wave 2)
└── Task 3: API client + rendering + event handling + styling

Wave 4: Final Verification (depends on all)
└── Task 4: Full test suite, typecheck, lint, build
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 2 | None |
| 2 | 1 | 3 | None |
| 3 | 2 | 4 | None |
| 4 | 1, 2, 3 | None | None (final) |

### Agent Dispatch Summary

| Wave | Task | Recommended Agent |
|------|------|-------------------|
| 1 | 1 | `task(category="unspecified-high", load_skills=[], ...)` |
| 2 | 2 | `task(category="unspecified-high", load_skills=[], ...)` |
| 3 | 3 | `task(category="visual-engineering", load_skills=["frontend-ui-ux"], ...)` |
| 4 | 4 | `task(category="quick", load_skills=[], ...)` |

---

## TODOs

- [x] 1. TDD: Insight SOAP Threshold Methods

  **What to do**:

  **RED PHASE — Write failing tests first:**

  Create `packages/bridge/src/wemo/__tests__/threshold.test.ts` (separate file — do NOT add mock.module to existing `insight.test.ts` which tests pure functions without mocks).

  Mock setup (follow `scheduler.test.ts:17-49` pattern):
  ```typescript
  import { describe, expect, mock, test, beforeEach } from "bun:test";

  const mockSoapRequest = mock(() => Promise.resolve({ success: true, data: {} }));
  mock.module("../soap", () => ({
    soapRequest: mockSoapRequest,
    extractNumericValue: (await import("../soap")).extractNumericValue,
  }));
  ```

  Test cases to write:
  - `getPowerThreshold()` — asserts soapRequest called with action `"GetPowerThreshold"`, service `INSIGHT_SERVICE`, controlURL `INSIGHT_CONTROL_URL`, no body. Returns number (milliwatts) from response. Throws on `response.success === false`.
  - `setPowerThreshold(5000)` — asserts soapRequest called with action `"SetPowerThreshold"`, body `"<PowerThreshold>5000</PowerThreshold>"`. Throws on failure.
  - `resetPowerThreshold()` — asserts soapRequest called with action `"ResetPowerThreshold"`, body `"<PowerThreshold>8000</PowerThreshold>"`. Throws on failure.
  - Edge case: `getPowerThreshold` with empty/missing response field — throws Error
  - Edge case: `setPowerThreshold` body uses `Math.round()` — test with `setPowerThreshold(100)` and verify body is `"<PowerThreshold>100</PowerThreshold>"` (integer, not float)

  Run `bun test packages/bridge/src/wemo/__tests__/threshold.test.ts` — expect FAIL (methods don't exist yet).

  **GREEN PHASE — Implement the methods:**

  Add to `InsightDeviceClient` class in `packages/bridge/src/wemo/insight.ts`:

  ```typescript
  async getPowerThreshold(): Promise<number> {
    // Call soapRequest with "GetPowerThreshold", no body
    // Check response.success, throw on failure
    // Use extractNumericValue() on response.data?.PowerThreshold
    // Throw if result is 0 AND field is missing (not a genuine 0 threshold)
    // Return milliwatts as number
  }

  async setPowerThreshold(milliwatts: number): Promise<void> {
    // Call soapRequest with "SetPowerThreshold"
    // Body: `<PowerThreshold>${Math.round(milliwatts)}</PowerThreshold>`
    // Check response.success, throw on failure
  }

  async resetPowerThreshold(): Promise<void> {
    // Call soapRequest with "ResetPowerThreshold"
    // Body: `<PowerThreshold>8000</PowerThreshold>`
    // Check response.success, throw on failure
  }
  ```

  Import `extractNumericValue` from `./soap` (it's already exported).

  Run `bun test packages/bridge/src/wemo/__tests__/threshold.test.ts` — expect PASS.

  **REFACTOR PHASE:** Clean up any duplication in the 3 methods (they share the same error-check pattern). Ensure code is consistent with `getInsightParams()` style.

  **Must NOT do**:
  - Do NOT use `executeWithRetry()` — it's private and uses wrong service
  - Do NOT use `extractTextValue()` — use `extractNumericValue()` for numeric SOAP values
  - Do NOT add retry logic — match `getInsightParams()` pattern (zero retries)
  - Do NOT add these methods as standalone functions — they go on the `InsightDeviceClient` class
  - Do NOT modify the existing `getInsightParams()` or `getPowerData()` methods
  - Do NOT add mock.module() to existing `insight.test.ts` — create separate `threshold.test.ts`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Backend TypeScript implementation with SOAP protocol specifics, requires precise pattern matching
  - **Skills**: `[]`
    - No special skills needed — standard TypeScript + testing
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Not relevant — this is backend SOAP work

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential start)
  - **Blocks**: Task 2 (API routes depend on these methods)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/bridge/src/wemo/insight.ts:132-155` — `getInsightParams()` method: the exact pattern to follow for soapRequest() calls, error checking, and response extraction. Note: uses `INSIGHT_CONTROL_URL` and `INSIGHT_SERVICE` constants, NOT the basic event ones.
  - `packages/bridge/src/wemo/insight.ts:8-10` — Import pattern: `import { extractTextValue, soapRequest } from "./soap"` — add `extractNumericValue` to this import.
  - `packages/bridge/src/wemo/insight.ts:12-13` — Constants: `INSIGHT_SERVICE` and `INSIGHT_CONTROL_URL` — reuse these for all threshold SOAP calls.
  - `packages/bridge/src/wemo/insight.ts:157-170` — `getPowerData()` and `isInsightDevice` getter: shows the class method style.

  **API/Type References** (contracts to implement against):
  - `packages/bridge/src/wemo/soap.ts:135-143` — `soapRequest()` full signature: `soapRequest<T>(host, port, controlURL, serviceType, action, body?, timeout?)`. The `body` parameter is an XML string.
  - `packages/bridge/src/wemo/soap.ts:324-328` — `extractNumericValue()` function: returns number from XML value, or 0 for invalid. Use this for GetPowerThreshold response parsing.
  - `packages/bridge/src/wemo/soap.ts:88-92` — Example of body parameter: `"<BinaryState>1</BinaryState>"` — follow this pattern for `"<PowerThreshold>5000</PowerThreshold>"`.

  **Test References** (testing patterns to follow):
  - `packages/bridge/src/wemo/__tests__/scheduler.test.ts:17-49` — Mock setup pattern: `mock.module("../soap", () => ({ soapRequest: mockSoapRequest }))` with `beforeEach` clear. THIS is the pattern for mocking soapRequest in tests.
  - `packages/bridge/src/wemo/__tests__/insight.test.ts:5-26` — Test structure: `describe()` → `test()` blocks with `expect().toBe()` assertions. Note this file does NOT use mocks (pure functions only) — which is why threshold tests go in a SEPARATE file.

  **Acceptance Criteria**:

  **TDD Verification:**
  - [ ] RED: `bun test packages/bridge/src/wemo/__tests__/threshold.test.ts` → FAIL (methods not implemented)
  - [ ] GREEN: `bun test packages/bridge/src/wemo/__tests__/threshold.test.ts` → PASS (all tests green)
  - [ ] Test: `getPowerThreshold` calls soapRequest with action "GetPowerThreshold", service INSIGHT_SERVICE, controlURL INSIGHT_CONTROL_URL, no body param
  - [ ] Test: `getPowerThreshold` returns number (milliwatts) extracted via extractNumericValue
  - [ ] Test: `getPowerThreshold` throws Error when response.success is false
  - [ ] Test: `setPowerThreshold(5000)` calls soapRequest with action "SetPowerThreshold", body "<PowerThreshold>5000</PowerThreshold>"
  - [ ] Test: `setPowerThreshold` throws Error when response.success is false
  - [ ] Test: `resetPowerThreshold` calls soapRequest with action "ResetPowerThreshold", body "<PowerThreshold>8000</PowerThreshold>"
  - [ ] Test: `resetPowerThreshold` throws Error when response.success is false
  - [ ] Existing tests unaffected: `bun test packages/bridge/src/wemo/__tests__/insight.test.ts` → PASS (all original tests still green)
  - [ ] Type check: `bun run typecheck` → clean

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: All threshold SOAP method tests pass
    Tool: Bash (bun test)
    Preconditions: threshold.test.ts created with test cases, methods implemented in insight.ts
    Steps:
      1. Run: bun test packages/bridge/src/wemo/__tests__/threshold.test.ts
      2. Assert: Exit code 0
      3. Assert: stdout contains "pass" for all test cases
      4. Assert: stdout contains 0 failures
    Expected Result: All threshold tests pass
    Evidence: Terminal output captured

  Scenario: Existing insight tests are unaffected
    Tool: Bash (bun test)
    Preconditions: New threshold methods added to insight.ts
    Steps:
      1. Run: bun test packages/bridge/src/wemo/__tests__/insight.test.ts
      2. Assert: Exit code 0
      3. Assert: All original parseInsightParams, formatDuration, convertToPowerData tests pass
    Expected Result: Zero regressions in existing insight tests
    Evidence: Terminal output captured

  Scenario: TypeScript types are correct
    Tool: Bash (bun run typecheck)
    Preconditions: Methods added to InsightDeviceClient
    Steps:
      1. Run: bun run typecheck
      2. Assert: Exit code 0 (ignore pre-existing playwright e2e error)
      3. Assert: No new type errors in insight.ts or threshold.test.ts
    Expected Result: Clean type check
    Evidence: Terminal output captured
  ```

  **Evidence to Capture:**
  - [ ] Terminal output of `bun test threshold.test.ts` showing all tests pass
  - [ ] Terminal output of `bun test insight.test.ts` showing no regressions
  - [ ] Terminal output of `bun run typecheck` showing clean

  **Commit**: YES
  - Message: `feat(insight): add threshold SOAP methods with TDD tests`
  - Files: `packages/bridge/src/wemo/insight.ts`, `packages/bridge/src/wemo/__tests__/threshold.test.ts`
  - Pre-commit: `bun test packages/bridge/src/wemo/__tests__/threshold.test.ts && bun test packages/bridge/src/wemo/__tests__/insight.test.ts`

---

- [x] 2. TDD: API Threshold Route Endpoints

  **What to do**:

  **RED PHASE — Write failing tests first:**

  Create `packages/bridge/src/server/__tests__/threshold-routes.test.ts`.

  These tests need to mock the `InsightDeviceClient` methods. Follow the approach from the codebase — mock at the module level or use dependency injection. Since the route handlers call `getInsightClient()` which returns an `InsightDeviceClient`, mock the SOAP methods on the returned client.

  Test cases to write:
  - `GET /:id/threshold` — returns `{ id, thresholdWatts, thresholdMilliwatts }` where thresholdWatts = mW / 1000
  - `PUT /:id/threshold` with `{ watts: 5 }` — calls `setPowerThreshold(5000)`, returns updated threshold
  - `PUT /:id/threshold` with `{ watts: 0.5 }` — calls `setPowerThreshold(500)` (tests Math.round conversion)
  - `PUT /:id/threshold` validation: `{ watts: -1 }` → 400, `{ watts: 51 }` → 400, `{ watts: "abc" }` → 400, `{}` → 400, `{ watts: NaN }` → 400, `{ watts: Infinity }` → 400, `{ watts: null }` → 400
  - `POST /:id/threshold/reset` — calls `resetPowerThreshold()` then `getPowerThreshold()`, returns confirmed value
  - Non-Insight device → 400 with code `INSIGHT_NOT_SUPPORTED`
  - Non-existent device → 404 with code `DEVICE_NOT_FOUND`

  Run tests — expect FAIL.

  **GREEN PHASE — Implement the routes:**

  Add to `packages/bridge/src/server/routes/devices.ts`, near the existing `GET /:id/insight` endpoint (around line 387):

  ```typescript
  // GET /:id/threshold
  deviceRoutes.get("/:id/threshold", async (c) => {
    const device = requireDevice(c.req.param("id"));
    const client = await getInsightClient(device);
    const thresholdMilliwatts = await client.getPowerThreshold();
    return c.json({
      id: device.id,
      thresholdWatts: thresholdMilliwatts / 1000,
      thresholdMilliwatts,
    });
  });

  // PUT /:id/threshold
  deviceRoutes.put("/:id/threshold", async (c) => {
    const device = requireDevice(c.req.param("id"));
    const body = await c.req.json<{ watts?: unknown }>();
    // Validate: typeof === 'number', Number.isFinite(), >= 0, <= 50
    // Throw ValidationError on failure with fields: ["watts"]
    const client = await getInsightClient(device);
    const milliwatts = Math.round((body.watts as number) * 1000);
    await client.setPowerThreshold(milliwatts);
    return c.json({
      id: device.id,
      thresholdWatts: milliwatts / 1000,
      thresholdMilliwatts: milliwatts,
    });
  });

  // POST /:id/threshold/reset
  deviceRoutes.post("/:id/threshold/reset", async (c) => {
    const device = requireDevice(c.req.param("id"));
    const client = await getInsightClient(device);
    await client.resetPowerThreshold();
    const confirmedMilliwatts = await client.getPowerThreshold();
    return c.json({
      id: device.id,
      thresholdWatts: confirmedMilliwatts / 1000,
      thresholdMilliwatts: confirmedMilliwatts,
    });
  });
  ```

  Run tests — expect PASS.

  **REFACTOR PHASE:** Extract any shared validation logic if it's duplicated. Ensure consistent error messages.

  **Must NOT do**:
  - Do NOT create a separate route file — add to existing `devices.ts`
  - Do NOT modify the existing `GET /:id/insight` endpoint or its response shape
  - Do NOT add threshold to any existing auto-refresh or polling mechanism
  - Do NOT skip the confirm-after-reset pattern (reset THEN getPowerThreshold)
  - Do NOT accept watts values outside 0-50 range
  - Do NOT accept non-finite numbers (NaN, Infinity, -Infinity)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Backend API route implementation with validation logic and test mocking
  - **Skills**: `[]`
    - No special skills needed — standard TypeScript + Hono routes
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Not relevant — this is API work

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Wave 1)
  - **Blocks**: Task 3 (Web UI depends on these endpoints)
  - **Blocked By**: Task 1 (SOAP methods must exist first)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/bridge/src/server/routes/devices.ts:387-397` — `GET /:id/insight` endpoint: the exact pattern for Insight route handlers. Uses `requireDevice()` → `getInsightClient()` → call client method → `c.json()`.
  - `packages/bridge/src/server/routes/devices.ts:29-36` — `requireDevice()` helper: throws `DeviceNotFoundError(id)` for 404.
  - `packages/bridge/src/server/routes/devices.ts:54-63` — `getInsightClient()` helper: checks reachability (503 DeviceOfflineError), then supportsInsight() (400 InsightNotSupportedError), returns InsightDeviceClient. Use this for ALL 3 route handlers.
  - `packages/bridge/src/server/routes/devices.ts:168-210` — POST `/` validation pattern: collect missing fields, validate types, throw `ValidationError` with field names. Follow this for watts validation.

  **API/Type References** (contracts to implement against):
  - `packages/bridge/src/server/errors.ts:38-62` — `ApiError` base class with `toJSON()`: returns `{ error: true, code, message, deviceId? }`.
  - `packages/bridge/src/server/errors.ts` — Error classes: `ValidationError` (400), `DeviceNotFoundError` (404), `DeviceOfflineError` (503), `InsightNotSupportedError` (400).

  **Test References** (testing patterns to follow):
  - `packages/bridge/src/wemo/__tests__/scheduler.test.ts:17-49` — Mock module pattern for mocking dependencies.
  - `packages/bridge/src/__tests__/e2e/timers.e2e.test.ts` — E2E pattern with real server + mock device (reference only — NOT the approach for this task; unit tests with mocks are sufficient).

  **Acceptance Criteria**:

  **TDD Verification:**
  - [ ] RED: `bun test packages/bridge/src/server/__tests__/threshold-routes.test.ts` → FAIL (routes not implemented)
  - [ ] GREEN: `bun test packages/bridge/src/server/__tests__/threshold-routes.test.ts` → PASS
  - [ ] Test: GET /:id/threshold returns `{ id, thresholdWatts: 8, thresholdMilliwatts: 8000 }` shape
  - [ ] Test: PUT /:id/threshold with `{ watts: 5 }` calls setPowerThreshold(5000)
  - [ ] Test: PUT /:id/threshold with `{ watts: 0.5 }` calls setPowerThreshold(500) (Math.round conversion)
  - [ ] Test: PUT validation rejects -1, 51, "abc", {}, NaN, Infinity, null → 400 VALIDATION_ERROR
  - [ ] Test: POST /:id/threshold/reset calls resetPowerThreshold() then getPowerThreshold()
  - [ ] Test: Non-Insight device → 400 INSIGHT_NOT_SUPPORTED
  - [ ] Test: Non-existent device → 404 DEVICE_NOT_FOUND
  - [ ] All existing tests pass: `bun test` → exit code 0
  - [ ] Type check: `bun run typecheck` → clean

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: All route tests pass
    Tool: Bash (bun test)
    Preconditions: threshold-routes.test.ts created, routes implemented in devices.ts
    Steps:
      1. Run: bun test packages/bridge/src/server/__tests__/threshold-routes.test.ts
      2. Assert: Exit code 0
      3. Assert: All test cases pass
      4. Assert: 0 failures
    Expected Result: All route tests green
    Evidence: Terminal output captured

  Scenario: Full test suite still passes
    Tool: Bash (bun test)
    Preconditions: All Wave 1 + Wave 2 changes committed
    Steps:
      1. Run: bun test
      2. Assert: Exit code 0
      3. Assert: All test files pass including existing insight, soap, rules, types tests
    Expected Result: Zero regressions across entire test suite
    Evidence: Terminal output captured

  Scenario: Type checking passes
    Tool: Bash (bun run typecheck)
    Preconditions: Routes added to devices.ts
    Steps:
      1. Run: bun run typecheck
      2. Assert: Exit code 0 (ignore pre-existing playwright error)
    Expected Result: No new type errors
    Evidence: Terminal output captured
  ```

  **Evidence to Capture:**
  - [ ] Terminal output of route test run
  - [ ] Terminal output of full test suite
  - [ ] Terminal output of typecheck

  **Commit**: YES
  - Message: `feat(insight): add threshold API endpoints with TDD tests`
  - Files: `packages/bridge/src/server/routes/devices.ts`, `packages/bridge/src/server/__tests__/threshold-routes.test.ts`
  - Pre-commit: `bun test && bun run typecheck`

---

- [x] 3. Web UI: Threshold Control on Insight Device Cards

  **What to do**:

  **Step 1: Add API client methods to `packages/web/js/api.js`:**

  Add 3 methods following the `getInsightData()` pattern (api.js:190-192):
  ```javascript
  async getThreshold(id) {
    return request(`/devices/${encodeURIComponent(id)}/threshold`);
  },
  async setThreshold(id, watts) {
    return request(`/devices/${encodeURIComponent(id)}/threshold`, {
      method: "PUT",
      body: JSON.stringify({ watts }),
    });
  },
  async resetThreshold(id) {
    return request(`/devices/${encodeURIComponent(id)}/threshold/reset`, {
      method: "POST",
    });
  },
  ```

  **Step 2: Add threshold control HTML to `renderDeviceCard()` in `packages/web/js/app.js`:**

  Add a new section below the power-stats div (after line ~597 in the power-stats block). Only render for Insight + online devices:

  ```html
  <div class="threshold-control" data-threshold-control="{device.id}">
    <div class="threshold-label">Standby Threshold</div>
    <div class="threshold-input-group">
      <input type="number" min="0" max="50" step="0.5"
             data-threshold-input="{device.id}"
             value="--" disabled>
      <span class="threshold-unit">W</span>
      <button class="threshold-reset" data-threshold-reset="{device.id}"
              title="Reset to default">Reset</button>
    </div>
  </div>
  ```

  Guard: Same `isInsight && !isOffline` condition as power-stats.

  **Step 3: Pre-populate threshold from existing Insight data in `fetchDevicePowerStats()`:**

  In the `fetchDevicePowerStats()` function (app.js:806-828), after updating power-current and power-today values, also update the threshold input from the already-fetched data:

  ```javascript
  const thresholdInput = document.querySelector(`[data-threshold-input="${device.id}"]`);
  if (thresholdInput) {
    thresholdInput.value = (result.raw.standbyThreshold / 1000).toFixed(1);
    thresholdInput.disabled = false;
    thresholdInput._lastGoodValue = thresholdInput.value; // store for revert
  }
  ```

  This uses `result.raw.standbyThreshold` (milliwatts) from the existing `/insight` response — NO extra API call needed.

  **Step 4: Add event handlers for threshold change and reset:**

  Use event delegation on the device list container (follow existing toggle handler pattern):

  ```javascript
  // On "change" event (NOT "input") — fires once when user commits value
  // 1. Read new watts value from input
  // 2. Validate 0-50 range client-side
  // 3. Call api.setThreshold(deviceId, watts)
  // 4. On success: update _lastGoodValue
  // 5. On error: show toast (existing showToast pattern at app.js:951), revert to _lastGoodValue

  // On click of reset button:
  // 1. Call api.resetThreshold(deviceId)
  // 2. On success: update input.value = result.thresholdWatts, update _lastGoodValue
  // 3. On error: show toast
  ```

  Error revert pattern follows the toggle revert at `app.js:940-944`:
  ```javascript
  } catch (error) {
    toggle.checked = !toggle.checked; // revert UI
    showToast(error.message, "error");
  }
  ```

  **Step 5: Add CSS styles to `packages/web/css/style.css`:**

  Add near the power-stats styles (around line 511):

  ```css
  .threshold-control {
    padding: 0 var(--spacing-md) var(--spacing-md);
    /* No top padding — flows naturally below power-stats */
  }

  .threshold-label {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--spacing-xs);
  }

  .threshold-input-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .threshold-input-group input[type="number"] {
    width: 80px;
    padding: var(--spacing-xs) var(--spacing-sm);
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    font-size: var(--font-size-sm);
    text-align: center;
  }

  .threshold-input-group input[type="number"]:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .threshold-unit {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .threshold-reset {
    /* Follow existing small button pattern */
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: var(--font-size-xs);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .threshold-reset:hover {
    border-color: var(--color-text);
    color: var(--color-text);
  }
  ```

  Use existing CSS variables throughout — do NOT introduce new custom properties.

  **Must NOT do**:
  - Do NOT add a separate API call to fetch threshold — pre-populate from existing `/insight` data
  - Do NOT use `input` event — use `change` only (fires on blur/enter, not per keystroke)
  - Do NOT add the threshold control for non-Insight devices or offline devices
  - Do NOT add debounce/throttle — `change` event is naturally rate-limited
  - Do NOT introduce new CSS custom properties — use existing `--color-*`, `--spacing-*`, `--font-size-*`, `--radius-*`
  - Do NOT add a "save" button — the number input fires on change (device persists immediately)
  - Do NOT add threshold to auto-refresh polling
  - Do NOT show threshold in the main device list for non-Insight devices

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend UI implementation with HTML rendering, CSS styling, and DOM event handling
  - **Skills**: `["frontend-ui-ux"]`
    - `frontend-ui-ux`: UI component creation, CSS styling, DOM interactions — core of this task
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed for implementation — QA scenarios use it but the agent knows Playwright intrinsically

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Wave 2)
  - **Blocks**: Task 4 (final verification)
  - **Blocked By**: Task 2 (API endpoints must exist for the UI to call)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/web/js/app.js:560-623` — `renderDeviceCard()`: how device cards are structured. The `isInsight && !isOffline` guard (line 583-584) for power-stats — use same guard for threshold control. The `data-power-stats="${device.id}"` pattern — follow with `data-threshold-control="${device.id}"`.
  - `packages/web/js/app.js:796-828` — `fetchInsightStats()` and `fetchDevicePowerStats()`: how power stats are fetched and DOM-updated. Pre-populate threshold input from `result.raw.standbyThreshold / 1000` in this same function.
  - `packages/web/js/app.js:586-594` — Power stats HTML template: 2-column grid with `data-power-current` and `data-power-today` selectors. Follow this data-attribute pattern for threshold.
  - `packages/web/js/app.js:940-951` — Toggle error handling with revert: `toggle.checked = !toggle.checked` and `showToast(error.message, "error")`. Follow for threshold input revert on error.
  - `packages/web/js/api.js:190-192` — `getInsightData(id)` API method: follow for new threshold API methods.
  - `packages/web/js/api.js:32-74` — `request()` function: handles fetch, timeout, JSON parsing, error classes. All API methods go through this.

  **Styling References**:
  - `packages/web/css/style.css:487-511` — `.power-stats` and `.power-stat` styles: layout pattern, font sizes, colors. The threshold control goes visually below this section.
  - `packages/web/css/style.css:9-30` — CSS custom properties: `--color-primary`, `--color-text-muted`, `--color-surface`, `--color-border`, `--spacing-*`, `--font-size-*`, `--radius-*`. Use these exclusively.
  - `packages/web/css/style.css:235-298` — `.device-card` layout: flex column with sections. Threshold control is a new section in this column.

  **Acceptance Criteria**:

  - [ ] API client: `api.getThreshold(id)`, `api.setThreshold(id, watts)`, `api.resetThreshold(id)` methods exist in api.js
  - [ ] HTML: `[data-threshold-control]` element renders inside Insight device cards
  - [ ] HTML: `input[type="number"][min="0"][max="50"][step="0.5"]` exists with `[data-threshold-input]` attribute
  - [ ] HTML: Reset button with `[data-threshold-reset]` attribute exists
  - [ ] Threshold control does NOT render for non-Insight devices or offline Insight devices
  - [ ] Input pre-populates from `/insight` response `raw.standbyThreshold / 1000` (no extra fetch)
  - [ ] Input starts disabled with placeholder, enables after data loads
  - [ ] Change event on input fires PUT to `/api/devices/:id/threshold`
  - [ ] Reset button fires POST to `/api/devices/:id/threshold/reset`
  - [ ] Error shows toast and reverts input to last-known-good value
  - [ ] CSS uses only existing custom properties (no new `--color-*` etc.)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Threshold control renders for online Insight device
    Tool: Playwright (playwright skill)
    Preconditions: Bridge server running with at least 1 online Insight device
    Steps:
      1. Navigate to: http://localhost:{port}/
      2. Wait for: [data-device-type="Insight"] visible (timeout: 10s)
      3. Assert: [data-threshold-control] exists inside the Insight device card
      4. Assert: input[data-threshold-input] has attributes type="number", min="0", max="50", step="0.5"
      5. Assert: button[data-threshold-reset] exists with text "Reset"
      6. Wait for: input[data-threshold-input] is NOT disabled (timeout: 10s — waits for /insight data load)
      7. Assert: input value is a number (not "--")
      8. Screenshot: .sisyphus/evidence/task-3-threshold-renders.png
    Expected Result: Threshold control visible with loaded value
    Evidence: .sisyphus/evidence/task-3-threshold-renders.png

  Scenario: Threshold control hidden for non-Insight device
    Tool: Playwright (playwright skill)
    Preconditions: Bridge server running with at least 1 non-Insight device (Switch)
    Steps:
      1. Navigate to: http://localhost:{port}/
      2. Wait for: .device-card visible (timeout: 10s)
      3. Find: Device card without data-device-type="Insight"
      4. Assert: No [data-threshold-control] inside that card
      5. Screenshot: .sisyphus/evidence/task-3-no-threshold-switch.png
    Expected Result: No threshold control on non-Insight cards
    Evidence: .sisyphus/evidence/task-3-no-threshold-switch.png

  Scenario: Setting threshold via number input
    Tool: Playwright (playwright skill)
    Preconditions: Bridge server running with online Insight device, threshold loaded
    Steps:
      1. Navigate to: http://localhost:{port}/
      2. Wait for: input[data-threshold-input] enabled (timeout: 10s)
      3. Clear input, type "5"
      4. Press Tab (triggers change event / blur)
      5. Wait for: network request to PUT /api/devices/*/threshold completes (timeout: 5s)
      6. Assert: input value is "5" (or "5.0" depending on formatting)
      7. Screenshot: .sisyphus/evidence/task-3-threshold-set.png
    Expected Result: Threshold updated to 5W via API call
    Evidence: .sisyphus/evidence/task-3-threshold-set.png

  Scenario: Reset button restores default
    Tool: Playwright (playwright skill)
    Preconditions: Bridge server running, threshold previously changed from default
    Steps:
      1. Navigate to: http://localhost:{port}/
      2. Wait for: button[data-threshold-reset] visible (timeout: 10s)
      3. Click: button[data-threshold-reset]
      4. Wait for: network request to POST /api/devices/*/threshold/reset completes (timeout: 5s)
      5. Assert: input[data-threshold-input] value is "8" (or "8.0" — the default)
      6. Screenshot: .sisyphus/evidence/task-3-threshold-reset.png
    Expected Result: Threshold reset to 8W default
    Evidence: .sisyphus/evidence/task-3-threshold-reset.png

  Scenario: Styling matches existing UI patterns
    Tool: Playwright (playwright skill)
    Preconditions: Bridge server running with Insight device
    Steps:
      1. Navigate to: http://localhost:{port}/
      2. Wait for: .threshold-control visible (timeout: 10s)
      3. Assert: .threshold-label computed color matches --color-text-muted
      4. Assert: .threshold-input-group displays as flex row
      5. Assert: input has border matching --color-border
      6. Screenshot: .sisyphus/evidence/task-3-threshold-styling.png
    Expected Result: Threshold control visually consistent with power stats
    Evidence: .sisyphus/evidence/task-3-threshold-styling.png
  ```

  **Evidence to Capture:**
  - [ ] Screenshots in .sisyphus/evidence/ for all UI scenarios
  - [ ] task-3-threshold-renders.png — control visible on Insight card
  - [ ] task-3-no-threshold-switch.png — control absent on non-Insight card
  - [ ] task-3-threshold-set.png — value changed via input
  - [ ] task-3-threshold-reset.png — value reset to default
  - [ ] task-3-threshold-styling.png — visual consistency check

  **Commit**: YES
  - Message: `feat(insight): add threshold control to web UI`
  - Files: `packages/web/js/api.js`, `packages/web/js/app.js`, `packages/web/css/style.css`
  - Pre-commit: `bun test && bun run typecheck`

---

- [x] 4. Final Verification: Full CI Pipeline Check

  **What to do**:

  Run the complete CI verification pipeline to ensure no regressions across the entire project.

  1. `bun test` — all tests pass (existing + new threshold + route tests)
  2. `bun run typecheck` — clean TypeScript compilation (ignore pre-existing playwright e2e error)
  3. `bun run lint` — no linting errors
  4. `bun run build` — successful build output

  Verify specific acceptance criteria:
  - All original insight.test.ts tests still pass (no regressions)
  - All original soap.test.ts, rules.test.ts, types.test.ts tests still pass
  - New threshold.test.ts tests pass
  - New threshold-routes.test.ts tests pass
  - Zero new TypeScript errors introduced

  **Must NOT do**:
  - Do NOT skip any verification step
  - Do NOT ignore new errors (only pre-existing playwright e2e error is acceptable)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple verification commands — no implementation
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - All skills: This is just running 4 commands

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (final)
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 1, 2, 3 (all implementation must be complete)

  **References**:

  - `.github/workflows/ci.yml` — CI pipeline definition: lint → typecheck → test → build. Follow this exact order.
  - `package.json` — Root workspace scripts: `"test": "bun test"`, `"typecheck": "..."`, `"lint": "..."`, `"build": "..."`

  **Acceptance Criteria**:

  - [ ] `bun test` → exit code 0, all test files pass
  - [ ] `bun run typecheck` → exit code 0 (ignore pre-existing playwright error)
  - [ ] `bun run lint` → exit code 0
  - [ ] `bun run build` → exit code 0

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Full test suite passes
    Tool: Bash (bun test)
    Preconditions: All 3 waves of implementation complete
    Steps:
      1. Run: bun test
      2. Assert: Exit code 0
      3. Assert: All test files pass (insight, soap, rules, types, threshold, threshold-routes, scheduler)
      4. Assert: 0 failures across all test files
    Expected Result: Complete test suite green
    Evidence: Terminal output captured

  Scenario: TypeScript compilation clean
    Tool: Bash (bun run typecheck)
    Preconditions: All source files modified
    Steps:
      1. Run: bun run typecheck
      2. Assert: Exit code 0
      3. Assert: No new errors (only pre-existing playwright e2e import error acceptable)
    Expected Result: Clean type check
    Evidence: Terminal output captured

  Scenario: Lint passes
    Tool: Bash (bun run lint)
    Preconditions: All source files modified
    Steps:
      1. Run: bun run lint
      2. Assert: Exit code 0
    Expected Result: No linting errors
    Evidence: Terminal output captured

  Scenario: Build succeeds
    Tool: Bash (bun run build)
    Preconditions: All code changes finalized
    Steps:
      1. Run: bun run build
      2. Assert: Exit code 0
      3. Assert: Build output directory contains expected files
    Expected Result: Successful production build
    Evidence: Terminal output captured
  ```

  **Evidence to Capture:**
  - [ ] Terminal output of `bun test` (full suite)
  - [ ] Terminal output of `bun run typecheck`
  - [ ] Terminal output of `bun run lint`
  - [ ] Terminal output of `bun run build`

  **Commit**: NO (verification only — no file changes)

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(insight): add threshold SOAP methods with TDD tests` | `insight.ts`, `threshold.test.ts` | `bun test && bun run typecheck` |
| 2 | `feat(insight): add threshold API endpoints with TDD tests` | `devices.ts`, `threshold-routes.test.ts` | `bun test && bun run typecheck` |
| 3 | `feat(insight): add threshold control to web UI` | `api.js`, `app.js`, `style.css` | `bun test && bun run typecheck` |
| 4 | (no commit — verification only) | — | `bun test && bun run typecheck && bun run lint && bun run build` |

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all tests pass, exit code 0
bun run typecheck           # Expected: clean (ignore pre-existing playwright error)
bun run lint                # Expected: clean
bun run build               # Expected: successful build
```

### Final Checklist
- [ ] All "Must Have" items present (SOAP methods, API endpoints, UI control, TDD tests)
- [ ] All "Must NOT Have" items absent (no executeWithRetry, no DB storage, no polling, no extractTextValue)
- [ ] All existing tests pass unchanged (zero regressions)
- [ ] New threshold.test.ts tests pass
- [ ] New threshold-routes.test.ts tests pass
- [ ] UI renders threshold control only for online Insight devices
- [ ] API validates watts range 0-50 and rejects invalid input
- [ ] Reset endpoint confirms actual device value via getPowerThreshold()
- [ ] Math.round() used for all watts→milliwatts conversions
