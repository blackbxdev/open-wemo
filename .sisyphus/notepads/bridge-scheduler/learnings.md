## 2026-02-25 Initial Context

- Baseline: 80 tests pass across 4 unit test files (rules, soap, insight, types)
- 1 e2e test file exists but fails due to missing playwright package (not our concern)
- Test framework: bun:test with describe/test/expect pattern
- Test files live in `packages/bridge/src/wemo/__tests__/*.test.ts`
- soapRequest signature: `soapRequest<T>(host, port, controlURL, serviceType, action, body?, timeout?)`
- SetBinaryState: body `<BinaryState>${0|1}</BinaryState>`, controlURL `/upnp/control/basicevent1`, service `urn:Belkin:service:basicevent:1`
- DB singleton: `getDatabase()` returns `DatabaseManager` with `.getDeviceById(id)` and `.getAllDevices()`
- TimerRule interface: ruleID, name, type, enabled, startTime, endTime?, startAction, endAction?, dayId
- TimerAction enum: Off=0, On=1, Toggle=2
- DAYS constants: DAILY=-1, SUN=1, MON=2, TUE=4, WED=8, THU=16, FRI=32, SAT=64, ALL=127
- main.ts: initialize() has 5 steps (DB → server → tray → discovery → welcome), shutdown() has 3 steps (server → tray → DB)
- AppState interface at line 23-28 of main.ts
- rules.ts has updateWeeklyCalendar calls at lines 553, 587, 618, 646 (dead code to remove)
- timers.ts has diagnostic block at lines 137-189 with imports at lines 10-12
- devices.ts DELETE route at lines 290-300

## 2026-02-25 Scheduler RED Phase Tests

- Created `packages/bridge/src/wemo/__tests__/scheduler.test.ts` with 28 test cases
- Tests organized in 3 describe blocks: evaluateRules (18), tick (6), lifecycle (4)
- evaluateRules signature: `(rules: TimerRule[], nowSeconds: number, lastCheckedSeconds: number, currentDayBit: number): FireEvent[]`
- FireEvent type: `{ deviceId: string, ruleId: number, ruleName: string, action: 0 | 1 }`
- Exported functions from scheduler: `evaluateRules`, `tick`, `startScheduler`, `loadDeviceRules`, `clearDeviceRules`, `FireEvent` (type)
- Mocks: soapRequest from ../soap, getDatabase from ../../db, fetchTimers from ../rules
- bun:test mock.module() used for module-level mocking
- Cast `mock.calls as unknown[][]` to access call args without type errors from unresolved module
- Midnight rollover test: when nowSeconds < lastCheckedSeconds, evaluate both 86390..86400 and 0..10 ranges
- Toggle action maps to 1 (On) matching rules.ts:709 pattern
- endTime/endAction only evaluated when endAction is defined (not just endTime)
