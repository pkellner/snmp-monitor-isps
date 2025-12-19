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

### SonicWall Configuration

1. Log into your SonicWall admin interface
2. Navigate to **Device → Settings → Administration → API**
3. Enable **SonicOS API**
4. Click **Accept** to save

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

### SonicWall Configuration

1. Log into your SonicWall admin interface
2. Navigate to **Device → Settings → SNMP**
3. Check **Enable SNMP**
4. Configure the settings:
   - **System Name**: Your firewall name
   - **System Contact**: Your email (optional)
   - **System Location**: Your location (optional)
5. Under **SNMP Host Settings**, add your monitoring host:
   - Click **Add**
   - **Host IP Address**: IP of the machine running this dashboard (or `0.0.0.0` for any)
   - **Community String**: `public` (or create a custom read-only string)
   - **Port**: `161` (default)
6. Click **Accept** to save

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
