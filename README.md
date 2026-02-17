# SonicWall ISP Status Dashboard

A real-time dashboard for monitoring WAN interface status on SonicWall firewalls. Tracks uptime/downtime and logs state change events.

<img src="docs/screenshot.png" alt="Dashboard Screenshot" width="600">

## Features

- Real-time WAN interface status (up/down)
- IP address, subnet, link speed display
- Uptime/downtime tracking
- Event log with duration history
- Two fetch methods: REST API or SNMP

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example env file and edit:

```bash
cp .env.local.example .env.local
```

### 3. Choose a Fetch Method

You can use either the SonicWall REST API or SNMP to fetch interface status.

---

## Method 1: REST API (Default)

Uses the SonicOS REST API. Requires admin credentials.

### SonicWall Configuration for REST API

#### Step 1: Enable the SonicOS API

1. Log into your SonicWall admin interface (https://your-sonicwall-ip)
2. Navigate to **Device → Settings → Administration**
3. Click on the **API** tab
4. Check the box for **Enable SonicOS API**
5. Optionally configure:
   - **Session Timeout**: How long API sessions stay active (default: 5 minutes)
   - **Token Timeout**: How long authentication tokens remain valid
6. Click **Accept** to save changes

#### Step 2: Create a Dedicated API User (Recommended)

For better security, create a dedicated read-only user for API access:

1. Navigate to **Device → Users → Local Users & Groups**
2. Click **Add User**
3. Configure the user:
   - **Name**: `api-monitor` (or your preference)
   - **Password**: Create a strong password
   - **User Type**: Select **Limited Administrator**
4. Under **Administrator Privileges**, grant only:
   - **Read-Only Access** to Network configuration
5. Click **Accept** to save

#### Step 3: Verify API Access

Test that the API is working by visiting:
```
https://your-sonicwall-ip/api/sonicos/reporting/interfaces
```

You should be prompted for credentials. Use your admin or API user credentials.

### Environment Variables

```env
FETCH_METHOD=api

SONICWALL_BASE_URL=https://10.10.10.1
SONICWALL_USERNAME=admin
SONICWALL_PASSWORD=your_password
SONICWALL_INSECURE_TLS=true
```

### Pros/Cons

- ✅ More detailed information (IP mode, comments)
- ❌ Requires admin credentials
- ❌ May interfere with admin sessions (reduced with our implementation)

---

## Method 2: SNMP (Recommended)

Uses SNMP to poll interface status. More reliable for monitoring.

### SonicWall Configuration for SNMP

#### Step 1: Enable SNMP on the SonicWall

1. Log into your SonicWall admin interface (https://your-sonicwall-ip)
2. Navigate to **Device → Settings → SNMP**
3. Check the box for **Enable SNMP**

#### Step 2: Configure SNMP System Information

Fill in the system information fields:

| Field | Description | Example |
|-------|-------------|---------|
| **System Name** | Identifier for your firewall | `Office-Firewall` |
| **System Contact** | Admin contact email | `admin@company.com` |
| **System Location** | Physical location | `Server Room A` |
| **Asset Number** | Optional asset tag | `FW-001` |

#### Step 3: Add SNMP Host Entry

Under **SNMP Host Settings**, you must add at least one host that's allowed to query SNMP:

1. Click the **Add** button
2. Configure the SNMP host:

| Field | Description | Recommended Value |
|-------|-------------|-------------------|
| **Host IP Address** | IP of your monitoring machine | Your server IP, or `0.0.0.0` to allow any host |
| **Community String** | Shared secret for authentication | `public` (default) or create a custom string |
| **Port** | SNMP port | `161` (default) |
| **SNMP Version** | Protocol version | `SNMPv2c` (recommended) |

3. Click **OK** to add the host entry

#### Step 4: Configure Firewall Access Rules (If Needed)

If your monitoring machine is on a different network zone, ensure SNMP traffic is allowed:

1. Navigate to **Policy → Rules and Policies → Access Rules**
2. Add a rule if needed:
   - **Source Zone**: Zone where your monitoring machine resides (e.g., LAN)
   - **Destination Zone**: The firewall's management zone
   - **Service**: SNMP (UDP 161)
   - **Action**: Allow

#### Step 5: Save and Verify

1. Click **Accept** to save all SNMP settings
2. Test SNMP connectivity from your monitoring machine:

```bash
# Install snmp tools if needed
# macOS: brew install net-snmp
# Ubuntu/Debian: sudo apt install snmp
# Raspberry Pi: sudo apt install snmp

# Test SNMP connection
snmpwalk -v2c -c public 10.10.10.1 ifDescr
```

You should see output listing interface descriptions like:
```
IF-MIB::ifDescr.1 = STRING: X0
IF-MIB::ifDescr.2 = STRING: X1
IF-MIB::ifDescr.3 = STRING: X2
...
```

#### Security Notes

- **Community String**: The default `public` is widely known. For production, use a unique string.
- **Host Restriction**: Limit SNMP access to specific IPs rather than `0.0.0.0` when possible.
- **SNMPv3**: For higher security, consider SNMPv3 with authentication (not currently supported by this dashboard).

### Environment Variables

```env
FETCH_METHOD=snmp

SNMP_HOST=10.10.10.1
SNMP_COMMUNITY=public
```

### Pros/Cons

- ✅ No admin credentials needed
- ✅ Standard monitoring protocol
- ✅ Won't interfere with admin sessions
- ✅ Can get traffic statistics (bytes in/out)
- ❌ Less detailed info (no IP mode or comments)

---

## Common Settings

```env
# Which interfaces to monitor (comma-separated)
SONICWALL_WAN_INTERFACES=X1,X2

# Dashboard refresh rate in milliseconds
NEXT_PUBLIC_REFRESH_MS=2000

# Friendly names for each interface
NEXT_PUBLIC_ISP_NAME_X1=Starlink
NEXT_PUBLIC_ISP_NAME_X2=Zito
```

## Running

### Development

```bash
npm run dev
```

Open http://localhost:3000

### Production

```bash
npm run build
npm start
```

---

## Docker Deployment (MacBook & Raspberry Pi)

Works on both Intel/Apple Silicon Macs and Raspberry Pi 5.

### Prerequisites

**MacBook (Intel or Apple Silicon):**
```bash
# Install Docker Desktop from https://docker.com/products/docker-desktop
# Or via Homebrew:
brew install --cask docker
# Then open Docker Desktop app to start the daemon
```

**Raspberry Pi 5 (64-bit Raspberry Pi OS):**
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to docker group (logout/login after)
sudo usermod -aG docker $USER

# Install docker-compose plugin
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
```

### Quick Start

1. **Clone the repository:**
```bash
git clone <repo-url>
cd snmp-monitor-isps
```

2. **Create your environment file:**
```bash
cp .env.local.example .env.local
# Edit .env.local with your SonicWall settings
nano .env.local
```

3. **Build and run:**
```bash
docker compose up -d --build
```

4. **View the dashboard:**
Open http://localhost:3000 (or http://<raspberry-pi-ip>:3000)

### Docker Commands

```bash
# Start in background
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Rebuild from scratch (no cache)
docker compose build --no-cache && docker compose up -d
```

### Environment Variables

The container reads from `.env.local`. Key variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `FETCH_METHOD` | `snmp` or `api` | `snmp` |
| `SNMP_HOST` | SonicWall IP | `10.10.10.1` |
| `SNMP_COMMUNITY` | SNMP community string | `public` |
| `NEXT_PUBLIC_REFRESH_MS` | Refresh interval (ms) | `2000` |
| `NEXT_PUBLIC_ISP_NAME_X1` | Friendly name for X1 | `Starlink` |
| `NEXT_PUBLIC_ISP_NAME_X2` | Friendly name for X2 | `Zito` |

## Troubleshooting

### SNMP Not Working

1. Verify SNMP is enabled on SonicWall
2. Check firewall rules allow SNMP (UDP 161) from your host
3. Test with: `snmpwalk -v2c -c public 10.10.10.1 ifDescr`

### API Auth Errors

1. Verify SonicOS API is enabled
2. Check username/password are correct
3. Ensure `SONICWALL_INSECURE_TLS=true` for self-signed certs

### No Interfaces Found

1. Check `SONICWALL_WAN_INTERFACES` matches your interface names
2. Interface names are case-insensitive (X1, x1, etc.)
