# Timer/Schedule Feature Spec

## Overview
Add device-native timer/schedule management to open-wemo. Wemo devices store rules in an internal SQLite database transferred via SOAP as a base64-encoded ZIP. The bridge acts as a UI for managing these device-native timers — once pushed, the device executes them autonomously (no bridge needed).

## GitHub Issue
Issue #3 — "Edit Wemo Schedule" — user requests ability to edit and delete timer schedules/rules.

## Protocol

### How Wemo Rules Work
1. `FetchRules` SOAP call (service: `rules:1`) → device returns base64 ZIP containing a SQLite DB
2. Unzip, read/modify the SQLite DB locally
3. `StoreRules` SOAP call → push modified DB back with incremented version number

### SQLite Schema (device-side)
- **RULES**: RuleID, Name, Type ("Timer"/"Long Press"/"Simple"/"Sunrise"/"Sunset"), State ("1"=enabled/"0"=disabled)
- **RULEDEVICES**: Links rules to devices — StartTime/EndTime (seconds from midnight, 0–86400), StartAction/EndAction (0.0=OFF, 1.0=ON, 2.0=TOGGLE), DayID (-1=daily, otherwise bitmask)
- **TARGETDEVICES**: Which devices a rule controls

### SOAP Actions (rules:1 service)
- `FetchRules` — download rules DB
- `StoreRules` — upload modified rules DB (body: `<RuleList>base64zip</RuleList><ruledbVersion>N</ruledbVersion>`)
- `GetRulesDBVersion` — get current version number (for sync)

### Reference Implementation
pywemo is the only OSS project implementing rules. See `research/wemo-oss-timer-comparison.md` for details.

## Architecture

### New Files
- `packages/bridge/src/wemo/rules.ts` — FetchRules/StoreRules SOAP calls, ZIP handling, SQLite DB read/write
- `packages/bridge/src/server/routes/timers.ts` — Hono API routes for timer CRUD
- `packages/bridge/src/wemo/__tests__/rules.test.ts` — unit tests for rules module
- Timer UI additions in `packages/web/js/app.js` and `packages/web/css/style.css`
- API client additions in `packages/web/js/api.js`

### Extension Pattern
Follow the `InsightDeviceClient` pattern — extend `WemoDeviceClient` or add a `RulesClient` mixin. The SOAP layer (`soap.ts`) is fully generic and needs zero changes.

### Types (add to `types.ts`)
```typescript
interface TimerRule {
  ruleID: string
  name: string
  type: 'Timer' | 'Sunrise' | 'Sunset'
  enabled: boolean
  startTime: number      // seconds from midnight
  endTime?: number       // seconds from midnight (optional, for on/off pairs)
  startAction: number    // 0.0=OFF, 1.0=ON, 2.0=TOGGLE
  endAction?: number
  dayId: number          // -1=daily, bitmask for specific days
}

interface TimerSchedule {
  deviceId: string
  rules: TimerRule[]
  dbVersion: number
}
```

### API Routes
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices/:id/timers` | Fetch all timer rules for a device |
| POST | `/api/devices/:id/timers` | Create a new timer rule |
| PATCH | `/api/devices/:id/timers/:ruleId` | Update a timer rule |
| DELETE | `/api/devices/:id/timers/:ruleId` | Delete a timer rule |
| PATCH | `/api/devices/:id/timers/:ruleId/toggle` | Enable/disable a timer rule |

### Rules Module (`rules.ts`) Responsibilities
1. `fetchRules(device)` — SOAP FetchRules → decode base64 → unzip → open SQLite DB → parse rules → return `TimerSchedule`
2. `storeRules(device, schedule)` — serialize rules to SQLite → zip → base64 → SOAP StoreRules with incremented version
3. `addRule(device, rule)` — fetch → add → store
4. `updateRule(device, ruleId, changes)` — fetch → update → store
5. `deleteRule(device, ruleId)` — fetch → remove → store
6. `toggleRule(device, ruleId, enabled)` — fetch → toggle → store

Note: Each mutation is a full fetch-modify-store cycle. No local caching — always read from device, push back to device. This ensures consistency even if rules are modified externally (e.g., via the Wemo app).

### ZIP Handling
Use Bun's built-in or a lightweight library. The ZIP contains a single SQLite file. Bun has native `bun:sqlite` for DB operations.

## UI Spec

### Device Card Enhancement
- Add a **clock icon button** (🕐 or SVG) to each device card, next to the existing toggle
- Tapping it expands an **inline timer panel** below the card (accordion-style)
- Panel collapses on second tap or when another device's timer panel opens

### Timer Panel Contents
1. **Timer list** — each timer shows:
   - Time display: "7:00 AM → ON" or "7:00 AM ON — 11:00 PM OFF"
   - Days: "Daily" / "Weekdays" / "Weekends" / "Mon, Wed, Fri"
   - Enable/disable toggle (per timer)
   - Edit button (pencil icon)
   - Delete button (trash icon, with confirmation)

2. **Add Timer button** at bottom of list

3. **Empty state** — "No timers set. Tap + to add one."

4. **Loading state** — per-device spinner with "Loading timers, please wait." message while fetching from device

5. **Saving state** — spinner with "Saving to device..." while pushing rules back

### Add/Edit Timer Form (inline or modal)
- **Time picker**: native `<input type="time">` (clean on all platforms)
- **Action selector**: ON / OFF / Toggle (segmented control or radio buttons)
- **Day picker**: 7 toggleable day buttons (M T W T F S S) + quick selects (Daily, Weekdays, Weekends)
- **Optional end time + action**: toggle to enable "and then..." second action
- **Save / Cancel buttons**

### Design Constraints
- Follow existing CSS custom properties for theming (dark/light/system)
- Maintain haptic feedback patterns (vibrate on toggle, save)
- Accessibility: focus trapping in forms, screen reader announcements for state changes
- Mobile-first — the timer panel should work well as a touch interface
- No framework migration — vanilla JS, same patterns as existing code

### Error Handling
- Device unreachable → show error inline with retry button
- SOAP fault → parse error, show human-readable message
- Version conflict (someone else modified rules) → refetch and show current state

## Testing
- Unit tests for rules module: ZIP encode/decode, SQLite parse/serialize, time conversion helpers
- Unit tests for API routes (mock SOAP layer)
- Follow existing `bun:test` patterns in `__tests__/`

## Branch
Create feature branch: `feature/timer-schedules`

## Research References
- `research/wemo-oss-timer-comparison.md` — OSS project comparison
- `research/wemo-rules-protocol-research.md` — protocol deep-dive (from subagent — check if file exists, otherwise reference findings above)
- `docs/PROTOCOL.md` — existing protocol docs
