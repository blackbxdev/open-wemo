# Timer Bugfix + E2E Testing Spec

## Bug 1: Toggle Button Misshaped

The timer enable/disable toggle on each timer item is visually broken. The `.timer-item-actions .toggle` rule at line 2415 in `style.css` only sets `min-height` but doesn't properly constrain the toggle within the timer item layout.

### Fix
- Inspect and fix `.timer-item-actions .toggle` CSS — ensure the toggle track and thumb render at the correct size within the timer item row
- The toggle should match the device card toggle styling but be appropriately scaled for the timer item context
- Ensure the toggle is vertically centered in the timer item actions area
- Test in both light and dark themes
- Test on mobile viewport (375px) and desktop (1024px+)

## Bug 2: Device Does Not React to Schedule

The schedule appears to save (UI shows success) but the device doesn't actually execute the timer. The likely root cause is in `storeRulesDb()` in `packages/bridge/src/wemo/rules.ts`.

### Investigate These Issues

**Issue A — CDATA encoding in StoreRules SOAP body:**
```typescript
const body = `<ruleDbVersion>${version + 1}</ruleDbVersion><processDb>1</processDb><ruleDbBody>&lt;![CDATA[${base64}]]&gt;</ruleDbBody>`;
```
The CDATA wrapper is HTML-entity-encoded (`&lt;` / `&gt;`) which means the SOAP envelope builder will double-encode it. The device likely receives `&lt;![CDATA[...` literally instead of `<![CDATA[...`. Compare with pywemo's approach — they send the base64 directly without CDATA, or use proper XML CDATA.

**Issue B — ZIP structure:**
Verify the ZIP created by `fflate`'s `zipSync` matches what the device expects. The device may expect a specific compression level or ZIP format.

**Issue C — SQLite serialization:**
Verify `db.serialize()` produces a valid SQLite file that the device firmware can read. Test round-trip: create DB → serialize → deserialize → verify data.

**Issue D — Version increment:**
Verify the version number is correctly incremented. If `FetchRules` returns version 0 for a fresh device, storing with version 1 should work. But if the device rejects out-of-sequence versions, this could be the issue.

### Fix
- Fix the SOAP body encoding (most likely culprit)
- Add logging to `storeRulesDb()` and `fetchRulesDb()` for debugging
- Verify round-trip: fetch → parse → serialize → store → fetch again → verify data matches

## E2E Browser Testing

Create comprehensive E2E tests using Playwright that test the full timer workflow through the web UI. Tests should take screenshots at each major step.

### Test File
Create `packages/bridge/src/__tests__/e2e/timers.e2e.test.ts`

### Prerequisites
- Install Playwright: `bunx playwright install chromium`
- Tests start the bridge server on a random port
- Mock the SOAP layer at the HTTP level (intercept fetch calls to device IPs) — no real Wemo device needed
- Mock responses should return realistic SOAP XML for FetchRules/StoreRules

### Test Suites

#### Suite 1: Timer Panel UI
1. **Open timer panel** — Click clock icon on device card → panel expands → screenshot
2. **Empty state** — New device with no timers shows "No timers set" → screenshot
3. **Loading state** — Shows spinner + "Loading timers, please wait." during fetch → screenshot
4. **Close timer panel** — Click clock icon again → panel collapses

#### Suite 2: Create Timer
1. **Open add form** — Click "+ Add Timer" → form appears → screenshot
2. **Fill form** — Set time to 7:00 AM, action to ON, days to Weekdays → screenshot
3. **Save timer** — Click save → shows saving spinner → timer appears in list → screenshot
4. **Verify timer display** — Timer shows "7:00 AM → ON", "Weekdays" → screenshot

#### Suite 3: Edit Timer
1. **Click edit** — Click pencil icon on timer → form pre-filled → screenshot
2. **Modify time** — Change to 8:30 PM → screenshot
3. **Save changes** — Timer updates in list → screenshot

#### Suite 4: Toggle Timer
1. **Toggle off** — Click enable/disable toggle → timer becomes disabled (dimmed) → screenshot
2. **Toggle on** — Click toggle again → timer re-enabled → screenshot
3. **Verify toggle shape** — Toggle button renders correctly, thumb is circular, track is pill-shaped → screenshot

#### Suite 5: Delete Timer
1. **Click delete** — Click trash icon → confirmation appears → screenshot
2. **Confirm delete** — Timer removed from list → screenshot
3. **Empty state after delete** — If last timer, shows empty state → screenshot

#### Suite 6: Multiple Timers
1. **Add 3 timers** — Different times/actions/days → screenshot of full list
2. **Scroll behavior** — If list overflows, verify scrolling works → screenshot
3. **Edit middle timer** — Verify correct timer is edited → screenshot

#### Suite 7: Error States
1. **Device offline** — Mock SOAP failure → shows error with retry button → screenshot
2. **Save failure** — Mock StoreRules failure → shows error toast → screenshot
3. **Retry success** — Click retry → loads successfully → screenshot

#### Suite 8: Responsive Design
1. **Mobile viewport (375px)** — Full timer workflow → screenshots at each step
2. **Tablet viewport (768px)** — Timer panel layout → screenshot
3. **Desktop viewport (1280px)** — Timer panel layout → screenshot

#### Suite 9: Theme Support
1. **Dark theme** — Timer panel in dark mode → screenshot
2. **Light theme** — Timer panel in light mode → screenshot

#### Suite 10: SOAP Round-Trip Verification
1. **Create timer → fetch → verify** — After creating a timer, refetch rules DB and verify the data matches what was sent
2. **Toggle timer → fetch → verify** — After toggling, verify state changed in DB
3. **Delete timer → fetch → verify** — After deleting, verify rule is gone from DB
4. **Version increment** — Verify each StoreRules call increments the version

### Screenshot Organization
Save screenshots to `packages/bridge/src/__tests__/e2e/screenshots/` with descriptive names:
```
timer-panel-open.png
timer-empty-state.png
timer-add-form.png
timer-created.png
timer-toggle-off.png
timer-toggle-on.png
timer-edit-form.png
timer-delete-confirm.png
timer-error-offline.png
timer-mobile.png
timer-dark-theme.png
```

### SOAP Mock Pattern
```typescript
// Intercept device SOAP calls
await page.route('**/upnp/control/rules1', async (route) => {
  const body = await route.request().postData();
  if (body?.includes('FetchRules')) {
    // Return mock rules DB (pre-built ZIP with timers)
    await route.fulfill({ body: mockFetchRulesResponse });
  } else if (body?.includes('StoreRules')) {
    // Capture and verify the stored DB
    capturedStoreBody = body;
    await route.fulfill({ body: mockStoreRulesResponse });
  }
});
```

## Implementation Order
1. Fix SOAP body encoding in `storeRulesDb()` (Bug 2 — most critical)
2. Fix toggle CSS (Bug 1)
3. Add debug logging to rules module
4. Set up Playwright + SOAP mocking infrastructure
5. Implement all 10 E2E test suites
6. Run tests, capture screenshots, verify all pass
7. Commit on `feature/timer-schedules` branch
