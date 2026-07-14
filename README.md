# IPv6 Subnet Proxy

[English](README.md) | [中文](README_zh.md)

A Node.js TypeScript SOCKS5 proxy that distributes outbound connections across different IPv6 addresses from managed `/64` subnets. Includes a REST management API, SQLite-backed persistence, per-user rate limiting, traffic accounting, and audit logging.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [SOCKS5 Proxy Usage](#socks5-proxy-usage)
- [REST API Reference](#rest-api-reference)
  - [Health](#health)
  - [Users](#users)
  - [Subnets](#subnets)
  - [Bindings](#bindings)
  - [Sessions](#sessions)
  - [Traffic](#traffic)
  - [Rate Limits](#rate-limits)
  - [Audit Logs](#audit-logs)
- [Data Model](#data-model)
- [Rate Limiting](#rate-limiting)
- [Development](#development)
- [Docker](#docker)
- [CI/CD](#cicd)

---

## Features

- **SOCKS5 with Password Auth** — Full RFC 1928 (SOCKS5) and RFC 1929 (Username/Password) support. Only CONNECT command; BIND and UDP ASSOCIATE are rejected.
- **Per-User IPv6 Allocation** — Two modes: `sticky` (same IPv6 address is reused for each user+subnet pair) and `random` (new address per connection).
- **Multi-Subnet Management** — Manage multiple `/64` (or any prefix length) subnets, bind any subset to each user.
- **REST Management API** — Full CRUD for users, subnets, and bindings; query active sessions, traffic stats, audit logs; manage rate limits.
- **Rate Limiting** — Per-user connection count limit and token-bucket bandwidth throttling.
- **Traffic Accounting** — Per-user, per-day byte counters (bytes in / out).
- **Audit Logging** — All management actions are recorded with timestamps and actor information.
- **Docker Multi-Arch** — `linux/amd64` and `linux/arm64` images published to GHCR.
- **SQLite Persistence** — WAL-mode SQLite database stored on a persistent volume.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   IPv6 Subnet Proxy                       │
│                                                           │
│  ┌──────────┐    ┌──────────────────────────────────┐    │
│  │  SOCKS5   │    │         Fastify API (port 3000)   │    │
│  │  Server   │    │  ┌─────┐ ┌──────┐ ┌──────────┐  │    │
│  │ (port 1080)│    │  │Users│ │Subnet│ │Sessions  │  │    │
│  │           │    │  │Route│ │Route │ │Route     │  │    │
│  │  Auth     │    │  └─────┘ └──────┘ └──────────┘  │    │
│  │  (RFC1929)│    │  ┌──────┐ ┌──────┐ ┌────────┐  │    │
│  │           │    │  │Traffic│ │Limits│ │Audit   │  │    │
│  │  Connect  │    │  │Route │ │Route │ │Route   │  │    │
│  │  Handler  │    │  └──────┘ └──────┘ └────────┘  │    │
│  └─────┬─────┘    └──────────────────────────────────┘    │
│        │                        │                          │
│        └──────────┬─────────────┘                          │
│                   │                                        │
│        ┌──────────▼──────────┐                             │
│        │    Core Modules      │                             │
│        │  ┌──────────────┐   │                             │
│        │  │ IP Allocator │   │                             │
│        │  │  (sticky/    │   │                             │
│        │  │   random)    │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  UserManager │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │ SubnetManager│   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  RateLimiter │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │ TrafficStats │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │ AuditLogger  │   │                             │
│        │  └──────────────┘   │                             │
│        └──────────┬──────────┘                             │
│                   │                                        │
│        ┌──────────▼──────────┐                             │
│        │   SQLite (WAL mode) │                             │
│        │   /data/proxy.db    │                             │
│        └─────────────────────┘                             │
└──────────────────────────────────────────────────────────┘

         ┌──────┐     SOCKS5        ┌────────────┐
         │Client│◄─────────────────►│  Target    │
         │      │   (IPv6 bind)     │  Server    │
         └──────┘                   └────────────┘
```

The application is a single process hosting two servers:

- **SOCKS5 server** on port `1080` — accepts client connections, authenticates via username/password, allocates an IPv6 address from the user's bound subnets, and relays traffic.
- **REST API server** on port `3000` — Fastify-based HTTP API for management. All endpoints (except `/health`) require `X-API-Key` header authentication.

Both servers share the same core modules and SQLite database.

---

## Quick Start

### Prerequisites

- Linux with IPv6 enabled and `net.ipv6.ip_nonlocal_bind=1`
- Node.js 20+ (for manual deployment)
- Docker (for container deployment)

### Docker (recommended)

```bash
# Clone the repository
git clone https://github.com/your-username/ipv6-subnet-proxy.git
cd ipv6-subnet-proxy

# Edit docker-compose.yml to set API_KEY and DEFAULT_SUBNET
# Then start
docker compose -f docker/docker-compose.yml up -d
```

### Manual

```bash
# Clone and install
git clone https://github.com/your-username/ipv6-subnet-proxy.git
cd ipv6-subnet-proxy
npm install
npm run build

# Set required environment variable
export API_KEY=your-secret-api-key

# Optional: configure a default subnet
export DEFAULT_SUBNET=2001:db8:1::/64

# Start
npm start
```

### Verify

```bash
# Health check
curl http://localhost:3000/health

# Create a user
curl -X POST http://localhost:3000/api/v1/users \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "secret123"}'

# Add a subnet
curl -X POST http://localhost:3000/api/v1/subnets \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"cidr": "2001:db8:1::/64"}'

# Bind user to subnet
curl -X POST http://localhost:3000/api/v1/users/<USER_ID>/bindings \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"subnet_id": "<SUBNET_ID>"}'
```

Now use SOCKS5 proxy at `localhost:1080` with username `alice` and password `secret123`.

---

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | _(required)_ | API key for REST API authentication |
| `SOCKS5_PORT` | `1080` | SOCKS5 proxy listen port |
| `API_PORT` | `3000` | REST API listen port |
| `API_HOST` | `0.0.0.0` | REST API bind address |
| `DB_PATH` | `/data/proxy.db` | SQLite database file path |
| `DEFAULT_SUBNET` | — | Automatically register a subnet on startup (CIDR notation) |
| `DEFAULT_SUBNET_GATEWAY` | — | Gateway address for the default subnet |
| `BCRYPT_ROUNDS` | `10` | bcrypt hash rounds for password hashing |
| `LOG_LEVEL` | `info` | Logging level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

---

## SOCKS5 Proxy Usage

Configure any SOCKS5 client with:

- **Address**: proxy server IP or hostname
- **Port**: `1080` (or custom `SOCKS5_PORT`)
- **Protocol**: SOCKS5
- **Authentication**: Username / Password
- **Username**: the username of a created user
- **Password**: the corresponding password

The proxy only supports TCP CONNECT. BIND and UDP ASSOCIATE requests are rejected with `0x07` (Command not supported).

### Per-User Address Modes

Users operate in one of two IPv6 allocation modes:

- **random** (default): Each connection receives a new random IPv6 address from the assigned subnet.
- **sticky**: Each user+subnet pair receives a fixed IPv6 address. The address persists across reconnections until explicitly refreshed via `POST /users/:id/refresh`.
- **random**: A new random IPv6 address from the subnet is generated for every connection.

### IPv6 Kernel Requirement

The host must have `net.ipv6.ip_nonlocal_bind=1` to allow binding to IPv6 addresses that are not assigned to any local interface:

```bash
sysctl -w net.ipv6.ip_nonlocal_bind=1
```

To make this permanent, add `net.ipv6.ip_nonlocal_bind=1` to `/etc/sysctl.conf` or `/etc/sysctl.d/99-ipv6.conf`.

---

## REST API Reference

All API endpoints are prefixed with `/api/v1`. Authentication is via the `X-API-Key` header, except for health endpoints.

### Health

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Basic health check (uptime) | No |
| `GET` | `/health/ready` | Readiness check (verifies DB connectivity) | No |

### Users

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/users` | Create a user |
| `GET` | `/api/v1/users` | List all users |
| `GET` | `/api/v1/users/:id` | Get a user by ID |
| `PATCH` | `/api/v1/users/:id` | Update user (password, mode, status) |
| `DELETE` | `/api/v1/users/:id` | Delete a user |
| `POST` | `/api/v1/users/:id/refresh` | Refresh sticky IPv6 bindings |
| `GET` | `/api/v1/users/:id/current-ip` | Get current sticky addresses |

**POST /api/v1/users**

```json
{
  "username": "alice",
  "password": "secret123",
  "mode": "random"
}
```

**PATCH /api/v1/users/:id**

```json
{
  "password": "newpass",
  "mode": "random",
  "status": "disabled"
}
```

### Subnets

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/subnets` | Add a subnet |
| `GET` | `/api/v1/subnets` | List all subnets |
| `GET` | `/api/v1/subnets/:id` | Get a subnet by ID |
| `DELETE` | `/api/v1/subnets/:id` | Remove a subnet |
| `POST` | `/api/v1/subnets/:id/health` | Check subnet health (attempts IPv6 bind) |

**POST /api/v1/subnets**

```json
{
  "cidr": "2001:db8:1::/64",
  "gateway": "2001:db8:1::1"
}
```

### Bindings

Bind users to subnets. A user must be bound to at least one subnet to use the SOCKS5 proxy.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/users/:id/bindings` | Bind user to a subnet |
| `GET` | `/api/v1/users/:id/bindings` | List user's subnet bindings |
| `DELETE` | `/api/v1/users/:id/bindings/:bindingId` | Remove a binding |

**POST /api/v1/users/:id/bindings**

```json
{
  "subnet_id": "<subnet-uuid>"
}
```

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/sessions` | List active SOCKS5 sessions (optional `?user_id=` filter) |
| `DELETE` | `/api/v1/sessions/:sessionId` | Force-disconnect a session |

### Traffic

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/traffic` | Query traffic stats |

**Query parameters:** `user_id`, `start` (ISO date), `end` (ISO date), `limit`, `offset`

### Rate Limits

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/users/:id/limits` | Get rate limit rules + current connection count |
| `PUT` | `/api/v1/users/:id/limits` | Set rate limit rules |

**PUT /api/v1/users/:id/limits**

```json
{
  "max_connections": 10,
  "max_bandwidth": 1048576
}
```

- `max_connections`: Maximum concurrent SOCKS5 connections (`null` for unlimited)
- `max_bandwidth`: Maximum bandwidth in bytes/sec (`null` for unlimited)

### Audit Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/audit-logs` | Query audit logs |

**Query parameters:** `user_id`, `action`, `start` (ISO datetime), `end` (ISO datetime), `limit`, `offset`

**Audit actions recorded:**
- `user.created`, `user.updated`, `user.deleted`
- `subnet.created`, `subnet.deleted`
- `binding.created`, `binding.deleted`
- `ip.refreshed`
- `rate_limits.updated`

---

## Data Model

### Users

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `username` | TEXT | Unique username |
| `password` | TEXT | bcrypt hash |
| `mode` | TEXT | `sticky` or `random` |
| `status` | TEXT | `active` or `disabled` |
| `created_at` | TEXT | ISO 8601 timestamp |
| `updated_at` | TEXT | ISO 8601 timestamp |

### Subnets

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `cidr` | TEXT | Unique CIDR notation (e.g., `2001:db8:1::/64`) |
| `gateway` | TEXT | Gateway address (optional) |
| `status` | TEXT | `active` or `disabled` |
| `created_at` | TEXT | ISO 8601 timestamp |

### Sticky Bindings

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `user_id` | TEXT | References users(id) |
| `subnet_id` | TEXT | References subnets(id) |
| `ipv6_addr` | TEXT | Allocated IPv6 address (full expanded form) |
| `bound_at` | TEXT | ISO 8601 timestamp |

### Traffic Stats

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `user_id` | TEXT | References users(id) |
| `date` | TEXT | Date in `YYYY-MM-DD` format |
| `bytes_in` | INTEGER | Bytes received from target |
| `bytes_out` | INTEGER | Bytes sent to target |

### Audit Logs

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `user_id` | TEXT | References users(id), nullable |
| `actor` | TEXT | Who performed the action (`system` or username) |
| `action` | TEXT | Action identifier |
| `detail` | TEXT | JSON string with action details |
| `created_at` | TEXT | ISO 8601 timestamp |

### Rate Limits

| Column | Type | Description |
|---|---|---|
| `id` | TEXT (UUID) | Primary key |
| `user_id` | TEXT | Unique, references users(id) |
| `max_connections` | INTEGER | Max concurrent connections (nullable) |
| `max_bandwidth` | INTEGER | Max bytes/sec (nullable) |

---

## Rate Limiting

Rate limiting operates at two levels per user:

1. **Connection limit** — Hard limit on the number of concurrent SOCKS5 sessions. Enforced at connection time. Default: unlimited.
2. **Bandwidth throttling** — Token bucket algorithm. Each user gets a bucket that refills at `max_bandwidth` bytes per second. If the bucket is empty, data is delayed. Default: unlimited.

Rate limits are optional — set values to `null` (or omit in the JSON body) to disable.

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode with hot reload
npm run dev

# Type checking
npm run typecheck

# Build
npm run build
```

### Project Structure

```
src/
├── index.ts                    # Entry point
├── config.ts                   # Environment configuration
├── database/
│   ├── connection.ts           # SQLite singleton
│   └── migrations.ts           # Schema migrations
├── core/
│   ├── ip-allocator.ts         # IPv6 address allocation
│   ├── users.ts                # User management
│   ├── subnets.ts              # Subnet management
│   ├── sessions.ts             # Session tracking
│   ├── traffic.ts              # Traffic accounting
│   ├── rate-limiter.ts         # Rate limiting
│   └── audit.ts                # Audit logging
├── socks5/
│   └── server.ts               # SOCKS5 protocol implementation
├── api/
│   ├── server.ts               # Fastify server setup
│   ├── middleware/
│   │   └── auth.ts             # API key authentication
│   └── routes/
│       ├── health.ts           # Health check endpoints
│       ├── users.ts            # User CRUD endpoints
│       ├── subnets.ts          # Subnet CRUD endpoints
│       ├── bindings.ts         # User-subnet binding endpoints
│       ├── sessions.ts         # Session management endpoints
│       ├── traffic.ts          # Traffic stats endpoints
│       ├── limits.ts           # Rate limit endpoints
│       └── audit.ts            # Audit log endpoints
└── utils/
    ├── ipv6.ts                 # IPv6 address utilities
    └── logger.ts               # Pino logger
```

---

## Docker

### Building

```bash
docker build -f docker/Dockerfile -t ipv6-subnet-proxy .
```

### docker-compose

```yaml
services:
  ipv6-proxy:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "1080:1080"
      - "3000:3000"
    environment:
      - API_KEY=changeme
      - DEFAULT_SUBNET=2001:db8:1::/64
      - LOG_LEVEL=info
    volumes:
      - ./data:/data
    cap_add:
      - NET_ADMIN
    sysctls:
      - net.ipv6.ip_nonlocal_bind=1
    restart: unless-stopped
    network_mode: host
```

> **Note:** `network_mode: host` is required for IPv6 binding to work correctly in Docker. When using host networking, the port mappings are advisory and the container directly uses the host's network stack.

---

## CI/CD

Docker images are automatically built and published to GitHub Container Registry (GHCR) when a tag matching `v*` is pushed.

The GitHub Actions workflow:

1. Checks out the repository
2. Generates Docker metadata tags (semver + `latest`)
3. Sets up QEMU for multi-architecture builds
4. Logs into GHCR
5. Builds and pushes images for `linux/amd64` and `linux/arm64`

**Usage:**

```bash
git tag v1.0.0
git push origin v1.0.0
```

The image will be published to `ghcr.io/<your-username>/ipv6-subnet-proxy`.

---

## License

MIT
