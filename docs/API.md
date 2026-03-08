# REST API Documentation

The Open Wemo Bridge exposes a REST API for device management and control.

## Base URL

```
http://<bridge-ip>:51515/api
```

The bridge IP is typically your computer's local IP address (e.g., `192.168.1.100`).

## Response Format

All responses are JSON with a consistent structure:

**Success:**
```json
{
  "devices": [...],
  "device": {...}
}
```

**Error:**
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

## Endpoints

### Devices

#### List All Devices

```http
GET /api/devices
GET /api/devices?includeState=true
```

Lists all saved devices. Optionally includes current state (slower, requires polling each device).

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| includeState | boolean | false | Poll current state for each device |

**Response:**
```json
{
  "devices": [
    {
      "id": "uuid:Socket-1_0-XXXXX",
      "name": "Living Room Lamp",
      "deviceType": "Switch",
      "host": "192.168.1.50",
      "port": 49153,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

With `includeState=true`:
```json
{
  "devices": [
    {
      "id": "uuid:Socket-1_0-XXXXX",
      "name": "Living Room Lamp",
      "deviceType": "Switch",
      "host": "192.168.1.50",
      "port": 49153,
      "isOnline": true,
      "state": 1,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

---

#### Get Device

```http
GET /api/devices/:id
```

Gets a single device by ID with current state.

**Response:**
```json
{
  "device": {
    "id": "uuid:Socket-1_0-XXXXX",
    "name": "Living Room Lamp",
    "deviceType": "Switch",
    "host": "192.168.1.50",
    "port": 49153,
    "isOnline": true,
    "state": 1,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Errors:**
- `404` - Device not found

---

#### Add Device

```http
POST /api/devices
```

Adds a new device or updates an existing one.

**Request Body:**
```json
{
  "name": "Living Room Lamp",
  "host": "192.168.1.50",
  "port": 49153,
  "deviceType": "Switch"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | Yes | - | Display name |
| host | string | Yes | - | Device IP address |
| port | number | No | 49153 | Device port |
| deviceType | string | No | "Switch" | Device type |
| id | string | No | auto | Device ID (auto-discovered if omitted) |

**Response:**
```json
{
  "device": { ... },
  "created": true
}
```

**Errors:**
- `400` - Missing required fields

---

#### Update Device

```http
PATCH /api/devices/:id
```

Updates device properties.

**Request Body:**
```json
{
  "name": "New Name",
  "host": "192.168.1.51",
  "port": 49154
}
```

All fields are optional. Only provided fields are updated.

**Response:**
```json
{
  "device": { ... }
}
```

**Errors:**
- `404` - Device not found

---

#### Delete Device

```http
DELETE /api/devices/:id
```

Removes a device from the database.

**Response:**
```json
{
  "deleted": true,
  "id": "uuid:Socket-1_0-XXXXX"
}
```

**Errors:**
- `404` - Device not found

---

### Device Control

#### Get Device State

```http
GET /api/devices/:id/state
```

Gets the current state of a device.

**Response:**
```json
{
  "id": "uuid:Socket-1_0-XXXXX",
  "state": 1,
  "isOn": true,
  "isStandby": false
}
```

**State Values:**
| Value | Meaning |
|-------|---------|
| 0 | Off |
| 1 | On |
| 8 | Standby (Insight only) |

**Errors:**
- `404` - Device not found
- `503` - Device offline

---

#### Turn Device On

```http
POST /api/devices/:id/on
```

Turns the device on.

**Response:**
```json
{
  "id": "uuid:Socket-1_0-XXXXX",
  "action": "on",
  "state": 1,
  "isOn": true
}
```

**Errors:**
- `404` - Device not found
- `503` - Device offline

---

#### Turn Device Off

```http
POST /api/devices/:id/off
```

Turns the device off.

**Response:**
```json
{
  "id": "uuid:Socket-1_0-XXXXX",
  "action": "off",
  "state": 0,
  "isOn": false
}
```

**Errors:**
- `404` - Device not found
- `503` - Device offline

---

#### Toggle Device

```http
POST /api/devices/:id/toggle
```

Toggles the device state (on→off or off→on).

**Response:**
```json
{
  "id": "uuid:Socket-1_0-XXXXX",
  "action": "toggle",
  "state": 0,
  "isOn": false
}
```

**Errors:**
- `404` - Device not found
- `503` - Device offline

---

### Insight Power Monitoring

#### Get Power Data

```http
GET /api/devices/:id/insight
```

Gets power monitoring data for Insight devices.

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "power": {
    "isOn": true,
    "isStandby": false,
    "currentWatts": 12.3,
    "todayKwh": 0.456,
    "totalKwh": 12.345,
    "onForFormatted": "1h",
    "onTodayFormatted": "2h"
  },
  "raw": "1|1705312200|3600|7200|86400|155|12300|27360|740700|8000"
}
```

**Power Data Fields:**
| Field | Type | Description |
|-------|------|-------------|
| isOn | boolean | Whether device is on |
| isStandby | boolean | Whether device is in standby mode |
| currentWatts | number | Current power draw in watts |
| todayKwh | number | Energy used today in kWh |
| totalKwh | number | Total energy used in kWh |
| onForFormatted | string | Time on this session (e.g., "2h 30m") |
| onTodayFormatted | string | Time on today (e.g., "5h 15m") |

**Errors:**
- `404` - Device not found
- `400` - Device does not support Insight
- `503` - Device offline

---

### Timer Schedules

#### List Timers

```http
GET /api/devices/:id/timers
```

Gets all timer rules for a device.

**Response:**
```json
{
  "timers": [
    {
      "ruleId": 501,
      "name": "Morning On",
      "startTime": 25200,
      "endTime": 28800,
      "startAction": 1,
      "endAction": 0,
      "dayId": -1,
      "enabled": true
    }
  ],
  "dbVersion": 42
}
```

**Timer Fields:**
| Field | Type | Description |
|-------|------|-------------|
| ruleId | number | Unique rule identifier |
| name | string | Timer rule name |
| startTime | number | Start time in seconds from midnight (0-86400) |
| endTime | number | End time in seconds from midnight (optional) |
| startAction | number | Action at start: 0=Off, 1=On |
| endAction | number | Action at end: 0=Off, 1=On, -1=None (optional) |
| dayId | number | Day: -1=Every day, 0=Sunday, 1=Monday, ..., 6=Saturday |
| enabled | boolean | Whether rule is active |

**Time Format:**
Times are in seconds from midnight (0-86400):
- 00:00 = 0
- 07:00 = 25200
- 14:30 = 52200
- 23:59 = 86340

**Errors:**
- `404` - Device not found
- `503` - Device offline

---

#### Create Timer

```http
POST /api/devices/:id/timers
```

Creates a new timer rule.

**Request Body:**
```json
{
  "name": "Evening Off",
  "startTime": 79200,
  "startAction": 0,
  "dayId": -1,
  "endTime": 25200,
  "endAction": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Timer rule name |
| startTime | number | Yes | Start time (0-86400 seconds from midnight) |
| startAction | number | Yes | Action at start: 0=Off, 1=On |
| dayId | number | Yes | Day: -1=Every day, 0-6=Day of week |
| endTime | number | No | End time (0-86400 seconds from midnight) |
| endAction | number | No | Action at end: 0=Off, 1=On, -1=None |

**Response:**
```json
{
  "timer": {
    "ruleId": 502,
    "name": "Evening Off",
    "startTime": 79200,
    "endTime": 25200,
    "startAction": 0,
    "endAction": 1,
    "dayId": -1,
    "enabled": true
  }
}
```

**Errors:**
- `400` - Missing or invalid fields
- `404` - Device not found
- `503` - Device offline

---

#### Update Timer

```http
PATCH /api/devices/:id/timers/:ruleId
```

Updates an existing timer rule.

**Request Body:**
```json
{
  "name": "Updated Name",
  "startTime": 28800,
  "enabled": false
}
```

All fields are optional. Only provided fields are updated.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Timer rule name |
| startTime | number | Start time (0-86400 seconds from midnight) |
| endTime | number | End time (0-86400 seconds from midnight) |
| startAction | number | Action at start: 0=Off, 1=On |
| endAction | number | Action at end: 0=Off, 1=On, -1=None |
| dayId | number | Day: -1=Every day, 0-6=Day of week |
| enabled | boolean | Whether rule is active |

**Response:**
```json
{
  "timer": {
    "ruleId": 502,
    "name": "Updated Name",
    "startTime": 28800,
    "endTime": 25200,
    "startAction": 0,
    "endAction": 1,
    "dayId": -1,
    "enabled": false
  }
}
```

**Errors:**
- `400` - Invalid fields
- `404` - Device not found
- `503` - Device offline

---

#### Delete Timer

```http
DELETE /api/devices/:id/timers/:ruleId
```

Deletes a timer rule.

**Response:**
```json
{
  "deleted": true,
  "ruleId": 502
}
```

**Errors:**
- `400` - Invalid ruleId
- `404` - Device not found
- `503` - Device offline

---

#### Toggle Timer State

```http
PATCH /api/devices/:id/timers/:ruleId/toggle
```

Toggles the enabled state of a timer rule.

**Request Body:**
```json
{
  "enabled": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| enabled | boolean | Yes | New enabled state |

**Response:**
```json
{
  "timer": {
    "ruleId": 501,
    "name": "Morning On",
    "startTime": 25200,
    "endTime": 28800,
    "startAction": 1,
    "endAction": 0,
    "dayId": -1,
    "enabled": false
  }
}
```

**Errors:**
- `400` - Missing or invalid enabled field
- `404` - Device not found
- `503` - Device offline

---

### Standby Threshold

#### Get Standby Threshold

```http
GET /api/devices/:id/threshold
```

Gets the standby power threshold for an Insight device.

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "thresholdWatts": 8.0,
  "thresholdMilliwatts": 8000
}
```

**Threshold Fields:**
| Field | Type | Description |
|-------|------|-------------|
| id | string | Device ID |
| thresholdWatts | number | Threshold in watts (0-50) |
| thresholdMilliwatts | number | Threshold in milliwatts |

**Errors:**
- `400` - Device does not support Insight
- `404` - Device not found
- `503` - Device offline

---

#### Set Standby Threshold

```http
PUT /api/devices/:id/threshold
```

Sets the standby power threshold for an Insight device. When power draw falls below this threshold, the device enters standby mode (state 8).

**Request Body:**
```json
{
  "watts": 10.0
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| watts | number | Yes | Threshold in watts (0-50) |

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "thresholdWatts": 10.0,
  "thresholdMilliwatts": 10000
}
```

**Errors:**
- `400` - Invalid watts value (must be 0-50)
- `400` - Device does not support Insight
- `404` - Device not found
- `503` - Device offline

---

#### Reset Standby Threshold

```http
POST /api/devices/:id/threshold/reset
```

Resets the standby power threshold to the device default (8 watts).

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "thresholdWatts": 8.0,
  "thresholdMilliwatts": 8000
}
```

**Errors:**
- `400` - Device does not support Insight
- `404` - Device not found
- `503` - Device offline

---

### Keep-Alive (LED Mode)

#### Get Keep-Alive Status

```http
GET /api/devices/:id/keepalive
```

Gets the keep-alive (LED Mode) status for a device.

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "enabled": false
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| id | string | Device ID |
| enabled | boolean | Whether keep-alive is active |

**Errors:**
- `404` - Device not found

---

#### Enable/Disable Keep-Alive

```http
PUT /api/devices/:id/keepalive
```

Enables or disables keep-alive (LED Mode) for a device. When enabled, Open Wemo also adjusts the Insight auto-off and display thresholds so low-power loads stay in normal "On" mode instead of falling into standby behavior. The keep-alive only protects devices after the user has turned them on; enabling LED Mode does not turn an intentionally off device back on.

**Request Body:**
```json
{
  "enabled": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| enabled | boolean | Yes | Enable or disable keep-alive |

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "enabled": true
}
```

**Errors:**
- `400` - Invalid enabled (must be boolean)
- `404` - Device not found

---

### Insight Diagnostics

#### Get Insight Diagnostics

```http
GET /api/devices/:id/insight/diagnostics
```

Gets comprehensive diagnostics for an Insight device including power state, thresholds, and all device rules.

**Response:**
```json
{
  "id": "uuid:Insight-1_0-XXXXX",
  "insight": {
    "state": 1,
    "stateLabel": "on",
    "instantPowerMilliwatts": 26000,
    "instantPowerWatts": 26.0,
    "reportedThresholdMilliwatts": 500,
    "reportedThresholdWatts": 0.5,
    "power": {
      "isOn": true,
      "currentWatts": 26.0,
      "todayKwh": 0.123
    }
  },
  "threshold": {
    "milliwatts": 500,
    "watts": 0.5
  },
  "rules": {
    "dbVersion": 42,
    "totalCount": 1,
    "timerCount": 1,
    "nonTimerCount": 0,
    "all": []
  }
}
```

**Errors:**
- `400` - Device does not support Insight
- `404` - Device not found
- `503` - Device offline

---

### Discovery

#### Discover Devices

```http
GET /api/discover
GET /api/discover?timeout=5000
```

Scans the local network for WeMo devices using SSDP.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| timeout | number | 5 | Discovery timeout in seconds (max: 30) |

**Response:**
```json
{
  "devices": [
    {
      "id": "uuid:Socket-1_0-XXXXX",
      "name": "WeMo Switch",
      "deviceType": "Switch",
      "host": "192.168.1.50",
      "port": 49153,
      "manufacturer": "Belkin International Inc.",
      "model": "Socket",
      "serialNumber": "XXXXX",
      "firmwareVersion": "WeMo_WW_2.00.11452.PVT-OWRT-SNSV2"
    }
  ],
  "count": 1,
  "elapsed": 5023
}
```

---

## Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | VALIDATION_ERROR | Missing or invalid request parameters |
| 400 | INSIGHT_NOT_SUPPORTED | Device does not support Insight features |
| 404 | DEVICE_NOT_FOUND | Device ID not found in database |
| 500 | INTERNAL_ERROR | Unexpected server error |
| 503 | DEVICE_OFFLINE | Device not reachable on network |
| 503 | RULES_FETCH_ERROR | Failed to fetch timer rules from device |
| 503 | RULES_STORE_ERROR | Failed to store timer rules to device |

---

## Examples

### cURL

```bash
# List devices
curl http://192.168.1.100:51515/api/devices

# Turn on a device
curl -X POST http://192.168.1.100:51515/api/devices/uuid:Socket-1_0-XXXXX/on

# Discover devices
curl http://192.168.1.100:51515/api/discover?timeout=10000

# Add a device manually
curl -X POST http://192.168.1.100:51515/api/devices \
  -H "Content-Type: application/json" \
  -d '{"name": "Kitchen Light", "host": "192.168.1.51"}'

# List timers for a device
curl http://192.168.1.100:51515/api/devices/uuid:Socket-1_0-XXXXX/timers

# Create a timer (turn on at 7:00 AM every day)
curl -X POST http://192.168.1.100:51515/api/devices/uuid:Socket-1_0-XXXXX/timers \
  -H "Content-Type: application/json" \
  -d '{"name": "Morning On", "startTime": 25200, "startAction": 1, "dayId": -1}'

# Delete a timer
curl -X DELETE http://192.168.1.100:51515/api/devices/uuid:Socket-1_0-XXXXX/timers/501

# Get standby threshold
curl http://192.168.1.100:51515/api/devices/uuid:Insight-1_0-XXXXX/threshold

# Set standby threshold to 10 watts
curl -X PUT http://192.168.1.100:51515/api/devices/uuid:Insight-1_0-XXXXX/threshold \
  -H "Content-Type: application/json" \
  -d '{"watts": 10.0}'

# Get keep-alive status
curl http://192.168.1.100:51515/api/devices/uuid:Insight-1_0-XXXXX/keepalive

# Enable keep-alive (LED Mode)
curl -X PUT http://192.168.1.100:51515/api/devices/uuid:Insight-1_0-XXXXX/keepalive \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Get Insight diagnostics
curl http://192.168.1.100:51515/api/devices/uuid:Insight-1_0-XXXXX/insight/diagnostics
```

### JavaScript

```javascript
const API = 'http://192.168.1.100:51515/api';

// List devices with state
const { devices } = await fetch(`${API}/devices?includeState=true`)
  .then(r => r.json());

// Toggle a device
const result = await fetch(`${API}/devices/${deviceId}/toggle`, {
  method: 'POST'
}).then(r => r.json());

// Get power data
const { power } = await fetch(`${API}/devices/${deviceId}/insight`)
  .then(r => r.json());

// List timers
const { timers } = await fetch(`${API}/devices/${deviceId}/timers`)
  .then(r => r.json());

// Create a timer (turn on at 7:00 AM every day)
const { timer } = await fetch(`${API}/devices/${deviceId}/timers`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Morning On',
    startTime: 25200, // 7:00 AM = 7 * 3600 seconds
    startAction: 1,   // 1 = On
    dayId: -1         // -1 = Every day
  })
}).then(r => r.json());

// Toggle timer enabled state
const result = await fetch(`${API}/devices/${deviceId}/timers/${ruleId}/toggle`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled: false })
}).then(r => r.json());

// Get standby threshold
const { thresholdWatts } = await fetch(`${API}/devices/${deviceId}/threshold`)
  .then(r => r.json());

// Set standby threshold
const result = await fetch(`${API}/devices/${deviceId}/threshold`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ watts: 10.0 })
}).then(r => r.json());

// Get keep-alive status
const { enabled } = await fetch(`${API}/devices/${deviceId}/keepalive`)
  .then(r => r.json());

// Enable keep-alive (LED Mode)
const result = await fetch(`${API}/devices/${deviceId}/keepalive`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled: true })
}).then(r => r.json());

// Get diagnostics
const diagnostics = await fetch(`${API}/devices/${deviceId}/insight/diagnostics`)
  .then(r => r.json());
```
