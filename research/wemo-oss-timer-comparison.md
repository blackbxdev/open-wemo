# Wemo Open-Source Timer/Schedule/Rule Management — Comparison Research

**Date:** 2026-02-21
**Purpose:** Understand how existing OSS projects implement Wemo timer/schedule/rule CRUD to inform open-wemo development.

---

## Executive Summary

**The Wemo rules system is NOT a simple SOAP-based timer API.** It's a SQLite database stored on the device, transferred as a base64-encoded zip file over SOAP. Only **pywemo** has deep rules support. The other projects (wemo-client, homebridge-wemo, ouimeaux) do **not** implement timer/schedule/rule management at all.

---

## 1. pywemo (Python) — ⭐ THE reference implementation

**Repo:** https://github.com/pywemo/pywemo
**Rules support:** YES — full CRUD via SQLite database manipulation
**Used by:** Home Assistant's wemo integration

### Architecture: How Rules Actually Work

Wemo devices store rules in an **on-device SQLite database**. The workflow is:

1. **Fetch** the rules DB via SOAP: `FetchRules()` → returns `ruleDbVersion` + `ruleDbPath` (URL)
2. **Download** the DB file from `ruleDbPath` (HTTP GET)
3. **Unpack**: the file is a **ZIP containing a SQLite .db file** (`temppluginRules.db`)
4. **Modify** the SQLite database directly using SQL
5. **Repack**: ZIP + base64-encode the modified DB
6. **Upload** via SOAP: `StoreRules(ruleDbVersion=N+1, processDb=1, ruleDbBody="<![CDATA[<base64>]]>")`

### SOAP Actions (Service: `urn:Belkin:service:rules:1`)

```
FetchRules()        → { ruleDbVersion, ruleDbPath }
StoreRules(ruleDbVersion, processDb, ruleDbBody)
GetRules()
SetRules()
GetRulesDBPath()
GetRulesDBVersion()
SetRulesDBVersion()
DeleteRuleID()
SetRuleID()
GetTemplates()
SetTemplates()
EditWeeklycalendar()
UpdateWeeklyCalendar()
DeleteWeeklyCalendar()
SimulatedRuleData()
```

### SQLite Database Schema

**RULES table:**
```sql
CREATE TABLE RULES(
    RuleID PRIMARY KEY,        -- integer, manually assigned (max existing + 1)
    Name TEXT NOT NULL,        -- e.g. "Living Room Long Press Rule"
    Type TEXT NOT NULL,        -- "Long Press", "Timer", "Simple" etc.
    RuleOrder INTEGER,
    StartDate TEXT,            -- "12201982" (MMDDYYYY format)
    EndDate TEXT,              -- "07301982"
    State TEXT,                -- "1" = enabled, "0" = disabled
    Sync INTEGER               -- contains string "NOSYNC"
);
```

**RULEDEVICES table** (the trigger/schedule config):
```sql
CREATE TABLE RULEDEVICES(
    RuleDevicePK INTEGER PRIMARY KEY AUTOINCREMENT,
    RuleID INTEGER,            -- FK to RULES.RuleID
    DeviceID TEXT,             -- UDN of the device (e.g. "uuid:Socket-1_0-XXX")
    GroupID INTEGER,
    DayID INTEGER,             -- bitmask for days: -1 = all days, specific values for individual days
    StartTime INTEGER,         -- seconds from midnight (e.g. 60 = 00:01:00)
    RuleDuration INTEGER,      -- duration in seconds (e.g. 86340 = 23:59:00)
    StartAction REAL,          -- 1.0 = ON, 0.0 = OFF, 2.0 = TOGGLE
    EndAction REAL,            -- action at end of duration, -1.0 = none
    SensorDuration INTEGER,
    Type INTEGER,
    Value INTEGER,
    Level INTEGER,
    ZBCapabilityStart TEXT,
    ZBCapabilityEnd TEXT,
    OnModeOffset INTEGER,
    OffModeOffset INTEGER,
    CountdownTime INTEGER,     -- countdown timer in seconds
    EndTime INTEGER            -- seconds from midnight (e.g. 86400 = end of day)
);
```

**TARGETDEVICES table** (which devices the rule acts on):
```sql
CREATE TABLE TARGETDEVICES(
    TargetDevicesPK INTEGER PRIMARY KEY AUTOINCREMENT,
    RuleID INTEGER,
    DeviceID TEXT,             -- UDN of target device
    DeviceIndex INTEGER
);
```

**Other tables:** DEVICECOMBINATION, GROUPDEVICES, LOCATIONINFO, BLOCKEDRULES, RULESNOTIFYMESSAGE, SENSORNOTIFICATION

### Code Example: Creating a Long Press Rule (from pywemo)

```python
from pywemo.ouimeaux_device.api.rules_db import (
    RulesRow, RuleDevicesRow, rules_db_from_device
)

# Context manager handles fetch → unpack → modify → repack → upload
with rules_db_from_device(device) as rules_db:
    # Create rule
    new_rule = RulesRow(
        Name="Living Room Long Press Rule",
        Type="Long Press",
        RuleOrder=0,
        StartDate="12201982",
        EndDate="07301982",
        State="1",
        Sync="NOSYNC",
    )
    rules_db.add_rule(new_rule)  # auto-assigns RuleID = max + 1
    
    # Add trigger device config
    rules_db.add_rule_devices(RuleDevicesRow(
        RuleID=new_rule.RuleID,
        DeviceID="uuid:Socket-1_0-XXXXXXXXXXXX",
        GroupID=0,
        DayID=-1,           # all days
        StartTime=60,       # 1 minute past midnight
        RuleDuration=86340, # ~24 hours
        StartAction=2.0,    # TOGGLE
        EndAction=-1.0,     # no end action
        SensorDuration=-1,
        Type=-1,
        Value=-1,
        Level=-1,
        ZBCapabilityStart="",
        ZBCapabilityEnd="",
        OnModeOffset=-1,
        OffModeOffset=-1,
        CountdownTime=-1,
        EndTime=86400,
    ))
    
    # Add target device
    rules_db.add_target_device_to_rule(
        new_rule, "uuid:Socket-1_0-TARGETDEVICE"
    )
# Context manager exit: if modified, commits, zips, base64-encodes, 
# calls StoreRules with version+1
```

### Key Gotchas from pywemo

1. **RuleID assignment**: Manual — `max(existing_ids) + 1`. No auto-increment.
2. **StartDate/EndDate**: Use "MMDDYYYY" format with seemingly arbitrary dates ("12201982", "07301982")
3. **State field**: String "1" or "0" despite being logically boolean
4. **Sync field**: Declared as INTEGER in SQLite but contains the string "NOSYNC"
5. **DayID**: -1 means all days. Specific day encoding is a bitmask.
6. **Time format**: Seconds from midnight (0-86400)
7. **StartAction values**: 0.0=OFF, 1.0=ON, 2.0=TOGGLE (float, not int)
8. **The DB versioning is critical**: Must increment `ruleDbVersion` each time you store, or device may reject/ignore
9. **Empty DB handling**: If `FetchRules` returns a URL that 404s, create a new empty DB from scratch
10. **ZIP inner filename**: Must be `temppluginRules.db` for new databases
11. **CDATA wrapper**: The base64 body must be wrapped in `<![CDATA[...]]>` (HTML-entity-encoded as `&lt;![CDATA[...]]&gt;`)
12. **Device thread limit**: WeMo devices have very few HTTP threads. Too many rapid requests will crash the device.

### Rule Types (observed)

| Type | Description |
|------|-------------|
| `"Long Press"` | Triggered by 2-second button press |
| `"Timer"` | Scheduled on/off timer |
| `"Simple"` | Basic toggle rule |

---

## 2. wemo-client (Node.js) — ❌ No rules/timer support

**Repo:** https://github.com/timonreinhard/wemo-client
**Rules support:** NO

wemo-client is a basic SSDP discovery + UPnP event subscription library. It supports only:
- `SetBinaryState` / `GetBinaryState` (on/off)
- `SetBrightness` / `GetBrightness` (dimmers)
- `SetAttributes` / `GetAttributes` (device events)
- `SetDeviceStatus` / `GetDeviceStatus` (bridge/light control)
- UPnP event subscriptions (BinaryState, InsightParams, StatusChange, attributeList)

**No rules service interaction whatsoever.** The `soapAction()` method is generic enough to call any SOAP action, but no timer/schedule/rule methods are exposed.

### Services it uses:
- `urn:Belkin:service:basicevent:1` — on/off, brightness
- `urn:Belkin:service:bridge:1` — linked bulb control
- `urn:Belkin:service:insight:1` — power monitoring
- `urn:Belkin:service:deviceevent:1` — attributes

---

## 3. homebridge-wemo — ❌ No rules/timer support

**Repo:** https://github.com/bwp91/homebridge-wemo (now at homebridge-plugins/homebridge-wemo)
**Rules support:** NO

homebridge-wemo is a Homebridge plugin that exposes Wemo devices as HomeKit accessories. It handles:
- SSDP discovery
- UPnP SUBSCRIBE for event notifications
- SOAP calls for state control (`SetBinaryState`, `GetBinaryState`, etc.)
- Device types: Switch, Dimmer, Insight, Motion, Maker, Coffee, Crockpot, Humidifier, Heater, Light bulbs

**No schedule/timer/rule management.** Schedules would be handled through HomeKit automations instead.

### SOAP pattern (same as all projects):
```javascript
// Generic SOAP envelope builder
xmlbuilder.create('s:Envelope')
  .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
  .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
  .ele('s:Body')
  .ele(`u:${action}`)
  .att('xmlns:u', serviceType)
```

---

## 4. ouimeaux (Python) — ❌ No rules/timer support

**Repo:** https://github.com/iancmcc/ouimeaux
**Rules support:** NO
**Status:** Abandoned/unmaintained (pywemo is its successor)

ouimeaux is the original Python Wemo library. It provides basic device discovery and control:
- SSDP discovery
- Service/action introspection (the `explain()` method)
- `GetBinaryState` / `SetBinaryState`

**No rules implementation.** The codebase is minimal — the entire Device class is ~100 lines. It builds services dynamically from the device's XML service description, so you *could* call rules actions, but nothing is built for it.

---

## 5. Home Assistant Wemo Integration

**Rules support:** NO (explicitly)

Home Assistant uses pywemo as its backend library. However, the HA integration itself only uses pywemo for:
- Device discovery (SSDP)
- State polling and control
- UPnP subscriptions for push updates
- Long press support (via pywemo's rules_db)

**Schedules/timers are handled through HA's own automation system**, not through Wemo's on-device rules. The integration does not expose any schedule CRUD to the user.

---

## 6. Full List of Wemo SOAP Services & Actions (from pywemo type stubs)

### `urn:Belkin:service:rules:1` — The Rules Service
```
FetchRules           — Get DB version + download URL
StoreRules           — Upload modified DB
GetRules             — Unknown XML-based alternative?
SetRules             — Unknown XML-based alternative?
GetRulesDBPath       — Just the path
GetRulesDBVersion    — Just the version
SetRulesDBVersion    — Set version
DeleteRuleID         — Delete by ID (XML method, not DB method)
SetRuleID            — Set by ID (XML method, not DB method)
GetTemplates         — Rule templates
SetTemplates         — Rule templates
EditWeeklycalendar   — Weekly calendar editing
UpdateWeeklyCalendar — Weekly calendar update
DeleteWeeklyCalendar — Weekly calendar delete
SimulatedRuleData    — For simulated/away mode
```

### `urn:Belkin:service:basicevent:1` — Notable rule-related actions
```
GetRuleOverrideStatus    — Check if rules are overridden
GetSimulatedRuleData     — Away mode simulation data
SetAwayRuleTask          — Configure away mode
```

### `urn:Belkin:service:timesync:1` — Time synchronization
```
GetDeviceTime    — Get device clock
GetTime          — Get time
TimeSync         — Sync device clock
```

---

## 7. Two Approaches to Rules Management

Based on the SOAP actions available, there appear to be **two different APIs** for managing rules:

### Approach A: SQLite Database (what pywemo uses)
- `FetchRules()` → download SQLite DB
- Modify DB directly
- `StoreRules()` → upload modified DB
- **Pros:** Full control, well-understood via pywemo
- **Cons:** Complex (zip/unzip, base64, version management)

### Approach B: XML-based SOAP (less documented)
- `SetRuleID()` / `DeleteRuleID()` — individual rule CRUD
- `GetRules()` / `SetRules()` — bulk rule operations
- `EditWeeklycalendar()` / `UpdateWeeklyCalendar()` / `DeleteWeeklyCalendar()`
- **Pros:** Simpler if it works, no SQLite manipulation needed
- **Cons:** Undocumented, no known OSS project uses these
- **Note:** The XML format for these actions is unknown. Would need packet capture to reverse-engineer.

---

## 8. Reverse-Engineering Notes & Community Knowledge

### What the Wemo App Does
The official Wemo app creates schedules through the same SQLite DB mechanism. When you create a timer in the app, it:
1. Fetches the current DB
2. Inserts rows into RULES + RULEDEVICES + TARGETDEVICES
3. Stores the modified DB back

### DayID Encoding (Timer Schedules)
Based on analysis of pywemo and community reports:
- `-1` = every day
- Individual days likely use a bitmask:
  - `1` = Sunday, `2` = Monday, `4` = Tuesday, `8` = Wednesday
  - `16` = Thursday, `32` = Friday, `64` = Saturday
  - `127` = all days (alternative to -1)
- **Needs verification via packet capture**

### CountdownTime Field
- Used for countdown timers (e.g., "turn off in 30 minutes")
- Value is in seconds
- `-1` = not a countdown timer

### Known Rule Types (from community + app analysis)
| Type Value | Description |
|-----------|-------------|
| `"Long Press"` | Physical button long press |
| `"Timer"` | Scheduled on/off |
| `"Simple"` | Basic on/off rule |
| `"Away"` | Away mode simulation |
| `"Sunrise"` | Sunrise-triggered |
| `"Sunset"` | Sunset-triggered |

### Sunrise/Sunset Rules
Sunrise/sunset rules use the `LOCATIONINFO` table (latitude/longitude) and `OnModeOffset`/`OffModeOffset` fields in RULEDEVICES for time offsets.

---

## 9. Recommendations for open-wemo

### Use the SQLite DB approach (Approach A)
This is the only well-tested path. pywemo has years of production usage via Home Assistant.

### Implementation Pattern
```
1. GET  /rules                  → FetchRules() → download DB → list all rules
2. POST /rules                  → FetchRules() → download DB → insert → StoreRules()
3. PUT  /rules/:id              → FetchRules() → download DB → update → StoreRules()
4. DELETE /rules/:id            → FetchRules() → download DB → delete → StoreRules()
```

### Critical Implementation Details
1. **Always fetch-modify-store**: Never cache the DB; always get fresh copy
2. **Version increment**: Must increment `ruleDbVersion` on every store
3. **processDb=1**: Must set this flag for device to process the new DB
4. **CDATA encoding**: Base64 body wrapped in entity-encoded CDATA
5. **Rate limiting**: Don't hammer the device — it has ~2-3 HTTP threads
6. **Countdown timers**: Set `CountdownTime` field, Type might differ
7. **Device UDN**: Each device identifies itself by UDN (e.g., `uuid:Socket-1_0-XXXX`)

### Also Investigate (Approach B)
The XML-based `SetRuleID`/`DeleteRuleID` calls might be simpler for single-rule operations. Worth packet-capturing the Wemo app to see if it uses these for quick operations like enabling/disabling a single rule.

---

## 10. Reference: SOAP Request Template

All Wemo SOAP calls use this envelope:

```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:FetchRules xmlns:u="urn:Belkin:service:rules:1">
    </u:FetchRules>
  </s:Body>
</s:Envelope>
```

With SOAPACTION header: `"urn:Belkin:service:rules:1#FetchRules"`

### StoreRules Call
```xml
<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:StoreRules xmlns:u="urn:Belkin:service:rules:1">
      <ruleDbVersion>42</ruleDbVersion>
      <processDb>1</processDb>
      <ruleDbBody>&lt;![CDATA[UEsDBBQAAAAI...base64...==]]&gt;</ruleDbBody>
    </u:StoreRules>
  </s:Body>
</s:Envelope>
```
