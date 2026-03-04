# Timer/Schedule Feature Implementation Plan

## TL;DR

> **Quick Summary**: Add device-native timer/schedule management to open-wemo. Wemo devices store rules in an internal SQLite DB transferred as base64-encoded ZIP over SOAP. Build a new `rules.ts` module, REST API routes, and a vanilla JS timer panel UI — following existing codebase patterns exactly.
> 
> **Deliverables**:
> - `packages/bridge/src/wemo/rules.ts` — Rules module (SOAP + ZIP + SQLite)
> - Timer types added to `packages/bridge/src/wemo/types.ts`
> - `packages/bridge/src/server/routes/timers.ts` — Timer CRUD API routes
> - New error types in `packages/bridge/src/server/errors.ts`
> - Route registration in `packages/bridge/src/server/index.ts`
> - `packages/web/js/timer-panel.js` — Timer UI module
> - Timer API methods in `packages/web/js/api.js`
> - Device card timer icon + integration in `packages/web/js/app.js`
> - Timer panel CSS in `packages/web/css/style.css`
> - `packages/bridge/src/wemo/__tests__/rules.test.ts` — Unit tests
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 7 → Task 8

---

## Context

### Original Request
Add timer/schedule management to the open-wemo project — a HomeKit bridge for Wemo smart plugs. The feature must support creating, editing, deleting, and toggling timer rules on Wemo devices. Issue #3 — "Edit Wemo Schedule."

### Interview Summary
**Key Discussions**:
- Full feature spec provided at `docs/TIMER-FEATURE-SPEC.md`
- Protocol research completed at `research/wemo-oss-timer-comparison.md` and `research/wemo-rules-protocol-research.md`
- pywemo (Python) is the only OSS reference implementation — its SQLite DB approach is the only battle-tested path
- Follow InsightDeviceClient pattern (class extends WemoDeviceClient + pure function exports)
- SOAP layer is fully generic — zero changes needed
- Frontend is vanilla JS, no framework migration
- `bun:test` exists with established patterns

**Research Findings**:
- SQLite schema has 3 main tables: RULES, RULEDEVICES, TARGETDEVICES
- SOAP service: `urn:Belkin:service:rules:1`, control URL `/upnp/control/rules1`
- FetchRules returns ruleDbPath (HTTP URL to download ZIP) + ruleDbVersion
- StoreRules takes incremented version, `processDb=1`, body with entity-encoded CDATA base64 ZIP
- ZIP inner filename must be `temppluginRules.db`
- DayID: -1 = daily, bitmask for specific days (Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64)
- Actions: 0.0=OFF, 1.0=ON, 2.0=TOGGLE (float)
- Time values: seconds from midnight (0-86400)
- RuleID: manually assigned (max existing + 1)
- Empty DB: FetchRules may 404 → must create from scratch
- Device thread limit: very few HTTP threads, rapid requests can crash device

### Metis Review
**Identified Gaps** (addressed):
- **ZIP library needed**: Bun has no built-in ZIP support → use `fflate` (lightweight, pure JS, ~8KB)
- **DayID bitmask ambiguity**: Research docs have contradictory info → verify against pywemo source in Task 2 before implementing
- **`bun:sqlite` buffer support**: Must verify `Database` can open from buffer → spike test in Task 1
- **Frontend module separation**: `app.js` is 1861 lines → extract timer UI to separate `timer-panel.js` module
- **Add/edit form pattern**: No accordion pattern exists → use modal (5 modals already exist as precedent)
- **Sunrise/sunset/countdown**: Mentioned in types but no UI → explicitly out of scope for V1
- **Multi-device rules**: TARGETDEVICES can point to other devices → V1 self-target only
- **CDATA encoding**: `ruleDbBody` must use entity-encoded CDATA (`&lt;![CDATA[...]]&gt;`) — needs explicit test
- **Service availability**: Not all devices support `rules:1` → only show timer icon if service present
- **Rate limiting**: Disable UI during operations, don't hammer device

---

## Work Objectives

### Core Objective
Enable users to view, create, edit, delete, and toggle device-native timer schedules on Wemo devices, with all operations persisted directly on the device firmware (autonomous execution without bridge).

### Concrete Deliverables
- Backend rules module with full fetch-modify-store cycle
- REST API for timer CRUD per device
- Mobile-first timer panel UI integrated into device cards
- Unit tests for all pure functions and protocol handling
- Error handling for offline devices, SOAP faults, version conflicts

### Definition of Done
- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun run lint` passes
- [ ] `bun run test` passes (all existing + new tests)
- [ ] Timer CRUD works end-to-end via API (curl verification)
- [ ] Timer panel renders in both dark and light themes
- [ ] Timer panel is accessible (focus trapping, screen reader announcements)

### Must Have
- Fetch timers from device via FetchRules SOAP call
- Create new timer rules with time, action, and day selection
- Edit existing timer rules
- Delete timer rules with confirmation
- Toggle timer rules enabled/disabled
- Empty DB creation path (device with no existing rules)
- Loading/saving spinner states
- Error display for offline devices
- Mobile-first responsive design
- Dark/light theme support

### Must NOT Have (Guardrails)
- **DO NOT** modify `packages/bridge/src/wemo/soap.ts` — it is fully generic and requires zero changes
- **DO NOT** add sunrise/sunset timer support — V1 is fixed-time Timer-type only
- **DO NOT** add countdown timer support (`CountdownTime` field) — future scope
- **DO NOT** implement multi-device rules (TARGETDEVICES pointing to other devices) — V1 self-target only
- **DO NOT** implement away mode / simulation rules (`SimulatedRuleData`)
- **DO NOT** implement weekly calendar SOAP actions (`UpdateWeeklyCalendar` etc.)
- **DO NOT** allow editing non-Timer type rules (Long Press, Simple) — show them read-only
- **DO NOT** cache timer data client-side or server-side — always fetch fresh from device
- **DO NOT** add new dependencies beyond `fflate` (ZIP library)
- **DO NOT** create new branches — all work on `feature/timer-schedules`
- **DO NOT** introduce a frontend framework — vanilla JS only
- **DO NOT** add `RuleOrder` logic — always set to 0
- **DO NOT** over-abstract the rules module — keep it focused on Timer-type CRUD

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.
> This is NOT conditional — it applies to EVERY task, regardless of test strategy.

### Test Decision
- **Infrastructure exists**: YES — `bun:test` with 3 existing test files
- **Automated tests**: YES (Tests-after — write implementation, then comprehensive tests)
- **Framework**: `bun:test` (matching existing `__tests__/*.test.ts` pattern)

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

Every task includes Agent-Executed QA Scenarios as verification. The executing agent directly runs the deliverable:
- **Backend**: `bun test` for unit tests, `curl` for API verification
- **Frontend**: Playwright for UI verification (navigate, click, assert DOM)
- **Build**: `bun run typecheck && bun run lint && bun run test` for CI checks

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Foundation — ZIP dep + bun:sqlite buffer spike + types
└── (sequential dependency chain starts here)

Wave 2 (After Task 4 — API routes complete):
├── Task 5: Frontend API client methods (depends: Task 4)
├── Task 6: Timer panel CSS (no backend dependency)
└── (parallel: 5 and 6 can run simultaneously)

Wave 3 (After Wave 2):
├── Task 7: Timer panel JS module (depends: 5, 6)
├── Task 8: Device card integration (depends: 7)
└── Task 9: Final QA + lint + typecheck (depends: all)
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 (Foundation) | None | 2, 3 | None (start immediately) |
| 2 (Rules module) | 1 | 3 | None |
| 3 (Rules tests) | 2 | 4 | None |
| 4 (API routes) | 3 | 5, 7 | None |
| 5 (API client) | 4 | 7, 8 | 6 |
| 6 (Timer CSS) | None | 7, 8 | 5 |
| 7 (Timer panel JS) | 5, 6 | 8 | None |
| 8 (Device card integration) | 7 | 9 | None |
| 9 (Final QA) | All | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 2, 3, 4 (sequential chain) | task(category="deep", load_skills=[], run_in_background=false) |
| 2 | 5, 6 (parallel) | task(category="quick", ...) for 5; task(category="visual-engineering", load_skills=["frontend-ui-ux"], ...) for 6 |
| 3 | 7, 8 (sequential) | task(category="visual-engineering", load_skills=["frontend-ui-ux"], ...) |
| Final | 9 | task(category="quick", ...) |

---

## TODOs

- [x] 1. Foundation: ZIP Dependency, bun:sqlite Buffer Verification, and Type Definitions

  **What to do**:
  - Install `fflate` as a dependency in `packages/bridge/package.json`: `bun add fflate` (from the `packages/bridge/` directory)
  - Create a quick spike script to verify `bun:sqlite` can open a Database from a `Uint8Array` buffer:
    - `import { Database } from "bun:sqlite"; const db = new Database(Buffer.from(sqliteBytes));`
    - If this doesn't work, design a temp file approach: write buffer to temp file, open, modify, read back, delete
  - Add timer/rules type definitions to `packages/bridge/src/wemo/types.ts`:
    ```typescript
    /** Action values for timer rules */
    export enum TimerAction {
      Off = 0,
      On = 1,
      Toggle = 2,
    }

    /** Timer rule as stored on the Wemo device */
    export interface TimerRule {
      ruleID: number
      name: string
      type: 'Timer'
      enabled: boolean
      startTime: number      // seconds from midnight (0-86400)
      endTime?: number        // seconds from midnight (optional, for on/off pairs)
      startAction: TimerAction
      endAction?: TimerAction
      dayId: number           // -1=daily, bitmask for specific days
    }

    /** Schedule data fetched from a device */
    export interface TimerSchedule {
      deviceId: string
      rules: TimerRule[]
      dbVersion: number
    }

    /** Input for creating a new timer rule */
    export interface CreateTimerInput {
      name: string
      startTime: number
      endTime?: number
      startAction: TimerAction
      endAction?: TimerAction
      dayId: number
    }

    /** Input for updating a timer rule */
    export interface UpdateTimerInput {
      name?: string
      startTime?: number
      endTime?: number
      startAction?: TimerAction
      endAction?: TimerAction
      dayId?: number
      enabled?: boolean
    }
    ```
  - Verify DayID bitmask encoding by searching pywemo source on GitHub: confirm Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64
  - Add helper constants for DayID:
    ```typescript
    export const DAYS = {
      DAILY: -1,
      SUN: 1, MON: 2, TUE: 4, WED: 8, THU: 16, FRI: 32, SAT: 64,
      WEEKDAYS: 2 + 4 + 8 + 16 + 32,  // 62
      WEEKENDS: 1 + 64,                 // 65
      ALL: 127,
    } as const
    ```

  **Must NOT do**:
  - Do not modify `soap.ts`
  - Do not install any dependency other than `fflate`
  - Do not create the full rules module yet — just types and spike

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires verification of `bun:sqlite` buffer support (potentially tricky), pywemo source investigation, and careful type design that affects all downstream tasks
  - **Skills**: []
    - No specialized skills needed — this is TypeScript type design + dependency investigation

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential start)
  - **Blocks**: Task 2 (rules module needs types + fflate + sqlite approach)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `packages/bridge/src/wemo/types.ts:1-209` — Existing type definitions to extend (InsightParams, PowerData interfaces as style reference)
  - `packages/bridge/src/wemo/insight.ts:14-20` — Constant definition pattern (service type, control URL)

  **API/Type References**:
  - `docs/TIMER-FEATURE-SPEC.md:42-59` — TimerRule and TimerSchedule interface specs
  - `research/wemo-oss-timer-comparison.md:53-89` — SQLite schema for RULES and RULEDEVICES tables
  - `research/wemo-oss-timer-comparison.md:326-329` — DayID bitmask values (NEEDS VERIFICATION against pywemo)
  - `research/wemo-rules-protocol-research.md:125-165` — Full column listing for all tables

  **Documentation References**:
  - `research/wemo-oss-timer-comparison.md:155-168` — Key gotchas from pywemo (RuleID assignment, date format, etc.)

  **External References**:
  - pywemo source: `https://github.com/pywemo/pywemo/blob/main/pywemo/ouimeaux_device/api/rules_db.py` — Reference implementation for rules DB handling
  - fflate docs: `https://github.com/101arrowz/fflate` — ZIP library API
  - Bun SQLite docs: `https://bun.sh/docs/api/sqlite` — Database constructor signature

  **WHY Each Reference Matters**:
  - `types.ts` — Match the existing naming conventions, JSDoc style, and enum patterns
  - Feature spec interfaces — Contract for the API layer and rules module
  - pywemo source — MUST verify DayID bitmask encoding (research docs contradict each other)
  - fflate — Need to understand zip/unzip API for the rules module
  - Bun SQLite — Confirm whether `new Database(buffer)` works or if temp file is needed

  **Acceptance Criteria**:
  - [ ] `fflate` installed: `cat packages/bridge/package.json | grep fflate` → shows version
  - [ ] bun:sqlite buffer spike: create a temporary test that opens a SQLite DB from a Uint8Array → verify it works or document the temp file workaround
  - [ ] Type definitions added to `types.ts`: `TimerRule`, `TimerSchedule`, `CreateTimerInput`, `UpdateTimerInput`, `TimerAction` enum, `DAYS` constants
  - [ ] DayID encoding verified against pywemo source with specific evidence
  - [ ] `bun run typecheck` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Verify fflate installation
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: cat packages/bridge/package.json | jq '.dependencies.fflate'
      2. Assert: output is a semver version string (not null)
      3. Run: bun install (from project root)
      4. Assert: exit code 0
    Expected Result: fflate appears in dependencies
    Evidence: Command output captured

  Scenario: Verify bun:sqlite buffer opening
    Tool: Bash
    Preconditions: bun installed
    Steps:
      1. Create a temp test file that:
         - Creates an in-memory SQLite DB, creates a table, inserts a row
         - Serializes it to a Uint8Array via db.serialize()
         - Opens a NEW Database from that Uint8Array
         - Queries the table and verifies the row exists
      2. Run: bun run temp-test.ts
      3. Assert: test passes, output confirms round-trip works
      4. Delete temp test file
    Expected Result: bun:sqlite supports buffer-based Database opening
    Evidence: Test output captured

  Scenario: Typecheck passes with new types
    Tool: Bash
    Preconditions: Types added to types.ts
    Steps:
      1. Run: bun run typecheck
      2. Assert: exit code 0, no errors
    Expected Result: Zero type errors
    Evidence: Command output captured
  ```

  **Commit**: YES
  - Message: `feat(rules): add timer types and fflate dependency`
  - Files: `packages/bridge/src/wemo/types.ts`, `packages/bridge/package.json`, `packages/bridge/bun.lockb`
  - Pre-commit: `bun run typecheck`

---

- [x] 2. Rules Module Core — FetchRules, StoreRules, SQLite CRUD

  **What to do**:
  - Create `packages/bridge/src/wemo/rules.ts` following the `InsightDeviceClient` pattern
  - Implement these core functions:
    1. **`fetchRulesDb(host, port)`** — SOAP `FetchRules` → parse `ruleDbVersion` + `ruleDbPath` → HTTP GET the ZIP → unzip with `fflate` → open SQLite DB → parse RULES + RULEDEVICES tables → return `TimerSchedule`
    2. **`storeRulesDb(host, port, dbBuffer, version)`** — serialize SQLite → zip with fflate (filename: `temppluginRules.db`) → base64 encode → SOAP `StoreRules` with incremented version, `processDb=1`, entity-encoded CDATA body
    3. **`createEmptyRulesDb()`** — create new in-memory SQLite DB with full schema (RULES, RULEDEVICES, TARGETDEVICES tables) → return as buffer
    4. **`parseRulesFromDb(dbBuffer)`** — open SQLite from buffer → SELECT from RULES + RULEDEVICES → map to `TimerRule[]`
    5. **`addRuleToDb(dbBuffer, rule, deviceUdn)`** — open DB → INSERT into RULES (RuleID = max+1, Type="Timer", State="1", StartDate="12201982", EndDate="07301982", Sync="NOSYNC") + RULEDEVICES + TARGETDEVICES → return modified buffer
    6. **`updateRuleInDb(dbBuffer, ruleId, changes)`** — open DB → UPDATE RULES + RULEDEVICES rows → return modified buffer
    7. **`deleteRuleFromDb(dbBuffer, ruleId)`** — open DB → DELETE from RULES + RULEDEVICES + TARGETDEVICES → return modified buffer
    8. **`toggleRuleInDb(dbBuffer, ruleId, enabled)`** — open DB → UPDATE RULES SET State → return modified buffer
  - Implement high-level convenience functions that do the full fetch-modify-store cycle:
    1. **`fetchTimers(host, port)`** → fetch → parse → return `TimerSchedule`
    2. **`addTimer(host, port, rule, deviceUdn)`** → fetch → add → store
    3. **`updateTimer(host, port, ruleId, changes, deviceUdn)`** → fetch → update → store
    4. **`deleteTimer(host, port, ruleId, deviceUdn)`** → fetch → delete → store
    5. **`toggleTimer(host, port, ruleId, enabled, deviceUdn)`** → fetch → toggle → store
  - Implement helper functions:
    1. **`secondsToTimeString(seconds)`** — 25200 → "7:00 AM"
    2. **`timeStringToSeconds(timeStr)`** — "7:00 AM" → 25200
    3. **`dayIdToLabel(dayId)`** — -1 → "Daily", 62 → "Weekdays", 65 → "Weekends", etc.
    4. **`dayIdToDayNames(dayId)`** — 62 → ["Mon", "Tue", "Wed", "Thu", "Fri"]
  - Handle empty DB case: if FetchRules HTTP GET returns 404, call `createEmptyRulesDb()`
  - CDATA encoding: the body string passed to `soapRequest` must contain `&lt;![CDATA[${base64}]]&gt;`
  - All RULEDEVICES fields for a timer: set unused fields to defaults (-1 for integers, "" for strings)

  **Must NOT do**:
  - Do not modify `soap.ts`
  - Do not implement sunrise/sunset/countdown logic
  - Do not cache any DB state
  - Do not create a class extending WemoDeviceClient (use standalone functions that take host/port — the route layer handles device lookup)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex protocol implementation with ZIP+SQLite+SOAP+base64 chain, multiple edge cases, requires careful attention to binary data handling and pywemo compatibility
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential after Task 1)
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/bridge/src/wemo/insight.ts:31-57` — Pure function pattern (parseInsightParams, formatDuration, convertToPowerData)
  - `packages/bridge/src/wemo/insight.ts:132-154` — SOAP call pattern with soapRequest, response type interface, error throwing
  - `packages/bridge/src/wemo/soap.ts:95-106` — `buildSoapEnvelope` function (body is injected as-is between action tags)
  - `packages/bridge/src/wemo/soap.ts:135-226` — `soapRequest` function signature and return type

  **API/Type References**:
  - `packages/bridge/src/wemo/types.ts` — TimerRule, TimerSchedule, CreateTimerInput types (from Task 1)
  - `research/wemo-rules-protocol-research.md:78-117` — FetchRules/StoreRules SOAP request/response XML format
  - `research/wemo-oss-timer-comparison.md:104-153` — pywemo code example showing full rule creation flow
  - `research/wemo-oss-timer-comparison.md:155-168` — Key gotchas (RuleID assignment, date format, CDATA encoding, etc.)

  **Documentation References**:
  - `research/wemo-rules-protocol-research.md:214-231` — SQL example for creating a timer rule
  - `research/wemo-oss-timer-comparison.md:53-100` — Full SQLite schema

  **External References**:
  - fflate API: `zipSync()` and `unzipSync()` for ZIP handling
  - Bun SQLite: `https://bun.sh/docs/api/sqlite` — `Database`, `db.query()`, `db.serialize()`
  - pywemo rules_db.py: `https://github.com/pywemo/pywemo/blob/main/pywemo/ouimeaux_device/api/rules_db.py`

  **WHY Each Reference Matters**:
  - `insight.ts` pure functions — Follow the same export pattern (standalone functions, not methods on a class)
  - SOAP request format — Must construct exact XML for FetchRules and StoreRules
  - pywemo code example — Shows the full create-rule flow with all required fields
  - Key gotchas — Prevent silent failures (CDATA encoding, date format, version increment)

  **Acceptance Criteria**:
  - [ ] `rules.ts` exports: `fetchTimers`, `addTimer`, `updateTimer`, `deleteTimer`, `toggleTimer`, `secondsToTimeString`, `timeStringToSeconds`, `dayIdToLabel`, `dayIdToDayNames`, `createEmptyRulesDb`, `parseRulesFromDb`
  - [ ] All functions are typed with proper TypeScript signatures
  - [ ] CDATA encoding test: `storeRulesDb` body string contains `&lt;![CDATA[` (entity-encoded)
  - [ ] `bun run typecheck` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Module exports are correct
    Tool: Bash
    Preconditions: rules.ts created
    Steps:
      1. Run: bun -e "import * as r from './packages/bridge/src/wemo/rules.ts'; console.log(Object.keys(r).sort().join(','))"
      2. Assert: output contains fetchTimers,addTimer,updateTimer,deleteTimer,toggleTimer,secondsToTimeString,timeStringToSeconds,dayIdToLabel,dayIdToDayNames,createEmptyRulesDb,parseRulesFromDb
    Expected Result: All expected exports present
    Evidence: Command output captured

  Scenario: Typecheck passes
    Tool: Bash
    Preconditions: rules.ts created
    Steps:
      1. Run: bun run typecheck
      2. Assert: exit code 0
    Expected Result: Zero type errors
    Evidence: Command output captured
  ```

  **Commit**: YES
  - Message: `feat(rules): implement rules module with SOAP/ZIP/SQLite handling`
  - Files: `packages/bridge/src/wemo/rules.ts`
  - Pre-commit: `bun run typecheck`

---

- [x] 3. Rules Module Unit Tests

  **What to do**:
  - Create `packages/bridge/src/wemo/__tests__/rules.test.ts` following existing test patterns
  - Test all pure functions:
    1. **`secondsToTimeString`**: 0→"12:00 AM", 25200→"7:00 AM", 43200→"12:00 PM", 82800→"11:00 PM", 86400→"12:00 AM"
    2. **`timeStringToSeconds`**: reverse of above
    3. **`dayIdToLabel`**: -1→"Daily", 62→"Weekdays", 65→"Weekends", 127→"Daily", 2→"Mon", 6→"Mon, Tue"
    4. **`dayIdToDayNames`**: -1→["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], 62→["Mon","Tue","Wed","Thu","Fri"]
    5. **`createEmptyRulesDb`**: returns valid SQLite buffer, can be opened, has RULES/RULEDEVICES/TARGETDEVICES tables
    6. **`parseRulesFromDb`**: given a DB buffer with known rules → returns correct TimerRule[]
    7. **`addRuleToDb`**: creates rule with correct RuleID (max+1), correct RULEDEVICES defaults, correct TARGETDEVICES entry
    8. **`updateRuleInDb`**: modifies correct fields, preserves others
    9. **`deleteRuleFromDb`**: removes from all 3 tables
    10. **`toggleRuleInDb`**: changes State field between "1" and "0"
  - Test edge cases:
    1. Empty DB (no rules) → parseRulesFromDb returns empty array
    2. RuleID assignment on empty DB → gets ID 1
    3. Non-Timer rules (Type="Long Press") → parseRulesFromDb returns them with correct type
    4. Sync field "NOSYNC" round-trip through INTEGER column
    5. StartDate/EndDate placeholder values preserved
  - Test ZIP round-trip:
    1. Create DB → zip with `temppluginRules.db` filename → unzip → verify identical
    2. Verify ZIP contains exactly one file named `temppluginRules.db`

  **Must NOT do**:
  - Do not test SOAP network calls (those will be integration-level)
  - Do not test against real Wemo devices
  - Do not mock soapRequest — test pure DB functions only

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Writing tests for already-implemented pure functions — straightforward, follows existing test pattern exactly
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential after Task 2)
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `packages/bridge/src/wemo/__tests__/insight.test.ts:1-144` — Complete test file showing describe/test/expect pattern, pure function testing, edge case coverage
  - `packages/bridge/src/wemo/__tests__/soap.test.ts` — Another test pattern example

  **API/Type References**:
  - `packages/bridge/src/wemo/rules.ts` — Module under test (from Task 2)

  **External References**:
  - Bun test docs: `https://bun.sh/docs/cli/test`

  **WHY Each Reference Matters**:
  - `insight.test.ts` — Match the exact test structure (import pattern, describe grouping, assertion style)
  - `rules.ts` — The actual functions being tested

  **Acceptance Criteria**:
  - [ ] Test file created at `packages/bridge/src/wemo/__tests__/rules.test.ts`
  - [ ] All tests pass: `bun test packages/bridge/src/wemo/__tests__/rules.test.ts` → PASS
  - [ ] Minimum 15 test cases covering all pure functions
  - [ ] ZIP round-trip test: create → zip → unzip → verify
  - [ ] DayID encoding tests: -1, 62, 65, 127, individual days
  - [ ] Empty DB edge case tested

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: All rules tests pass
    Tool: Bash
    Preconditions: rules.ts and rules.test.ts created
    Steps:
      1. Run: bun test packages/bridge/src/wemo/__tests__/rules.test.ts
      2. Assert: exit code 0
      3. Assert: output shows 0 failures
      4. Assert: output shows >= 15 tests passed
    Expected Result: All tests pass with zero failures
    Evidence: Test output captured

  Scenario: Full test suite still passes
    Tool: Bash
    Preconditions: New tests added
    Steps:
      1. Run: bun test
      2. Assert: exit code 0
      3. Assert: all existing tests still pass (insight, soap, types)
    Expected Result: No regressions
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `test(rules): add unit tests for rules module`
  - Files: `packages/bridge/src/wemo/__tests__/rules.test.ts`
  - Pre-commit: `bun test`

---

- [x] 4. API Routes and Error Types

  **What to do**:
  - Add new error types to `packages/bridge/src/server/errors.ts`:
    - `RULES_NOT_SUPPORTED` error code in `ErrorCodes`
    - `RULES_FETCH_FAILED` error code
    - `RULES_STORE_FAILED` error code
    - `RULES_VERSION_CONFLICT` error code
    - `RulesNotSupportedError` class extending `ApiError` (status 400)
    - `RulesFetchError` class extending `ApiError` (status 502)
    - `RulesStoreError` class extending `ApiError` (status 502)
  - Create `packages/bridge/src/server/routes/timers.ts`:
    - `export const timerRoutes = new Hono()`
    - Helper: `requireDeviceWithRules(id)` — gets saved device, verifies it has `rules:1` service (check `device.services` or try the call)
    - **GET `/`** — Fetch all timer rules for a device (calls `fetchTimers`)
    - **POST `/`** — Create a new timer rule (validates body, calls `addTimer`)
    - **PATCH `/:ruleId`** — Update a timer rule (calls `updateTimer`)
    - **DELETE `/:ruleId`** — Delete a timer rule (calls `deleteTimer`)
    - **PATCH `/:ruleId/toggle`** — Enable/disable a timer rule (calls `toggleTimer`)
  - Register routes in `packages/bridge/src/server/index.ts`:
    - Import `timerRoutes` from `./routes/timers`
    - Mount: Since these are sub-routes of devices, mount as `app.route("/api/devices/:id/timers", timerRoutes)` — verify Hono's nested param routing works, or use middleware to extract `:id`
    - Update the API info endpoint to include new routes
  - Request validation:
    - POST: require `startTime` (number 0-86400), `startAction` (0, 1, or 2), `dayId` (number)
    - PATCH: all fields optional, validate ranges if provided
    - `ruleId` param: validate is numeric

  **Must NOT do**:
  - Do not add authentication or rate limiting middleware
  - Do not cache timer data
  - Do not add routes for non-timer rule types

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Route boilerplate follows existing pattern exactly, validation logic is straightforward
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential after Task 3)
  - **Blocks**: Task 5, Task 7
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `packages/bridge/src/server/routes/devices.ts:1-62` — Route helper pattern (requireDevice, getDeviceClient, getInsightClient)
  - `packages/bridge/src/server/routes/devices.ts:117-135` — GET list endpoint pattern
  - `packages/bridge/src/server/routes/devices.ts:167-248` — POST with validation pattern
  - `packages/bridge/src/server/routes/devices.ts:262-283` — PATCH update pattern
  - `packages/bridge/src/server/routes/devices.ts:290-300` — DELETE pattern
  - `packages/bridge/src/server/errors.ts:1-159` — Error class definitions (extend these)
  - `packages/bridge/src/server/index.ts:316-318` — Route mounting pattern

  **API/Type References**:
  - `docs/TIMER-FEATURE-SPEC.md:63-69` — API route table (Method, Path, Description)
  - `packages/bridge/src/wemo/rules.ts` — Functions to call (fetchTimers, addTimer, etc.)
  - `packages/bridge/src/wemo/types.ts` — TimerRule, CreateTimerInput, UpdateTimerInput

  **WHY Each Reference Matters**:
  - `devices.ts` routes — Copy this exact pattern for helper functions, error throwing, response format
  - `errors.ts` — Add new error types following the same class hierarchy
  - `index.ts` route mounting — Must match existing pattern for consistency
  - Feature spec route table — Defines the exact API contract

  **Acceptance Criteria**:
  - [ ] New error types in `errors.ts`: `RulesNotSupportedError`, `RulesFetchError`, `RulesStoreError`
  - [ ] Route file created: `packages/bridge/src/server/routes/timers.ts`
  - [ ] Routes registered in `index.ts`
  - [ ] `bun run typecheck` passes
  - [ ] `bun run lint` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Typecheck and lint pass
    Tool: Bash
    Preconditions: Routes and errors created
    Steps:
      1. Run: bun run typecheck
      2. Assert: exit code 0
      3. Run: bun run lint
      4. Assert: exit code 0
    Expected Result: No type or lint errors
    Evidence: Command output captured

  Scenario: Route module exports correctly
    Tool: Bash
    Preconditions: timers.ts created
    Steps:
      1. Run: bun -e "import { timerRoutes } from './packages/bridge/src/server/routes/timers.ts'; console.log(typeof timerRoutes.fetch)"
      2. Assert: output is "function"
    Expected Result: Hono app instance exported
    Evidence: Command output captured
  ```

  **Commit**: YES
  - Message: `feat(api): add timer CRUD API routes and error types`
  - Files: `packages/bridge/src/server/routes/timers.ts`, `packages/bridge/src/server/errors.ts`, `packages/bridge/src/server/index.ts`
  - Pre-commit: `bun run typecheck && bun run lint`

---

- [x] 5. Frontend API Client Methods

  **What to do**:
  - Add timer API methods to `packages/web/js/api.js`:
    ```javascript
    /**
     * Get all timer rules for a device.
     * @param {string} deviceId
     * @returns {Promise<{rules: Array, dbVersion: number}>}
     */
    async getTimers(deviceId) {
      return request(`/devices/${encodeURIComponent(deviceId)}/timers`);
    },

    /**
     * Create a new timer rule.
     * @param {string} deviceId
     * @param {Object} timer - Timer data
     * @returns {Promise<{rule: Object}>}
     */
    async createTimer(deviceId, timer) {
      return request(`/devices/${encodeURIComponent(deviceId)}/timers`, {
        method: 'POST',
        body: JSON.stringify(timer),
      });
    },

    /**
     * Update a timer rule.
     * @param {string} deviceId
     * @param {number} ruleId
     * @param {Object} updates
     * @returns {Promise<{rule: Object}>}
     */
    async updateTimer(deviceId, ruleId, updates) {
      return request(`/devices/${encodeURIComponent(deviceId)}/timers/${ruleId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },

    /**
     * Delete a timer rule.
     * @param {string} deviceId
     * @param {number} ruleId
     * @returns {Promise<{deleted: boolean}>}
     */
    async deleteTimer(deviceId, ruleId) {
      return request(`/devices/${encodeURIComponent(deviceId)}/timers/${ruleId}`, {
        method: 'DELETE',
      });
    },

    /**
     * Toggle a timer rule enabled/disabled.
     * @param {string} deviceId
     * @param {number} ruleId
     * @param {boolean} enabled
     * @returns {Promise<{rule: Object}>}
     */
    async toggleTimer(deviceId, ruleId, enabled) {
      return request(`/devices/${encodeURIComponent(deviceId)}/timers/${ruleId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
    },
    ```

  **Must NOT do**:
  - Do not change existing API methods
  - Do not add caching logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Trivial additions following exact existing pattern — 5 methods, each is 3-5 lines
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 6)
  - **Blocks**: Task 7
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `packages/web/js/api.js:79-214` — Existing API client methods (getDevices, toggle, getInsightData pattern)
  - `packages/web/js/api.js:32-74` — `request()` helper function

  **WHY Each Reference Matters**:
  - Exact method signature pattern, JSDoc format, `encodeURIComponent` usage

  **Acceptance Criteria**:
  - [ ] 5 new methods added to `api` object: `getTimers`, `createTimer`, `updateTimer`, `deleteTimer`, `toggleTimer`
  - [ ] Each method follows existing JSDoc pattern
  - [ ] `bun run lint` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: API client has new timer methods
    Tool: Bash
    Preconditions: api.js updated
    Steps:
      1. Run: grep -c "async.*Timer" packages/web/js/api.js
      2. Assert: output is 5 (five timer methods)
    Expected Result: All 5 methods present
    Evidence: Command output captured
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `feat(web): add timer API client methods and CSS`
  - Files: `packages/web/js/api.js`, `packages/web/css/style.css`
  - Pre-commit: `bun run lint`

---

- [x] 6. Timer Panel CSS

  **What to do**:
  - Add timer panel styles to `packages/web/css/style.css`:
    - **Timer icon button** — `.timer-btn` on device card, positioned between device-info and toggle
    - **Timer panel** — `.timer-panel` accordion section below device card main content, with slide-down animation
    - **Timer list** — `.timer-list` with `.timer-item` cards showing time, days, action, toggle, edit/delete buttons
    - **Timer empty state** — `.timer-empty` centered message
    - **Timer loading state** — `.timer-loading` spinner with message
    - **Timer saving state** — `.timer-saving` overlay spinner
    - **Timer form modal** — reuse existing `.modal` classes, add:
      - `.timer-form` container
      - `.time-input-group` — styled `<input type="time">` 
      - `.action-selector` — segmented control for ON/OFF/Toggle
      - `.day-picker` — 7 toggleable day buttons (M T W T F S S) + quick selects
      - `.day-btn` — individual day button (active/inactive states)
      - `.day-quick-select` — "Daily", "Weekdays", "Weekends" buttons
      - `.end-time-toggle` — optional "and then..." second action section
    - **Timer delete confirmation** — small inline confirm/cancel
    - Support dark and light themes using existing CSS variables
    - Mobile-first responsive (touch targets ≥ 44px)
    - Use existing design tokens: `--color-*`, `--spacing-*`, `--radius-*`, `--transition-*`

  **Must NOT do**:
  - Do not modify existing CSS rules
  - Do not use hardcoded colors — always use CSS variables
  - Do not add external CSS files or imports

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: CSS-heavy task requiring attention to dark/light themes, responsive design, animations, and touch targets
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for polished UI styling that matches existing design language

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 7
  - **Blocked By**: None (CSS can be written independently)

  **References**:

  **Pattern References**:
  - `packages/web/css/style.css:9-76` — CSS variables / design tokens
  - `packages/web/css/style.css:220-297` — Device card styles (`.device-card`, `.device-card-main`, `.device-icon`, `.device-info`)
  - `packages/web/css/style.css:487-511` — Power stats section within device card (border-top separator, grid layout)
  - `packages/web/css/style.css:516-590` — Modal styles (`.modal`, `.modal-backdrop`, `.modal-content`, `.modal-header`, `.modal-body`, `.modal-footer`)
  - `packages/web/css/style.css:300-350` — Toggle switch styles (`.toggle`, `.toggle-track`)
  - `packages/web/css/style.css:780-815` — Settings option styles (radio-button-like selections)

  **Documentation References**:
  - `docs/TIMER-FEATURE-SPEC.md:86-119` — UI spec for timer panel, form, day picker

  **WHY Each Reference Matters**:
  - CSS variables — Must use these, not hardcoded values
  - Device card styles — Timer panel integrates as a child section of the card
  - Power stats — Shows the pattern for "additional section below card main content"
  - Modal styles — Timer add/edit form uses modal pattern
  - Toggle switch — Timer enable/disable uses same toggle
  - Settings options — Day picker buttons follow similar visual pattern

  **Acceptance Criteria**:
  - [ ] Timer panel CSS added to `style.css`
  - [ ] All colors use CSS custom properties (no hardcoded hex values)
  - [ ] Light theme overrides added for `.timer-*` classes
  - [ ] Touch targets ≥ 44px for all interactive elements
  - [ ] `bun run lint` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: No hardcoded colors in timer CSS
    Tool: Bash
    Preconditions: CSS added
    Steps:
      1. Extract timer-related CSS rules from style.css
      2. Search for hardcoded color values (#xxx, rgb, rgba) in timer rules
      3. Assert: all colors use var(--color-*) except rgba for transparency variants
    Expected Result: No hardcoded colors
    Evidence: Grep output captured
  ```

  **Commit**: YES (groups with Task 5)
  - Message: `feat(web): add timer API client methods and CSS`
  - Files: `packages/web/js/api.js`, `packages/web/css/style.css`
  - Pre-commit: `bun run lint`

---

- [ ] 7. Timer Panel JavaScript Module

  **What to do**:
  - Create `packages/web/js/timer-panel.js` as an ES module:
    - Import `api` from `./api.js`
    - Export functions used by `app.js`:
      1. **`renderTimerButton(deviceId)`** — returns HTML string for clock icon button
      2. **`openTimerPanel(deviceId, cardElement)`** — fetches timers, renders panel below card
      3. **`closeTimerPanel(deviceId)`** — collapses/removes panel
      4. **`toggleTimerPanel(deviceId, cardElement)`** — open if closed, close if open
    - Internal functions:
      1. **`renderTimerPanel(deviceId, timers, dbVersion)`** — HTML for timer list with edit/delete/toggle per timer
      2. **`renderTimerItem(timer)`** — single timer row: time display, day label, action, toggle, edit, delete
      3. **`renderTimerForm(deviceId, existingTimer?)`** — modal form for add/edit
      4. **`renderTimerEmpty()`** — empty state message
      5. **`renderTimerLoading()`** — loading spinner
      6. **`formatTimerDisplay(timer)`** — "7:00 AM → ON" or "7:00 AM ON — 11:00 PM OFF"
      7. **`formatDayDisplay(dayId)`** — "Daily" / "Weekdays" / "Weekends" / "Mon, Wed, Fri"
    - Event handling:
      1. Timer toggle (enable/disable) — calls `api.toggleTimer()`, shows saving spinner
      2. Add timer button — opens form modal
      3. Edit button — opens form modal pre-filled with existing timer data
      4. Delete button — shows inline confirmation, then calls `api.deleteTimer()`
      5. Form save — validates, calls `api.createTimer()` or `api.updateTimer()`, refreshes list
      6. Form cancel — closes modal
    - Day picker logic:
      1. Individual day buttons toggle on/off (using bitmask)
      2. Quick select "Daily" sets all, "Weekdays" sets Mon-Fri, "Weekends" sets Sat-Sun
      3. Visual state syncs: selecting all days individually should highlight "Daily" quick-select
    - State management:
      1. Track which device's panel is currently open
      2. Only one panel open at a time (opening another closes current)
    - Loading/saving states:
      1. "Loading timers..." spinner when fetching
      2. "Saving to device..." spinner when creating/updating/deleting
      3. Disable all buttons during save operation
    - Haptic feedback:
      1. Vibrate on timer toggle
      2. Vibrate pattern on save success
    - Accessibility:
      1. `aria-expanded` on timer button
      2. `aria-live="polite"` on timer panel for screen reader announcements
      3. Focus trapping in timer form modal
      4. Escape key closes form modal
    - Toast notifications:
      1. Success: "Timer created", "Timer updated", "Timer deleted"
      2. Error: "Failed to load timers", "Failed to save timer", with device-specific messages

  **Must NOT do**:
  - Do not introduce any framework (React, Vue, etc.)
  - Do not cache timers client-side
  - Do not allow editing non-Timer type rules (show them read-only if they exist)
  - Do not add sunrise/sunset/countdown UI
  - Do not inline all this code in app.js — keep it in the separate module

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex interactive UI with form validation, state management, animations, accessibility, and mobile touch optimization
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed for polished interaction design, accessibility, and UX patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Wave 2)
  - **Blocks**: Task 8
  - **Blocked By**: Task 5, Task 6

  **References**:

  **Pattern References**:
  - `packages/web/js/app.js:545-607` — `renderDeviceCard()` — shows HTML template literal pattern
  - `packages/web/js/app.js:850-879` — `attachDeviceListeners()` — event delegation pattern
  - `packages/web/js/app.js:884-930` — `handleToggle()` — async operation with haptic feedback, error handling, UI revert
  - `packages/web/js/app.js:466-484` — `showToast()` function usage
  - `packages/web/js/app.js:967-982` — Modal open/close pattern (openDiscoveryModal, closeDiscoveryModal)
  - `packages/web/js/app.js:1612-1637` — `trapFocus()` for modal accessibility
  - `packages/web/js/app.js:1671-1680` — `announceToScreenReader()` function

  **API/Type References**:
  - `packages/web/js/api.js` — Timer API methods (from Task 5)

  **Documentation References**:
  - `docs/TIMER-FEATURE-SPEC.md:86-119` — UI spec for timer panel, form, design constraints

  **WHY Each Reference Matters**:
  - `renderDeviceCard` — Match the template literal + data attribute pattern for rendering
  - `handleToggle` — Copy the async-with-haptic-and-revert pattern for timer operations
  - `showToast` — Used for success/error notifications
  - `trapFocus` — Must use for form modal accessibility
  - Feature spec UI section — Defines exact component requirements

  **Acceptance Criteria**:
  - [ ] `timer-panel.js` created with all exported functions
  - [ ] Timer list displays with correct time format and day labels
  - [ ] Add timer form has: time picker, action selector (ON/OFF/Toggle), day picker with quick selects
  - [ ] Edit timer form pre-fills with existing values
  - [ ] Delete shows confirmation before removing
  - [ ] Toggle enable/disable works
  - [ ] Loading and saving spinners display
  - [ ] `bun run lint` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Timer panel module loads without errors
    Tool: Bash
    Preconditions: timer-panel.js created
    Steps:
      1. Run: bun run lint
      2. Assert: exit code 0
      3. Verify file exists: ls packages/web/js/timer-panel.js
      4. Assert: file exists
    Expected Result: Module is syntactically valid
    Evidence: Command output captured
  ```

  **Commit**: YES
  - Message: `feat(web): add timer panel JavaScript module`
  - Files: `packages/web/js/timer-panel.js`
  - Pre-commit: `bun run lint`

---

- [ ] 8. Device Card Integration and HTML

  **What to do**:
  - Modify `packages/web/js/app.js`:
    1. Import timer-panel module: `import { renderTimerButton, toggleTimerPanel } from "./timer-panel.js"`
    2. Add `showToast` and `announceToScreenReader` exports from app.js (or pass them to timer-panel as callbacks during init)
    3. Update `renderDeviceCard()` to include timer icon button between device-info and toggle:
       ```javascript
       // After device-info div, before toggle label:
       <button class="btn btn-icon timer-btn" data-action="timer" aria-label="Timers" aria-expanded="false">
         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <circle cx="12" cy="12" r="10"/>
           <polyline points="12 6 12 12 16 14"/>
         </svg>
       </button>
       ```
    4. Update `attachDeviceListeners()` to handle timer button clicks:
       ```javascript
       for (const timerBtn of $app.querySelectorAll('[data-action="timer"]')) {
         timerBtn.addEventListener('click', handleTimerToggle);
       }
       ```
    5. Add `handleTimerToggle(event)`:
       ```javascript
       function handleTimerToggle(event) {
         const card = event.target.closest('[data-device-id]');
         const deviceId = card.dataset.deviceId;
         toggleTimerPanel(deviceId, card);
       }
       ```
    6. Update `setupEscapeKeyHandler()` to handle timer form modal close
  - Add timer form modal HTML to `packages/web/index.html`:
    - Add a `<div id="timer-form-modal" class="modal hidden">` with form structure
    - Include: time inputs, action selector, day picker buttons, save/cancel buttons
    - Follow existing modal HTML patterns from the file (discovery-modal, settings-modal)
  - Add `<script type="module" src="js/timer-panel.js"></script>` to `index.html` (or rely on the import in app.js)

  **Must NOT do**:
  - Do not refactor existing app.js code unrelated to timer integration
  - Do not change existing device card rendering for non-timer functionality
  - Do not add timers to offline device cards (disable timer button when offline)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Requires careful HTML/JS integration with existing UI, maintaining accessibility and responsive behavior
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 7)
  - **Blocks**: Task 9
  - **Blocked By**: Task 7

  **References**:

  **Pattern References**:
  - `packages/web/js/app.js:545-607` — `renderDeviceCard()` function to modify
  - `packages/web/js/app.js:850-879` — `attachDeviceListeners()` to extend
  - `packages/web/js/app.js:1-10` — Import pattern (ES modules)
  - `packages/web/js/app.js:1642-1666` — `setupEscapeKeyHandler()` to extend
  - `packages/web/index.html:56-62` — Main content area
  - `packages/web/index.html:68-80` — Modal HTML pattern

  **WHY Each Reference Matters**:
  - `renderDeviceCard` — Exact insertion point for timer button
  - `attachDeviceListeners` — Where to register timer button click handlers
  - `index.html` modals — Pattern for the timer form modal HTML structure

  **Acceptance Criteria**:
  - [ ] Timer icon button visible on every device card
  - [ ] Timer icon disabled on offline devices
  - [ ] Clicking timer icon opens/closes timer panel
  - [ ] Timer form modal HTML in index.html
  - [ ] `bun run lint` passes
  - [ ] `bun run typecheck` passes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Timer button renders on device cards
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running on localhost:51515, at least one device saved
    Steps:
      1. Navigate to: http://localhost:51515
      2. Wait for: .device-card visible (timeout: 10s)
      3. Assert: .timer-btn exists within .device-card
      4. Assert: .timer-btn has aria-label="Timers"
      5. Screenshot: .sisyphus/evidence/task-8-timer-button.png
    Expected Result: Clock icon button visible on device cards
    Evidence: .sisyphus/evidence/task-8-timer-button.png

  Scenario: Timer panel toggles on click
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running, device card visible
    Steps:
      1. Navigate to: http://localhost:51515
      2. Wait for: .device-card visible
      3. Click: .timer-btn (first device)
      4. Wait for: .timer-panel visible (timeout: 10s)
      5. Assert: .timer-panel exists below .device-card-main
      6. Click: .timer-btn (same device)
      7. Assert: .timer-panel is hidden/removed
      8. Screenshot: .sisyphus/evidence/task-8-timer-panel-toggle.png
    Expected Result: Panel opens and closes on button click
    Evidence: .sisyphus/evidence/task-8-timer-panel-toggle.png
  ```

  **Commit**: YES
  - Message: `feat(web): integrate timer panel into device cards`
  - Files: `packages/web/js/app.js`, `packages/web/index.html`
  - Pre-commit: `bun run lint`

---

- [ ] 9. Final QA — Lint, Typecheck, Tests, Integration Verification

  **What to do**:
  - Run full quality checks:
    1. `bun run typecheck` — all TypeScript compiles cleanly
    2. `bun run lint` — no lint errors
    3. `bun run test` — all tests pass (existing + new)
  - Fix any issues found
  - Verify the full feature works end-to-end (as much as possible without a real device):
    1. Verify dev server starts: `bun run dev`
    2. Verify API routes are registered: `curl http://localhost:51515/api` — check timer routes in endpoint list
    3. Verify frontend loads: navigate to localhost:51515, confirm no JS errors in console
    4. Verify timer button renders on device cards
    5. Verify dark/light theme toggle doesn't break timer panel styles
  - Check for any `console.error` or unhandled promise rejections in browser console
  - Verify no regressions in existing functionality (device toggle, discovery, settings)

  **Must NOT do**:
  - Do not add new features
  - Do not refactor code unrelated to the timer feature
  - Do not push to remote

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Verification task — running commands and checking output
  - **Skills**: [`playwright`]
    - `playwright`: Needed for browser-based verification

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Final (after all other tasks)
  - **Blocks**: None (final task)
  - **Blocked By**: All previous tasks

  **References**:
  - All files from previous tasks

  **Acceptance Criteria**:
  - [ ] `bun run typecheck` → exit code 0
  - [ ] `bun run lint` → exit code 0
  - [ ] `bun run test` → all tests pass, 0 failures
  - [ ] Dev server starts without errors
  - [ ] Timer routes appear in `/api` endpoint list
  - [ ] No JavaScript errors in browser console on page load

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Full quality check passes
    Tool: Bash
    Preconditions: All tasks complete
    Steps:
      1. Run: bun run typecheck
      2. Assert: exit code 0
      3. Run: bun run lint
      4. Assert: exit code 0
      5. Run: bun run test
      6. Assert: exit code 0, all tests pass
    Expected Result: Zero errors across all checks
    Evidence: Command output captured

  Scenario: Dev server starts and serves timer routes
    Tool: Bash
    Preconditions: All code changes complete
    Steps:
      1. Start dev server: bun run dev (background)
      2. Wait 3 seconds for startup
      3. curl -s http://localhost:51515/api | jq '.endpoints'
      4. Assert: output includes timer route paths
      5. curl -s http://localhost:51515/api/health | jq '.status'
      6. Assert: "ok"
      7. Stop dev server
    Expected Result: Server runs, timer routes registered
    Evidence: API response captured

  Scenario: Frontend loads without errors
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running
    Steps:
      1. Navigate to: http://localhost:51515
      2. Wait for: #app visible (timeout: 10s)
      3. Check browser console for errors
      4. Assert: no uncaught errors or unhandled rejections
      5. Assert: .app-header visible
      6. Screenshot: .sisyphus/evidence/task-9-app-loaded.png
    Expected Result: App loads cleanly
    Evidence: .sisyphus/evidence/task-9-app-loaded.png

  Scenario: Dark/light theme works with timer styles
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running
    Steps:
      1. Navigate to: http://localhost:51515
      2. Screenshot dark theme: .sisyphus/evidence/task-9-dark-theme.png
      3. Execute: document.documentElement.setAttribute('data-theme', 'light')
      4. Wait: 500ms for transition
      5. Screenshot light theme: .sisyphus/evidence/task-9-light-theme.png
      6. Assert: no visual artifacts, all elements visible in both themes
    Expected Result: Both themes render correctly
    Evidence: .sisyphus/evidence/task-9-dark-theme.png, .sisyphus/evidence/task-9-light-theme.png

  Scenario: Existing functionality not broken
    Tool: Playwright (playwright skill)
    Preconditions: Dev server running
    Steps:
      1. Navigate to: http://localhost:51515
      2. Click: #settings-btn
      3. Assert: .settings-modal is visible
      4. Click: .modal-close
      5. Assert: .settings-modal is hidden
      6. Click: #add-device-btn
      7. Assert: #discovery-modal is visible
    Expected Result: Settings and discovery still work
    Evidence: Screenshots captured
  ```

  **Commit**: NO (verification only — no changes expected)

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(rules): add timer types and fflate dependency` | types.ts, package.json | typecheck |
| 2 | `feat(rules): implement rules module with SOAP/ZIP/SQLite handling` | rules.ts | typecheck |
| 3 | `test(rules): add unit tests for rules module` | rules.test.ts | bun test |
| 4 | `feat(api): add timer CRUD API routes and error types` | timers.ts, errors.ts, index.ts | typecheck + lint |
| 5+6 | `feat(web): add timer API client methods and CSS` | api.js, style.css | lint |
| 7 | `feat(web): add timer panel JavaScript module` | timer-panel.js | lint |
| 8 | `feat(web): integrate timer panel into device cards` | app.js, index.html | lint |
| 9 | (no commit — verification only) | — | all checks pass |

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck  # Expected: exit code 0
bun run lint       # Expected: exit code 0
bun run test       # Expected: all tests pass, 0 failures
```

### Final Checklist
- [ ] All "Must Have" features present and functional
- [ ] All "Must NOT Have" guardrails respected (no soap.ts changes, no sunrise/sunset, etc.)
- [ ] All 4+ new test scenarios pass
- [ ] Timer CRUD API routes respond correctly
- [ ] Timer panel renders in both dark and light themes
- [ ] Timer panel is mobile-friendly (touch targets, responsive)
- [ ] Timer panel is accessible (aria attributes, focus trapping, screen reader)
- [ ] No regressions in existing device toggle, discovery, settings, power stats
- [ ] All work on `feature/timer-schedules` branch (no new branches created)
