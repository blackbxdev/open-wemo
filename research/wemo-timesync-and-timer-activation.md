# WeMo TimeSync & Timer Activation — Research Findings

## TimeSync Parameter Format (CRITICAL)

### Timezone: MUST be formatted string, not integer

**Source**: ouimeaux (working Python WeMo library)
- File: `ouimeaux/utils.py` lines 11-14
- URL: https://github.com/iancmcc/ouimeaux/blob/bc3c299dd275a420cba150e51b2566b150b9dc24/ouimeaux/utils.py#L11-L14

```python
def tz_hours():
    delta = time.localtime().tm_hour - time.gmtime().tm_hour
    sign = '-' if delta < 0 else ''
    return "%s%02d.00" % (sign, abs(delta))
```

**Correct format examples:**
- MST (UTC-7): `"-07.00"`
- EST (UTC-5): `"-05.00"`
- IST (UTC+5:30): `"05.30"` (half-hour offsets use decimal)
- UTC: `"00.00"`

**Our bug**: We sent `-7` (integer) and before that `"-0700"` (ISO-style string).
The device silently accepts any format (returns HTTP 200) but ignores invalid values.

### All TimeSync Parameters

```xml
<UTC>1740359456</UTC>           <!-- Unix timestamp seconds -->
<TimeZone>-07.00</TimeZone>    <!-- Zero-padded hours with .00 decimal -->
<dst>0</dst>                    <!-- 0 or 1 -->
<DstSupported>1</DstSupported>  <!-- Always 1 -->
```

### GetTime vs GetDeviceTime

- `GetTime`: Listed in SCPD but returns UPnPError on Insight firmware
- `GetDeviceTime`: NOT in our device's SCPD — not available on WeMo_WW_2.00.11532
- **Neither works for clock verification on our device**

### Alternative Clock Verification

InsightParams.lastChange is a device-side Unix timestamp set when state changes.
Toggle device state → immediately read InsightParams → compare lastChange to server UTC.

---

## Timer Activation: Two Parallel Systems

### System 1: StoreRules + processDb (Modern, SQLite-based)

**Source**: pywemo rules_db.py
- URL: https://github.com/pywemo/pywemo/blob/a211bd54fa99b2e053924b0c73caee6d7319232c/pywemo/ouimeaux_device/api/rules_db.py#L412-L416

```python
device.rules.StoreRules(
    ruleDbVersion=version + 1,
    processDb=1,
    ruleDbBody="&lt;![CDATA[" + body + "]]&gt;",
)
```

- `processDb=1` tells firmware to parse DB and activate rules
- Used by pywemo for Long Press rules (ONLY working OSS implementation)
- pywemo does NOT call UpdateWeeklyCalendar, SetRuleID, or EditWeeklycalendar
- Firmware >= 2.00.11000 primarily uses this system

### System 2: UpdateWeeklyCalendar (Legacy, string-based)

**SCPD format**: `NumberOfTimers|time,action|time,action|...`
- time = seconds from midnight
- action = 0 (OFF) or 1 (ON)
- Per-day arguments: Mon, Tues, Wed, Thurs, Fri, Sat, Sun

Used by older firmware. May still work on newer firmware but unclear.
The SCPD comment on EditWeeklycalendar says:
> "now only remove will be applied since app will manage all rules and store on device on other way"

This suggests the app (Belkin's) migrated to the StoreRules approach.

### What We've Tested

| Test | TimeSync TZ | StoreRules | UpdateWeeklyCalendar | Result |
|------|-------------|------------|---------------------|--------|
| 1    | "-0700"     | processDb=1 | No                 | No fire |
| 2    | -7 (int)    | processDb=1 | Yes (action=0 bug) | No fire |
| 3    | -7 (int)    | processDb=1 | No                 | No fire |
| 4    | -7 (int)    | processDb=1 | Yes (action=1 OK)  | No fire |
| 5    | "-07.00"    | processDb=1 | ???                | UNTESTED |

**ALL tests had wrong timezone format.** The correct format has never been tested.

---

## Key pywemo Implementation Details

### Rule Database Schema (matches our implementation)

```
RULES: RuleID, Name, Type, RuleOrder, StartDate, EndDate, State, Sync
RULEDEVICES: RuleDevicePK, RuleID, DeviceID, GroupID, DayID, StartTime, 
             RuleDuration, StartAction, EndAction, SensorDuration, Type, 
             Value, Level, ZBCapabilityStart, ZBCapabilityEnd, 
             OnModeOffset, OffModeOffset, CountdownTime, EndTime
TARGETDEVICES: TargetDevicesPK, RuleID, DeviceID, DeviceIndex
```

### Long Press Rule Values (the ONLY working rule type in OSS)

```python
Rule:
  Type = "Long Press"
  StartDate = "12201982"
  EndDate = "07301982"
  State = "1"
  Sync = "NOSYNC"

RuleDevices:
  DayID = -1           # All days
  StartTime = 60       # 00:01
  RuleDuration = 86340
  StartAction = 2.0    # TOGGLE
  EndAction = -1.0
  EndTime = 86400      # 24:00
```

Timer rules would use Type="Timer" with specific StartTime values,
but NO OSS project has gotten timer rules to fire locally.

---

## Firmware Analysis

**Device**: WeMo Insight, firmware WeMo_WW_2.00.11532.PVT-OWRT-Insight
**Architecture**: OpenWrt-based (Linux, MIPS)

The firmware has an internal rule engine process that:
1. Receives rules.db via StoreRules SOAP action
2. If processDb=1, parses RULES + RULEDEVICES tables
3. For event rules (Long Press): listens for button events, looks up action
4. For timer rules: schedules execution based on StartTime + DayID
5. Executes actions via internal SetBinaryState calls

The timer scheduling depends on the device's internal clock,
which is set via TimeSync. If TimeSync parameters are wrong,
the clock is wrong and timers fire at incorrect times or never.
