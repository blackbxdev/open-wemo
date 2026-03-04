# Bridge-Side Timer Scheduler

## TL;DR

> **Quick Summary**: WeMo Insight firmware timer scheduling is confirmed dead after 7+ test iterations. Move timer execution to the bridge process: a 30s interval loop that evaluates timer rules against local time and fires SetBinaryState SOAP calls when a rule's time arrives. Also remove all dead weekly calendar code and diagnostic blocks.
>
> **Deliverables**:
> - `packages/bridge/src/wemo/scheduler.ts` — new bridge-side timer scheduler
> - `packages/bridge/src/wemo/__tests__/scheduler.test.ts` — TDD test suite
> - Dead code removed from `rules.ts` (6 symbols, 4 call sites)
> - Diagnostic block removed from `timers.ts`
> - Scheduler integrated into server startup, shutdown, timer routes, and device routes
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 (tests) → Task 4 (implement) → Task 5 (route integration) + Task 6 (startup integration) → Task 7 (verification)

---

## Context

### Original Request
The WeMo Insight firmware (WeMo_WW_2.00.11532.PVT-OWRT-Insight) has a non-functional timer scheduler. GetRules, GetRuleOverrideStatus, EditWeeklycalendar, and GetTime all SOAP fault. StoreRules and UpdateWeeklyCalendar return 200 but are no-ops for scheduling. After 7+ test iterations with every known format/protocol variant, on-device timers are confirmed dead. Move timer execution to the bridge process.

### Interview Summary
**Key Discussions**:
- User provided exhaustive spec covering architecture, scheduler design, all edge cases, integration points, and exact files to touch
- Test strategy: TDD (Red-Green-Refactor) confirmed by user
- All weekly calendar code confirmed dead — safe to remove
- Diagnostic block in POST timer route confirmed dead — safe to remove

**Research Findings**:
- **Startup file**: `main.ts` (not `server/index.ts`) orchestrates: DB init (line 84) → startServer (line 101) → system tray (line 111) → runBackgroundDiscovery (line 120)
- **Shutdown function**: `main.ts` lines 249-288, 3 steps: stop server → destroy tray → close database. No interval cleanup exists — scheduler stop must be added.
- **CRUD return values**: addTimer/updateTimer/toggleTimer return single `TimerRule`, deleteTimer returns `void` — NOT the full list. Routes must call `loadDeviceRules()` to refresh scheduler cache.
- **SetBinaryState pattern**: `soapRequest(host, port, "/upnp/control/basicevent1", "urn:Belkin:service:basicevent:1", "SetBinaryState", "<BinaryState>0|1</BinaryState>")`
- **DAYS bitmask constants**: Already exported from `types.ts` lines 274-286 (SUN=1, MON=2, TUE=4, WED=8, THU=16, FRI=32, SAT=64, DAILY=-1, ALL=127)
- **Device DELETE route**: `devices.ts` lines 290-300. Needs `clearDeviceRules()` call.
- **Test framework**: bun:test, 5 existing test files, tests in `__tests__/*.test.ts`

### Metis Review
**Identified Gaps** (addressed):
- **TimerAction.Toggle handling**: Toggle=2 exists in type system but SetBinaryState only accepts 0|1. Resolved: map Toggle→On (1), matching firmware precedent in dead `buildDayTimerString` line 709.
- **Interval drift risk**: Fixed 30s window check could miss rules on GC pauses. Resolved: use `lastCheckedAt`-based window (`lastCheckedAt < ruleTime <= nowSeconds`) instead.
- **Shutdown cleanup**: `shutdown()` in main.ts has no interval cleanup. Resolved: `startScheduler()` returns `{ stop }`, shutdown calls `stop()`.
- **Device deletion**: Cached rules for deleted devices would fire to stale hosts. Resolved: add `clearDeviceRules(deviceId)` export, call from device DELETE route.
- **endTime/endAction**: Rules can have both start and end events. Resolved: `evaluateRules` produces 1-2 fire events per rule.
- **Stale device IPs**: Cached host:port can go stale after DHCP changes. Resolved: re-read SavedDevice from DB each tick.
- **Pure function design**: `evaluateRules()` separated as pure function (no I/O) for deterministic testing. 90%+ of tests need no mocks.

---

## Work Objectives

### Core Objective
Build a bridge-side timer scheduler that evaluates timer rules against local time every ~30 seconds and fires SetBinaryState SOAP calls when a rule's time arrives, compensating for the WeMo Insight firmware's broken timer infrastructure.

### Concrete Deliverables
- `packages/bridge/src/wemo/scheduler.ts` — scheduler with `startScheduler()`, `loadDeviceRules()`, `clearDeviceRules()` exports
- `packages/bridge/src/wemo/__tests__/scheduler.test.ts` — TDD test suite covering all rule evaluation logic
- Cleaned `rules.ts` — 6 dead symbols and 4 call sites removed (~150 lines)
- Cleaned `timers.ts` — diagnostic block removed (~55 lines), unused imports removed
- `timers.ts` routes call `loadDeviceRules()` after mutations
- `devices.ts` DELETE route calls `clearDeviceRules()`
- `main.ts` starts scheduler after discovery, stops scheduler on shutdown

### Definition of Done
- [ ] `bun test` passes with 0 failures (existing 80+ tests + new scheduler tests)
- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` exits 0
- [ ] Zero references to removed dead code symbols remain in codebase
- [ ] Scheduler starts on server startup, stops on shutdown

### Must Have
- Pure `evaluateRules()` function — deterministic, no I/O, testable without mocks
- `lastCheckedAt`-based window evaluation (not fixed "within 30s")
- Both `startTime` and `endTime` events evaluated per rule
- `TimerAction.Toggle` mapped to `1` (On) for SetBinaryState
- Day matching: DAILY (-1), ALL (127), bitmask check `(dayId & dayBit) !== 0`
- Only fires rules where `rule.enabled === true`
- "Fired today" dedup tracker cleared on midnight rollover
- Async/fire-and-forget rule loading on startup (skip offline devices)
- Re-read SavedDevice from DB each tick (handles IP changes)
- Console logging with `[Scheduler]` prefix

### Must NOT Have (Guardrails)
- No persistence of scheduler state (fired-today set is ephemeral)
- No retry queue or complex failure handling — fire once per window, log failures
- No new API endpoints for the scheduler
- No web UI changes
- No changes to timer CRUD logic or DB schema
- No WemoDeviceClient usage in scheduler — use raw `soapRequest()` directly
- No proactive TimeSync (Option B) — separate future feature
- No premature abstraction — no "SchedulerPlugin" or "TimerEngine" class hierarchies
- Do NOT remove `DAY_NAMES`, `DAY_BITS`, `toTimerAction`, `secondsToTimeString`, `timeStringToSeconds`, `dayIdToDayNames`, `dayIdToLabel` from rules.ts — these are NOT dead code
- Do NOT touch `fetchTimers`, `fetchRulesDb`, `storeRulesDb`, `parseRulesFromDb`, or any DB mutation functions

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.
> Every criterion is verified by running a command or using a tool.

### Test Decision
- **Infrastructure exists**: YES (bun:test, 5 test files)
- **Automated tests**: TDD (Red-Green-Refactor)
- **Framework**: bun:test (Bun's built-in test runner)
- **Test command**: `bun test`

### TDD Structure

The scheduler is designed for testability via separation of concerns:

1. **Pure function** `evaluateRules(rules, nowSeconds, lastCheckedSeconds, currentDayBit)` → `FireEvent[]`
   - Deterministic, no I/O, trivially testable with concrete inputs/outputs
   - 90%+ of test cases target this function

2. **Side-effectful** `fireEvent(host, port, action)` → wraps soapRequest, mockable

3. **Orchestration** `tick()` → calls evaluateRules, then fireEvent per result

Each TODO follows RED-GREEN-REFACTOR:
1. **RED**: Write failing tests first → `bun test` FAILS (tests exist, no implementation)
2. **GREEN**: Implement minimum code → `bun test` PASSES
3. **REFACTOR**: Clean up while keeping green → `bun test` still PASSES

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

Every task includes Agent-Executed QA Scenarios as verification. The executing agent directly runs commands and validates results. No human intervention at any step.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — all independent):
├── Task 1: Write scheduler TDD tests (RED phase)
├── Task 2: Remove dead weekly calendar code from rules.ts
└── Task 3: Remove diagnostic block from timers.ts

Wave 2 (After Task 1):
└── Task 4: Implement scheduler.ts (GREEN + REFACTOR)

Wave 3 (After Tasks 2, 3, 4 — parallel):
├── Task 5: Integrate scheduler into timer routes + device routes
└── Task 6: Integrate scheduler into main.ts startup/shutdown

Wave 4 (After all):
└── Task 7: Final verification and regression testing
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 4 | 2, 3 |
| 2 | None | 5 | 1, 3 |
| 3 | None | 5 | 1, 2 |
| 4 | 1 | 5, 6 | None |
| 5 | 2, 3, 4 | 7 | 6 |
| 6 | 4 | 7 | 5 |
| 7 | 5, 6 | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 2, 3 | 3 parallel agents: Task 1 = unspecified-high (TDD test design), Tasks 2+3 = quick (dead code removal) |
| 2 | 4 | 1 agent: unspecified-high (core implementation) |
| 3 | 5, 6 | 2 parallel agents: both quick (integration wiring) |
| 4 | 7 | 1 agent: quick (verification) |

---

## TODOs

- [x] 1. Write scheduler TDD tests (RED phase)

  **What to do**:
  - Create `packages/bridge/src/wemo/__tests__/scheduler.test.ts`
  - Write comprehensive tests for the pure `evaluateRules()` function covering all rule evaluation logic
  - Write tests for scheduler lifecycle (start/stop) and cache management (loadDeviceRules/clearDeviceRules)
  - Write tests for the `tick()` orchestration with mocked soapRequest
  - All tests should FAIL at this point (RED phase) — no implementation exists yet

  **Test Cases to Write**:

  `evaluateRules` (pure function — no mocks needed):
  1. Returns fire event when `lastCheckedSeconds < rule.startTime <= nowSeconds`
  2. Returns empty array when rule time is outside the checked window
  3. Returns empty array when `nowSeconds < rule.startTime` (future rule)
  4. Returns empty array when `lastCheckedSeconds >= rule.startTime` (already past)
  5. Matches daily rules (`dayId === -1`) on any day
  6. Matches ALL rules (`dayId === 127`) on any day
  7. Matches bitmask rules on correct day (e.g., `dayId = MON|WED|FRI = 42`, currentDayBit = 4 = TUE → no match)
  8. Matches bitmask rules on correct day (e.g., `dayId = MON|WED|FRI = 42`, currentDayBit = 2 = MON → match)
  9. Skips disabled rules (`enabled === false`)
  10. Maps `TimerAction.Toggle` (2) to action `1` (On) in the fire event
  11. Maps `TimerAction.On` (1) to action `1`
  12. Maps `TimerAction.Off` (0) to action `0`
  13. Evaluates `endTime`/`endAction` when present — returns second fire event
  14. Does NOT evaluate `endTime` when `endAction` is undefined
  15. Returns multiple fire events when multiple rules match
  16. Returns empty array for empty rules list
  17. Handles midnight rollover: when `nowSeconds < lastCheckedSeconds` (clock wrapped past midnight), correctly evaluates rules in the `[lastCheckedSeconds..86400)` and `[0..nowSeconds]` ranges
  18. Populates fire event with correct `ruleId`, `ruleName`, `deviceId` for logging

  `tick()` orchestration (mock soapRequest):
  19. Calls `soapRequest` with correct SetBinaryState payload for each fire event
  20. Logs `[Scheduler] Firing rule "name" (ON/OFF) on device X` for each fire
  21. Catches and logs SOAP failures without throwing (scheduler continues)
  22. Reads current device host:port from DB via `getDatabase().getDeviceById()` on each tick (not cached)
  23. Does not re-fire a rule+day+action that already fired (dedup via fired-today set)
  24. Clears fired-today set when day-of-year changes

  Lifecycle:
  25. `startScheduler()` returns object with `stop()` function
  26. `stop()` clears the interval (no more ticks)
  27. `loadDeviceRules(deviceId, host, port)` fetches via `fetchTimers()` and caches rules
  28. `clearDeviceRules(deviceId)` removes device entry from cache

  **Must NOT do**:
  - Do NOT implement scheduler.ts — this is RED phase only
  - Do NOT create stub/skeleton implementation files
  - Do NOT add any imports to existing files

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: TDD test design requires understanding the full scheduler spec to write correct, comprehensive test cases before any implementation exists
  - **Skills**: `[]`
    - No special skills needed — pure TypeScript test file creation
  - **Skills Evaluated but Omitted**:
    - `playwright`: No browser testing needed (backend scheduler)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (scheduler implementation)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (test structure to follow):
  - `packages/bridge/src/wemo/__tests__/rules.test.ts` — Test file structure: `describe/test` blocks, `bun:test` imports (`describe`, `expect`, `test`, `mock`, `beforeEach`, `afterEach`). Follow the same organizational pattern with nested `describe` blocks.
  - `packages/bridge/src/wemo/__tests__/soap.test.ts` — Example of mocking patterns used in this codebase for SOAP-related tests.

  **Type References** (types the tests will import):
  - `packages/bridge/src/wemo/types.ts:222-235` — `TimerRule` interface: `ruleID`, `name`, `type`, `enabled`, `startTime`, `endTime?`, `startAction`, `endAction?`, `dayId`
  - `packages/bridge/src/wemo/types.ts:237-238` — `TimerAction` enum: `Off=0`, `On=1`, `Toggle=2`
  - `packages/bridge/src/wemo/types.ts:274-286` — `DAYS` constant: `DAILY=-1`, `SUN=1`, `MON=2`, `TUE=4`, `WED=8`, `THU=16`, `FRI=32`, `SAT=64`, `ALL=127`

  **API References** (what the scheduler will export — tests import these):
  - The test file will import from `../scheduler` (which doesn't exist yet, causing RED failures). Expected exports:
    - `evaluateRules(rules: TimerRule[], nowSeconds: number, lastCheckedSeconds: number, currentDayBit: number): FireEvent[]`
    - `startScheduler(): { stop: () => void }`
    - `loadDeviceRules(deviceId: string, host: string, port: number): Promise<void>`
    - `clearDeviceRules(deviceId: string): void`
  - `FireEvent` type (defined in scheduler.ts): `{ deviceId: string, ruleId: number, ruleName: string, action: 0 | 1 }`

  **Design References** (scheduler logic specification):
  - Time window matching: `lastCheckedAt < ruleTime <= nowSeconds` (not fixed "within 30s")
  - Day matching pattern from `rules.ts:700-703`: `rule.dayId === DAYS.DAILY || rule.dayId === DAYS.ALL || (rule.dayId & dayBit) !== 0`
  - Toggle mapping from dead code `rules.ts:709`: `rule.startAction === TimerAction.Off ? 0 : 1` (Toggle maps to On)
  - SetBinaryState SOAP pattern from `device.ts:178`: body is `<BinaryState>${0|1}</BinaryState>`, controlURL `/upnp/control/basicevent1`, service `urn:Belkin:service:basicevent:1`

  **Acceptance Criteria**:

  **TDD RED Phase:**
  - [ ] Test file created: `packages/bridge/src/wemo/__tests__/scheduler.test.ts`
  - [ ] File contains 25+ test cases organized in `describe` blocks
  - [ ] Tests import from `../scheduler` (which does not exist)
  - [ ] `bun test packages/bridge/src/wemo/__tests__/scheduler.test.ts` → FAILS (module not found or all tests fail)
  - [ ] Existing tests unaffected: `bun test packages/bridge/src/wemo/__tests__/rules.test.ts` → PASS

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Scheduler test file exists and has correct structure
    Tool: Bash
    Preconditions: None
    Steps:
      1. ls -la packages/bridge/src/wemo/__tests__/scheduler.test.ts
      2. Assert: file exists (exit code 0)
      3. grep -c "describe\|test\|it(" packages/bridge/src/wemo/__tests__/scheduler.test.ts
      4. Assert: count >= 25 (at least 25 test definitions)
    Expected Result: File exists with 25+ test cases
    Evidence: Command output captured

  Scenario: Scheduler tests fail because implementation doesn't exist (RED)
    Tool: Bash
    Preconditions: scheduler.ts does NOT exist
    Steps:
      1. bun test packages/bridge/src/wemo/__tests__/scheduler.test.ts 2>&1
      2. Assert: exit code is non-zero (tests fail)
      3. Assert: output contains "Cannot find module" or test failures
    Expected Result: All tests fail — RED phase confirmed
    Evidence: Test output captured

  Scenario: Existing tests still pass (no regression)
    Tool: Bash
    Preconditions: None
    Steps:
      1. bun test packages/bridge/src/wemo/__tests__/rules.test.ts
      2. Assert: exit code 0 (all pass)
      3. bun test packages/bridge/src/wemo/__tests__/soap.test.ts
      4. Assert: exit code 0 (all pass)
    Expected Result: Zero regressions in existing tests
    Evidence: Test output captured
  ```

  **Evidence to Capture:**
  - [ ] `bun test` output showing scheduler test failures (RED confirmation)
  - [ ] `bun test` output showing existing tests pass

  **Commit**: YES (groups with none — standalone commit)
  - Message: `test(scheduler): add TDD test suite for bridge-side timer scheduler (RED phase)`
  - Files: `packages/bridge/src/wemo/__tests__/scheduler.test.ts`
  - Pre-commit: `bun test packages/bridge/src/wemo/__tests__/rules.test.ts` (existing tests pass)

---

- [x] 2. Remove dead weekly calendar code from rules.ts

  **What to do**:
  - Remove 6 dead symbols from `packages/bridge/src/wemo/rules.ts`:
    1. `WEEKLY_CALENDAR_DAYS` constant (line 663)
    2. `internalDayToCalendarIndex()` function (lines 672-675)
    3. `buildDayTimerString()` function (lines 692-727)
    4. `updateWeeklyCalendar()` async function (lines 739-774)
    5. `enableWeeklyCalendar()` async function (lines 776-796)
    6. `activateTimerSchedule()` async function (lines 798-805)
  - Remove the "Weekly Calendar Activation" section comment block (lines 655-658)
  - Remove 4 `updateWeeklyCalendar()` call sites from mutation functions:
    1. `addTimer` line 553: `await updateWeeklyCalendar(host, port, rules);`
    2. `updateTimer` line 587: `await updateWeeklyCalendar(host, port, allRules);`
    3. `deleteTimer` line 618: `await updateWeeklyCalendar(host, port, remainingRules);`
    4. `toggleTimer` line 646: `await updateWeeklyCalendar(host, port, allRules);`
  - Also remove the now-unnecessary `parseRulesFromDb(updatedDb)` calls in `deleteTimer` (line 617 — only existed to feed updateWeeklyCalendar) — BUT check first: `addTimer` uses it on line 552 to find the new rule, `updateTimer` uses it on line 586 to find the updated rule, `toggleTimer` uses it on line 645 to find the updated rule. ONLY `deleteTimer` can drop its `parseRulesFromDb` call + `remainingRules` variable if the only consumer was `updateWeeklyCalendar`.
  - Verify with `lsp_find_references` on each symbol before deletion to confirm zero remaining references
  - Verify with `ast_grep_search` after deletion to confirm zero matches

  **Must NOT do**:
  - Do NOT remove `DAY_NAMES`, `DAY_BITS`, `toTimerAction`, `secondsToTimeString`, `timeStringToSeconds`, `dayIdToDayNames`, `dayIdToLabel` — these are live code
  - Do NOT touch `fetchTimers`, `fetchRulesDb`, `storeRulesDb`, `parseRulesFromDb`, or any DB mutation functions
  - Do NOT modify the function signatures of addTimer/updateTimer/deleteTimer/toggleTimer
  - Do NOT remove `syncDeviceTime` calls — those are intentionally kept

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward dead code deletion — no logic changes, just remove identified lines and call sites
  - **Skills**: `[]`
    - No special skills needed — file editing with verification
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed for simple edits (commit is just one file)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5 (route integration — needs clean rules.ts)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Code References** (exact locations to remove):
  - `packages/bridge/src/wemo/rules.ts:553` — `await updateWeeklyCalendar(host, port, rules);` in addTimer
  - `packages/bridge/src/wemo/rules.ts:587` — `await updateWeeklyCalendar(host, port, allRules);` in updateTimer
  - `packages/bridge/src/wemo/rules.ts:617-618` — `const remainingRules = parseRulesFromDb(updatedDb);` + `await updateWeeklyCalendar(host, port, remainingRules);` in deleteTimer
  - `packages/bridge/src/wemo/rules.ts:646` — `await updateWeeklyCalendar(host, port, allRules);` in toggleTimer
  - `packages/bridge/src/wemo/rules.ts:655-805` — Entire "Weekly Calendar Activation" section (section comment + 6 symbols)

  **Safety References** (verify these are NOT touched):
  - `packages/bridge/src/wemo/rules.ts:519-530` — `fetchTimers()` (KEEP)
  - `packages/bridge/src/wemo/rules.ts:807+` — `DAY_NAMES`, `DAY_BITS`, `dayIdToDayNames`, `dayIdToLabel` etc. (KEEP — these are live utilities)

  **Tool Directives**:
  - Use `lsp_find_references` on each of the 6 symbols BEFORE deletion to confirm the only references are the call sites being removed
  - Use `ast_grep_search` for `updateWeeklyCalendar`, `enableWeeklyCalendar`, `activateTimerSchedule`, `buildDayTimerString`, `internalDayToCalendarIndex`, `WEEKLY_CALENDAR_DAYS` AFTER deletion to confirm zero matches

  **Acceptance Criteria**:

  - [ ] 6 dead symbols removed from rules.ts
  - [ ] 4 updateWeeklyCalendar call sites removed from mutation functions
  - [ ] `deleteTimer` no longer calls `parseRulesFromDb` (its only consumer was updateWeeklyCalendar)
  - [ ] `bun test packages/bridge/src/wemo/__tests__/rules.test.ts` → PASS (0 failures)
  - [ ] `bun run typecheck` → exit 0 (no type errors)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Dead symbols are completely removed from codebase
    Tool: Bash (ast_grep_search)
    Preconditions: Dead code removal complete
    Steps:
      1. ast_grep_search pattern="updateWeeklyCalendar" lang="typescript" → Assert: 0 matches
      2. ast_grep_search pattern="enableWeeklyCalendar" lang="typescript" → Assert: 0 matches
      3. ast_grep_search pattern="activateTimerSchedule" lang="typescript" → Assert: 0 matches
      4. ast_grep_search pattern="buildDayTimerString" lang="typescript" → Assert: 0 matches
      5. ast_grep_search pattern="internalDayToCalendarIndex" lang="typescript" → Assert: 0 matches
      6. ast_grep_search pattern="WEEKLY_CALENDAR_DAYS" lang="typescript" → Assert: 0 matches
    Expected Result: Zero references to any dead symbol in the codebase
    Evidence: ast_grep output captured for each search

  Scenario: Existing timer CRUD tests still pass
    Tool: Bash
    Preconditions: Dead code removed
    Steps:
      1. bun test packages/bridge/src/wemo/__tests__/rules.test.ts
      2. Assert: exit code 0
      3. Assert: output shows all tests passing
    Expected Result: Zero regressions
    Evidence: Test output captured

  Scenario: Live utility functions preserved
    Tool: Bash (grep)
    Preconditions: Dead code removed
    Steps:
      1. grep -c "dayIdToDayNames\|dayIdToLabel\|secondsToTimeString\|timeStringToSeconds\|DAY_NAMES\|DAY_BITS" packages/bridge/src/wemo/rules.ts
      2. Assert: count > 0 (these functions still exist)
    Expected Result: All live utilities preserved
    Evidence: grep output captured

  Scenario: Type check passes after removal
    Tool: Bash
    Preconditions: Dead code removed
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
    Expected Result: No type errors introduced
    Evidence: typecheck output captured
  ```

  **Evidence to Capture:**
  - [ ] ast_grep results showing 0 matches for each removed symbol
  - [ ] Test output showing all rules.test.ts tests pass
  - [ ] Typecheck output showing exit 0

  **Commit**: YES
  - Message: `refactor(rules): remove dead weekly calendar code — UpdateWeeklyCalendar confirmed no-op on Insight firmware`
  - Files: `packages/bridge/src/wemo/rules.ts`
  - Pre-commit: `bun test packages/bridge/src/wemo/__tests__/rules.test.ts`

---

- [x] 3. Remove diagnostic block from timers.ts

  **What to do**:
  - Remove the diagnostic block from the POST handler in `packages/bridge/src/server/routes/timers.ts` (lines 137-189 approximately — the try/catch block containing parallel SOAP calls to GetRuleOverrideStatus, GetRules, GetInsightParams)
  - Remove the now-unused diagnostic imports (lines 10-12):
    - `import { parseInsightParams } from "../../wemo/insight";`
    - `import { extractTextValue, soapRequest } from "../../wemo/soap";`
  - Before removing imports, verify with `lsp_find_references` that these symbols are NOT used elsewhere in timers.ts (they should only be used in the diagnostic block)

  **Must NOT do**:
  - Do NOT modify the POST handler's core logic (addTimer call + response)
  - Do NOT remove any other route handlers (GET, PATCH, DELETE)
  - Do NOT change the response format of the POST handler

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple deletion of identified code block and unused imports — no logic changes
  - **Skills**: `[]`
    - No special skills needed — straightforward file editing
  - **Skills Evaluated but Omitted**:
    - `git-master`: Overkill for single-file cleanup

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 5 (route integration — needs clean timers.ts)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Code References** (exact locations to remove):
  - `packages/bridge/src/server/routes/timers.ts:10-12` — Diagnostic imports: `parseInsightParams` from insight, `extractTextValue` and `soapRequest` from soap
  - `packages/bridge/src/server/routes/timers.ts:137-189` — Diagnostic block: try/catch containing `Promise.all([soapRequest(GetRuleOverrideStatus), soapRequest(GetRules), soapRequest(GetInsightParams)])` and associated logging

  **Safety References** (preserve these):
  - `packages/bridge/src/server/routes/timers.ts:88-136` — POST handler core logic (addTimer call, response building) — KEEP
  - `packages/bridge/src/server/routes/timers.ts:190-196` — POST handler close (return statement) — KEEP
  - `packages/bridge/src/server/routes/timers.ts:203+` — PATCH, DELETE, toggle routes — KEEP

  **Tool Directives**:
  - Use `lsp_find_references` on `soapRequest`, `extractTextValue`, `parseInsightParams` within timers.ts to confirm only the diagnostic block uses them
  - After removal, verify no `GetRuleOverrideStatus` string remains in the file

  **Acceptance Criteria**:

  - [ ] Diagnostic block removed from POST handler
  - [ ] 3 unused imports removed (parseInsightParams, extractTextValue, soapRequest)
  - [ ] `bun run typecheck` → exit 0
  - [ ] `bun run lint` → exit 0 (no unused import warnings)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Diagnostic references completely removed
    Tool: Bash (grep)
    Preconditions: Diagnostic block removed
    Steps:
      1. grep -c "GetRuleOverrideStatus" packages/bridge/src/server/routes/timers.ts
      2. Assert: count is 0
      3. grep -c "GetInsightParams" packages/bridge/src/server/routes/timers.ts
      4. Assert: count is 0
      5. grep -c "parseInsightParams" packages/bridge/src/server/routes/timers.ts
      6. Assert: count is 0
    Expected Result: Zero diagnostic references remain
    Evidence: grep output captured

  Scenario: POST handler still exports correct route structure
    Tool: Bash (grep)
    Preconditions: Diagnostic block removed
    Steps:
      1. grep -c "timers.post\|timers.get\|timers.patch\|timers.delete" packages/bridge/src/server/routes/timers.ts
      2. Assert: count matches expected route count (5 routes: GET, POST, PATCH update, DELETE, PATCH toggle)
    Expected Result: All 5 route handlers still present
    Evidence: grep output captured

  Scenario: Type check and lint pass
    Tool: Bash
    Preconditions: Imports and block removed
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
      3. bun run lint
      4. Assert: exit code 0
    Expected Result: No type or lint errors
    Evidence: Command output captured
  ```

  **Evidence to Capture:**
  - [ ] grep output showing 0 diagnostic references
  - [ ] typecheck + lint output showing clean

  **Commit**: YES
  - Message: `refactor(timers): remove dead diagnostic block — GetRuleOverrideStatus/GetRules/GetInsightParams all SOAP fault on Insight firmware`
  - Files: `packages/bridge/src/server/routes/timers.ts`
  - Pre-commit: `bun run typecheck`

---

- [x] 4. Implement scheduler.ts (GREEN + REFACTOR)

  **What to do**:
  - Create `packages/bridge/src/wemo/scheduler.ts` — the bridge-side timer scheduler
  - Implement all exports to make the tests from Task 1 pass
  - Follow the pure-function-core design: `evaluateRules()` is deterministic, `tick()` handles I/O

  **Implementation Details**:

  **Type: `FireEvent`**:
  ```
  { deviceId: string, ruleId: number, ruleName: string, action: 0 | 1 }
  ```

  **Pure function: `evaluateRules(rules, nowSeconds, lastCheckedSeconds, currentDayBit)`**:
  - For each rule where `rule.enabled === true`:
    - Check day match: `rule.dayId === DAYS.DAILY || rule.dayId === DAYS.ALL || (rule.dayId & currentDayBit) !== 0`
    - Check start time: if `lastCheckedSeconds < rule.startTime && rule.startTime <= nowSeconds` → emit fire event with `action = mapAction(rule.startAction)`
    - Check end time: if `rule.endTime !== undefined && rule.endAction !== undefined && lastCheckedSeconds < rule.endTime && rule.endTime <= nowSeconds` → emit fire event with `action = mapAction(rule.endAction)`
  - Handle midnight rollover: if `nowSeconds < lastCheckedSeconds` (clock wrapped), check two ranges: `[lastCheckedSeconds, 86400)` and `[0, nowSeconds]`
  - `mapAction(action: TimerAction)`: `TimerAction.Off → 0`, `TimerAction.On → 1`, `TimerAction.Toggle → 1`

  **State**:
  - `rulesCache: Map<string, TimerRule[]>` — keyed by device ID
  - `firedToday: Set<string>` — entries like `${deviceId}:${ruleId}:start:${dayOfYear}` and `${deviceId}:${ruleId}:end:${dayOfYear}`
  - `lastCheckedSeconds: number` — tracks last evaluation time
  - `lastCheckedDayOfYear: number` — tracks day for midnight rollover detection

  **Orchestration: `tick()`**:
  - Get current time: `const now = new Date(); const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();`
  - Get current day bit: map `now.getDay()` (0=Sun..6=Sat) to DAYS bitmask (SUN=1, MON=2, TUE=4...)
  - Check midnight rollover: if `getDayOfYear(now) !== lastCheckedDayOfYear`, clear `firedToday` set
  - For each device in `rulesCache`:
    - Read fresh device info from DB: `getDatabase().getDeviceById(deviceId)` → get current host/port
    - If device not found in DB, skip (may have been deleted)
    - Call `evaluateRules(rules, nowSeconds, lastCheckedSeconds, currentDayBit)` to get fire events
    - For each fire event:
      - Build dedup key: `${deviceId}:${ruleId}:${startOrEnd}:${dayOfYear}`
      - If already in `firedToday`, skip
      - Call `soapRequest(host, port, "/upnp/control/basicevent1", "urn:Belkin:service:basicevent:1", "SetBinaryState", "<BinaryState>${action}</BinaryState>")`
      - Log: `[Scheduler] Firing rule "${ruleName}" (${action === 1 ? 'ON' : 'OFF'}) on device ${deviceId}`
      - On success: add to `firedToday`
      - On failure: log `[Scheduler] Failed to fire rule "${ruleName}" on device ${deviceId}: ${error.message}` — do NOT retry this tick
  - Update `lastCheckedSeconds = nowSeconds` and `lastCheckedDayOfYear`

  **Exports**:
  - `startScheduler()`: Sets up 30s `setInterval` calling `tick()`. Returns `{ stop: () => void }` where `stop` calls `clearInterval`.
  - `loadDeviceRules(deviceId, host, port)`: Calls `fetchTimers(host, port, deviceId)`, stores `result.rules` in `rulesCache`. Async, catches errors and logs (fire-and-forget per device).
  - `clearDeviceRules(deviceId)`: Deletes `rulesCache` entry for deviceId. Also clears any `firedToday` entries for that device.
  - `evaluateRules(...)`: Exported for direct testing.

  **Must NOT do**:
  - Do NOT use `WemoDeviceClient` — use raw `soapRequest()` directly
  - Do NOT add retry queues or complex failure handling
  - Do NOT persist the firedToday set
  - Do NOT create new API endpoints
  - Do NOT import or modify any existing files (that's Tasks 5 and 6)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core scheduler implementation with time-based logic, edge cases (midnight rollover, interval drift), and TDD GREEN phase requiring all 25+ tests to pass
  - **Skills**: `[]`
    - No special skills needed — pure TypeScript module
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not a browser task

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential — after Task 1)
  - **Blocks**: Tasks 5, 6 (integration)
  - **Blocked By**: Task 1 (tests must exist before implementing)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/bridge/src/wemo/rules.ts:700-703` — Day matching logic pattern: `rule.dayId === DAYS.DAILY || rule.dayId === DAYS.ALL || (rule.dayId & dayBit) !== 0`
  - `packages/bridge/src/wemo/device.ts:178` — SetBinaryState body format: `<BinaryState>${state}</BinaryState>`
  - `packages/bridge/src/wemo/device.ts:13` — Service type constant: `urn:Belkin:service:basicevent:1` (use this string directly, not the class)
  - `packages/bridge/src/wemo/device.ts:103` — Control URL: `/upnp/control/basicevent1`
  - `packages/bridge/src/wemo/rules.ts:709` — Toggle-to-On mapping precedent: `rule.startAction === TimerAction.Off ? 0 : 1`

  **API/Type References** (contracts to implement against):
  - `packages/bridge/src/wemo/types.ts:222-235` — `TimerRule` interface (ruleID, name, enabled, startTime, endTime?, startAction, endAction?, dayId)
  - `packages/bridge/src/wemo/types.ts:237-238` — `TimerAction` enum (Off=0, On=1, Toggle=2)
  - `packages/bridge/src/wemo/types.ts:274-286` — `DAYS` constant (DAILY=-1, SUN=1, MON=2, etc.)
  - `packages/bridge/src/wemo/types.ts:240-244` — `TimerSchedule` interface (returned by fetchTimers)
  - `packages/bridge/src/wemo/soap.ts:135-143` — `soapRequest()` function signature
  - `packages/bridge/src/wemo/rules.ts:519-530` — `fetchTimers()` function (used by loadDeviceRules)
  - `packages/bridge/src/db/index.ts:287-292` — `getDatabase()` singleton (used for fresh device lookup each tick)

  **Test References** (tests to make pass):
  - `packages/bridge/src/wemo/__tests__/scheduler.test.ts` — The TDD test suite from Task 1. All 25+ tests must pass.

  **Acceptance Criteria**:

  **TDD GREEN Phase:**
  - [ ] File created: `packages/bridge/src/wemo/scheduler.ts`
  - [ ] `bun test packages/bridge/src/wemo/__tests__/scheduler.test.ts` → PASS (all 25+ tests, 0 failures)
  - [ ] `bun run typecheck` → exit 0
  - [ ] `bun run lint` → exit 0

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: All scheduler tests pass (GREEN)
    Tool: Bash
    Preconditions: scheduler.test.ts exists from Task 1
    Steps:
      1. bun test packages/bridge/src/wemo/__tests__/scheduler.test.ts
      2. Assert: exit code 0
      3. Assert: output shows 25+ tests passing, 0 failures
    Expected Result: All TDD tests pass — GREEN phase achieved
    Evidence: Full test output captured

  Scenario: evaluateRules is exported and callable as pure function
    Tool: Bash
    Preconditions: scheduler.ts exists
    Steps:
      1. bun -e "import { evaluateRules } from './packages/bridge/src/wemo/scheduler'; console.log(typeof evaluateRules)"
      2. Assert: output is "function"
    Expected Result: evaluateRules is a function export
    Evidence: Command output captured

  Scenario: startScheduler returns stop function
    Tool: Bash
    Preconditions: scheduler.ts exists
    Steps:
      1. bun -e "import { startScheduler } from './packages/bridge/src/wemo/scheduler'; const s = startScheduler(); console.log(typeof s.stop); s.stop();"
      2. Assert: output is "function"
    Expected Result: startScheduler returns { stop: function }
    Evidence: Command output captured

  Scenario: Type check and lint pass
    Tool: Bash
    Preconditions: scheduler.ts implemented
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
      3. bun run lint
      4. Assert: exit code 0
    Expected Result: Clean type check and lint
    Evidence: Command output captured
  ```

  **Evidence to Capture:**
  - [ ] Full test output showing all scheduler tests pass
  - [ ] typecheck + lint output

  **Commit**: YES
  - Message: `feat(scheduler): implement bridge-side timer scheduler — evaluates rules every 30s and fires SetBinaryState`
  - Files: `packages/bridge/src/wemo/scheduler.ts`
  - Pre-commit: `bun test packages/bridge/src/wemo/__tests__/scheduler.test.ts`

---

- [x] 5. Integrate scheduler into timer routes + device DELETE route

  **What to do**:
  - In `packages/bridge/src/server/routes/timers.ts`:
    - Import `loadDeviceRules` from `../../wemo/scheduler`
    - After each successful mutation call (addTimer, updateTimer, deleteTimer, toggleTimer), call `loadDeviceRules(device.id, device.host, device.port)` to refresh the scheduler's rule cache
    - The call should be fire-and-forget (don't await it in the request path, or await with a catch that logs but doesn't fail the response)
  - In `packages/bridge/src/server/routes/devices.ts`:
    - Import `clearDeviceRules` from `../../wemo/scheduler`
    - In the DELETE `/:id` handler (line 290), call `clearDeviceRules(id)` after `db.deleteDevice(id)` to remove the device's rules from the scheduler cache

  **Must NOT do**:
  - Do NOT modify the response format of any route
  - Do NOT add new routes
  - Do NOT change the timer CRUD function signatures
  - Do NOT make the route response depend on scheduler refresh success (fire-and-forget)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small integration wiring — adding import + one function call per route handler
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `git-master`: Overkill for small edits

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: Task 7 (final verification)
  - **Blocked By**: Tasks 2, 3, 4 (needs clean files and scheduler exports)

  **References**:

  **Code References** (where to add calls):
  - `packages/bridge/src/server/routes/timers.ts:88-196` — POST handler: add `loadDeviceRules` after `addTimer` succeeds (around line 130, after the response is built but before return — or as fire-and-forget after return)
  - `packages/bridge/src/server/routes/timers.ts:203-238` — PATCH handler: add after `updateTimer` succeeds
  - `packages/bridge/src/server/routes/timers.ts:245-263` — DELETE handler: add after `deleteTimer` succeeds
  - `packages/bridge/src/server/routes/timers.ts:270-292` — Toggle handler: add after `toggleTimer` succeeds
  - `packages/bridge/src/server/routes/devices.ts:290-300` — DELETE handler: add `clearDeviceRules(id)` after `db.deleteDevice(id)` on line 297

  **API References** (scheduler exports to use):
  - `packages/bridge/src/wemo/scheduler.ts` → `loadDeviceRules(deviceId: string, host: string, port: number): Promise<void>`
  - `packages/bridge/src/wemo/scheduler.ts` → `clearDeviceRules(deviceId: string): void`

  **Context References** (device info available in route handlers):
  - In timer routes: `device` variable is a `SavedDevice` with `.id`, `.host`, `.port` — obtained via `requireDevice(id)` at the start of each handler
  - In device DELETE route: `id` is the param string — same as device.id

  **Acceptance Criteria**:

  - [ ] `loadDeviceRules` imported and called in all 4 timer mutation routes
  - [ ] `clearDeviceRules` imported and called in device DELETE route
  - [ ] `bun run typecheck` → exit 0
  - [ ] `bun run lint` → exit 0

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: loadDeviceRules called in all timer mutation routes
    Tool: Bash (grep)
    Preconditions: Integration complete
    Steps:
      1. grep -c "loadDeviceRules" packages/bridge/src/server/routes/timers.ts
      2. Assert: count >= 5 (1 import + 4 calls)
    Expected Result: Import + 4 route handler calls present
    Evidence: grep output captured

  Scenario: clearDeviceRules called in device DELETE route
    Tool: Bash (grep)
    Preconditions: Integration complete
    Steps:
      1. grep -c "clearDeviceRules" packages/bridge/src/server/routes/devices.ts
      2. Assert: count >= 2 (1 import + 1 call)
    Expected Result: Import + 1 call in DELETE handler
    Evidence: grep output captured

  Scenario: Type check and lint pass
    Tool: Bash
    Preconditions: All integrations wired
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
      3. bun run lint
      4. Assert: exit code 0
    Expected Result: No type or lint errors
    Evidence: Command output captured
  ```

  **Evidence to Capture:**
  - [ ] grep output showing loadDeviceRules/clearDeviceRules calls
  - [ ] typecheck + lint output

  **Commit**: YES (groups with Task 6)
  - Message: `feat(scheduler): integrate scheduler refresh into timer and device routes`
  - Files: `packages/bridge/src/server/routes/timers.ts`, `packages/bridge/src/server/routes/devices.ts`
  - Pre-commit: `bun run typecheck`

---

- [x] 6. Integrate scheduler into main.ts startup/shutdown

  **What to do**:
  - In `packages/bridge/src/main.ts`:
    - Import `startScheduler`, `loadDeviceRules` from `./wemo/scheduler`
    - In `initialize()` function, after `runBackgroundDiscovery()` (line 120), add a new step:
      - Step 5 (renumber existing step 5 to step 6): Start the scheduler
      - Call `const scheduler = startScheduler()`
      - Store the scheduler handle (e.g., on `state` object or module-level variable)
      - For each saved device, call `loadDeviceRules(device.id, device.host, device.port)` — fire-and-forget per device (don't block startup)
      - Log: `[Main] Timer scheduler started`
    - In `shutdown()` function (line 249), add a new step BEFORE "Stop HTTP server":
      - Step 0: Stop scheduler
      - Call `scheduler.stop()` (or `state.scheduler?.stop()`)
      - Log: `[Main] Timer scheduler stopped`
    - The scheduler should also be started for devices found during `runBackgroundDiscovery()` — since discovery runs async, the scheduler starts with whatever devices are in the DB. As discovery finds devices, the timer routes will refresh rules on mutation. For initial load, iterate `getDatabase().getAllDevices()` after starting the scheduler.

  **Must NOT do**:
  - Do NOT block startup waiting for rule loading — all `loadDeviceRules` calls are fire-and-forget
  - Do NOT change the existing startup sequence order (DB → server → tray → discovery)
  - Do NOT add scheduler to the tray menu

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small integration — adding import, 3-4 lines in initialize(), 2 lines in shutdown()
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `git-master`: Overkill for small edits

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 5)
  - **Blocks**: Task 7 (final verification)
  - **Blocked By**: Task 4 (needs scheduler exports)

  **References**:

  **Code References** (where to integrate):
  - `packages/bridge/src/main.ts:56-130` — `initialize()` function: add scheduler start after line 120 (runBackgroundDiscovery call)
  - `packages/bridge/src/main.ts:249-288` — `shutdown()` function: add scheduler stop before line 258 (server stop)
  - `packages/bridge/src/main.ts:28-40` — `state` object definition: add scheduler handle field

  **API References** (scheduler exports to use):
  - `packages/bridge/src/wemo/scheduler.ts` → `startScheduler(): { stop: () => void }`
  - `packages/bridge/src/wemo/scheduler.ts` → `loadDeviceRules(deviceId: string, host: string, port: number): Promise<void>`

  **Data References** (how to get device list):
  - `packages/bridge/src/db/index.ts` → `getDatabase().getAllDevices(): SavedDevice[]` — returns all saved devices with id, host, port

  **Pattern References** (follow startup logging pattern):
  - `packages/bridge/src/main.ts:57` — `console.log("[Main] Open Wemo Bridge starting...");` — follow `[Main]` prefix convention

  **Acceptance Criteria**:

  - [ ] `startScheduler()` called in initialize() after runBackgroundDiscovery
  - [ ] `loadDeviceRules()` called for each saved device (fire-and-forget)
  - [ ] `scheduler.stop()` called in shutdown() before server stop
  - [ ] `bun run typecheck` → exit 0
  - [ ] `bun run lint` → exit 0

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Scheduler lifecycle integrated into main.ts
    Tool: Bash (grep)
    Preconditions: Integration complete
    Steps:
      1. grep -c "startScheduler" packages/bridge/src/main.ts
      2. Assert: count >= 2 (1 import + 1 call)
      3. grep -c "loadDeviceRules" packages/bridge/src/main.ts
      4. Assert: count >= 2 (1 import + 1+ calls)
      5. grep "scheduler.*stop\|stop.*scheduler" packages/bridge/src/main.ts
      6. Assert: at least 1 match in shutdown()
    Expected Result: Scheduler started on init, stopped on shutdown, rules loaded for devices
    Evidence: grep output captured

  Scenario: Type check and lint pass
    Tool: Bash
    Preconditions: Integration complete
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
      3. bun run lint
      4. Assert: exit code 0
    Expected Result: Clean type check and lint
    Evidence: Command output captured
  ```

  **Evidence to Capture:**
  - [ ] grep output showing scheduler integration points
  - [ ] typecheck + lint output

  **Commit**: YES (groups with Task 5)
  - Message: `feat(scheduler): integrate scheduler into bridge startup and shutdown lifecycle`
  - Files: `packages/bridge/src/main.ts`
  - Pre-commit: `bun run typecheck`

---

- [x] 7. Final verification and regression testing

  **What to do**:
  - Run the complete test suite to verify zero regressions
  - Run typecheck and lint to verify clean build
  - Verify no dead code references remain
  - Verify all new code is properly integrated

  **Must NOT do**:
  - Do NOT make code changes — this is verification only
  - If any check fails, report the failure clearly for the preceding task to fix

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure verification — no code changes, just running commands and checking output
  - **Skills**: `[]`
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (final — sequential)
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 5, 6 (all integration must be complete)

  **References**: None needed — this is a verification task.

  **Acceptance Criteria**:

  - [ ] `bun test` → PASS (all tests including new scheduler tests, 0 failures)
  - [ ] `bun run typecheck` → exit 0
  - [ ] `bun run lint` → exit 0
  - [ ] Zero `updateWeeklyCalendar`, `enableWeeklyCalendar`, `activateTimerSchedule`, `buildDayTimerString`, `internalDayToCalendarIndex`, `WEEKLY_CALENDAR_DAYS` references in codebase
  - [ ] Zero `GetRuleOverrideStatus` references in timers.ts
  - [ ] `loadDeviceRules` present in timers.ts (4 calls)
  - [ ] `clearDeviceRules` present in devices.ts (1 call)
  - [ ] `startScheduler` present in main.ts
  - [ ] `scheduler.stop()` or equivalent present in main.ts shutdown()

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Full test suite passes with zero failures
    Tool: Bash
    Preconditions: All previous tasks complete
    Steps:
      1. bun test
      2. Assert: exit code 0
      3. Assert: output shows 0 failures
      4. Assert: scheduler tests included in output
    Expected Result: All tests pass including new scheduler tests
    Evidence: Full test output captured to .sisyphus/evidence/task-7-full-test-suite.txt

  Scenario: Type check passes
    Tool: Bash
    Preconditions: All code changes complete
    Steps:
      1. bun run typecheck
      2. Assert: exit code 0
    Expected Result: Zero type errors
    Evidence: Output captured

  Scenario: Lint passes
    Tool: Bash
    Preconditions: All code changes complete
    Steps:
      1. bun run lint
      2. Assert: exit code 0
    Expected Result: Zero lint errors
    Evidence: Output captured

  Scenario: Dead code completely purged
    Tool: Bash (ast_grep_search)
    Preconditions: All removals complete
    Steps:
      1. ast_grep_search pattern="updateWeeklyCalendar" lang="typescript" → Assert: 0 matches
      2. ast_grep_search pattern="enableWeeklyCalendar" lang="typescript" → Assert: 0 matches
      3. ast_grep_search pattern="activateTimerSchedule" lang="typescript" → Assert: 0 matches
      4. ast_grep_search pattern="WEEKLY_CALENDAR_DAYS" lang="typescript" → Assert: 0 matches
      5. grep "GetRuleOverrideStatus" packages/bridge/src/server/routes/timers.ts → Assert: 0 matches
    Expected Result: All dead code fully removed
    Evidence: Search output captured

  Scenario: All integration points wired
    Tool: Bash (grep)
    Preconditions: All integrations complete
    Steps:
      1. grep -c "loadDeviceRules" packages/bridge/src/server/routes/timers.ts → Assert: >= 5
      2. grep -c "clearDeviceRules" packages/bridge/src/server/routes/devices.ts → Assert: >= 2
      3. grep -c "startScheduler" packages/bridge/src/main.ts → Assert: >= 2
      4. grep "\.stop()" packages/bridge/src/main.ts → Assert: scheduler stop present in shutdown
    Expected Result: All integration points confirmed
    Evidence: grep output captured
  ```

  **Evidence to Capture:**
  - [ ] Full test suite output: `.sisyphus/evidence/task-7-full-test-suite.txt`
  - [ ] Typecheck output
  - [ ] Lint output
  - [ ] Dead code search results
  - [ ] Integration point verification

  **Commit**: NO (verification only — no code changes)

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `test(scheduler): add TDD test suite for bridge-side timer scheduler (RED phase)` | `packages/bridge/src/wemo/__tests__/scheduler.test.ts` | Existing tests pass |
| 2 | `refactor(rules): remove dead weekly calendar code — confirmed no-op on Insight firmware` | `packages/bridge/src/wemo/rules.ts` | `bun test rules.test.ts` |
| 3 | `refactor(timers): remove dead diagnostic block — GetRuleOverrideStatus/GetRules SOAP fault` | `packages/bridge/src/server/routes/timers.ts` | `bun run typecheck` |
| 4 | `feat(scheduler): implement bridge-side timer scheduler` | `packages/bridge/src/wemo/scheduler.ts` | `bun test scheduler.test.ts` |
| 5+6 | `feat(scheduler): integrate scheduler into routes and startup lifecycle` | `timers.ts`, `devices.ts`, `main.ts` | `bun run typecheck` |
| 7 | No commit (verification only) | — | `bun test && bun run typecheck && bun run lint` |

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all tests pass (80+ existing + 25+ new)
bun run typecheck           # Expected: exit 0
bun run lint                # Expected: exit 0
```

### Final Checklist
- [ ] All "Must Have" items present (evaluateRules pure function, lastCheckedAt window, both time events, Toggle→On, day matching, enabled check, dedup, midnight rollover, async rule loading, DB re-read each tick, [Scheduler] logging)
- [ ] All "Must NOT Have" items absent (no persistence, no retry queue, no new endpoints, no UI changes, no WemoDeviceClient usage, no proactive TimeSync)
- [ ] All tests pass (zero regressions + new scheduler tests)
- [ ] Dead code fully removed (6 symbols + 4 call sites + diagnostic block)
- [ ] Scheduler integrated into startup + shutdown + timer routes + device DELETE
