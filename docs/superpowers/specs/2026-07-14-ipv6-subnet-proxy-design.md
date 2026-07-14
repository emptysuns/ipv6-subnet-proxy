# IPv6 Subnet Proxy — Design Specification

**Date:** 2026-07-14
**Status:** Draft
**Author:** sakurairo

## Overview

A Node.js service that wraps an IPv6 `/64` subnet into a SOCKS5 proxy with password authentication. Each proxy user is assigned an IPv6 address from the subnet pool, allowing programs to appear with different source IPs — useful for bypassing per-IP registration limits on websites.

### Core Use Case

1. A VPS is assigned an IPv6 `/64` subnet (e.g., `2001:db8:1::/64`)
2. The service runs in a Docker container on that VPS
3. Client programs connect through the SOCKS5 proxy with username/password
4. Each user gets a distinct IPv6 source address (sticky session or random-per-connection)
5. A REST API allows remote management of users, subnets, and session behaviour

---

## Architecture

Single-process Node.js application combining a SOCKS5 server and a REST API server, backed by SQLite (WAL mode).

```
┌─────────────────────────────────────────────┐
│               Docker Container               │
│                                              │
│  ┌────────────┐         ┌──────────────┐     │
│  │   SOCKS5    │         │  REST API    │     │
│  │  Port:1080  │         │  Port:3000   │     │
│  │  User/Pass  │         │  X-API-Key   │     │
│  └─────┬───────┘         └──────┬───────┘     │
│        │                        │             │
│        └────────┬───────────────┘             │
│                 │                             │
│          ┌──────▼──────┐                      │
│          │ Core Engine  │                      │
│          │              │                      │
│          │ • UserManager│                      │
│          │ • SubnetMgr  │                      │
│          │ • SessionMgr │                      │
│          │ • IPAllocator│                      │
│          │ • TrafficStats│                     │
│          │ • RateLimiter│                      │
│          │ • AuditLogger│                      │
│          └──────┬──────┘                      │
│                 │                             │
│          ┌──────▼──────┐                      │
│          │   SQLite     │                      │
│          │ /data/proxy.db│                    │
│          └─────────────┘                      │
└─────────────────────────────────────────────┘
```

---

## Data Model (SQLite)

### users
| Column     | Type | Notes                        |
|------------|------|------------------------------|
| id         | TEXT | UUID, PK                     |
| username   | TEXT | UNIQUE NOT NULL              |
| password   | TEXT | bcrypt hash                  |
| mode       | TEXT | 'sticky' | 'random', default sticky |
| status     | TEXT | 'active' | 'disabled'         |
| created_at | TEXT | ISO 8601                     |
| updated_at | TEXT | ISO 8601                     |

### subnets
| Column     | Type | Notes                  |
|------------|------|------------------------|
| id         | TEXT | UUID, PK               |
| cidr       | TEXT | UNIQUE NOT NULL, e.g. "2001:db8:1::/64" |
| gateway    | TEXT | nullable               |
| status     | TEXT | 'active' | 'disabled' |
| created_at | TEXT | ISO 8601               |

### user_subnet_bindings
| Column    | Type | Notes              |
|-----------|------|--------------------|
| id        | TEXT | UUID, PK           |
| user_id   | TEXT | FK → users.id      |
| subnet_id | TEXT | FK → subnets.id    |
| UNIQUE(user_id, subnet_id) |     |                    |

### sticky_bindings
| Column    | Type | Notes                   |
|-----------|------|-------------------------|
| id        | TEXT | UUID, PK                |
| user_id   | TEXT | FK → users.id           |
| subnet_id | TEXT | FK → subnets.id         |
| ipv6_addr | TEXT | Assigned IPv6 address   |
| bound_at  | TEXT | ISO 8601                |
| UNIQUE(user_id, subnet_id) |                          |

### traffic_stats
| Column    | Type    | Notes            |
|-----------|---------|------------------|
| id        | TEXT    | UUID, PK         |
| user_id   | TEXT    | FK → users.id    |
| date      | TEXT    | YYYY-MM-DD       |
| bytes_in  | INTEGER | DEFAULT 0        |
| bytes_out | INTEGER | DEFAULT 0        |
| UNIQUE(user_id, date) |                  |

### audit_logs
| Column     | Type | Notes                  |
|------------|------|------------------------|
| id         | TEXT | UUID, PK               |
| user_id    | TEXT | Target user (nullable) |
| actor      | TEXT | API Key identifier     |
| action     | TEXT | NOT NULL               |
| detail     | TEXT | JSON detail            |
| created_at | TEXT | ISO 8601               |

### rate_limits
| Column          | Type    | Notes                |
|-----------------|---------|----------------------|
| id              | TEXT    | UUID, PK             |
| user_id         | TEXT    | FK → users.id, UNIQUE|
| max_connections | INTEGER | nullable             |
| max_bandwidth   | INTEGER | bytes/s, nullable    |

---

## Core Modules

### IPAllocator
- Parses CIDR notation to extract network prefix (64-bit)
- **Random mode**: generates a random 64-bit interface identifier, skips reserved addresses
- **Sticky mode**: allocates once, persists in `sticky_bindings`; reuses on subsequent connections
- Collision avoidance: checks `sticky_bindings` before committing an address
- `localAddress` binding: the generated address is used as the `localAddress` parameter in `net.createConnection()`

### UserManager
- CRUD operations for proxy users
- Password hashing with bcrypt (configurable rounds, default 10)
- Mode switching between `sticky` and `random`
- Enable/disable without deleting
- Cascade cleanup on delete: unbind subnets, clear sticky bindings, preserve audit logs

### SubnetManager
- Add/remove/list IPv6 subnets
- CIDR format validation
- Health check: bind a test address and attempt an outbound connection

### SessionManager
- Tracks active SOCKS5 connections: `{ sessionId, userId, ipv6Addr, connectedAt, bytesIn, bytesOut }`
- Startup cleanup: reconnect after restart, all prior sessions are discarded (stateless recovery)
- Session list API for monitoring
- Force disconnect: close a specific session by ID

### TrafficStats
- Per-user, per-date byte counting
- Accumulated during SOCKS5 data relay (both directions)
- Batched writes to SQLite (every N seconds or every M bytes, configurable)

### RateLimiter
- Connection limit: atomic increment/decrement on connect/disconnect; reject if over `max_connections`
- Bandwidth limit: token bucket algorithm per connection; default bucket refill interval 100ms

### AuditLogger
- Logs all API mutations: user CRUD, subnet changes, binding changes, mode switches, IP refresh
- Queryable by user, action, date range, with pagination

---

## SOCKS5 Protocol Implementation

### Supported
- RFC 1928: SOCKS Protocol Version 5
- RFC 1929: Username/Password Authentication
- CMD CONNECT (0x01): TCP connection relay

### Not supported (returns 0x07 Command not supported)
- CMD BIND (0x02)
- CMD UDP ASSOCIATE (0x03)

### Flow
1. **Method negotiation** — Client sends supported methods; server selects 0x02 (User/Pass)
2. **Authentication** — Client sends username/password per RFC 1929; server verifies via UserManager
3. **Request** — Client sends CONNECT with target address; server resolves DNS if needed, allocates IPv6 source address, establishes outbound connection with `localAddress` binding
4. **Data relay** — Bidirectional pipe between client socket and outbound socket; bytes counted for traffic stats
5. **Disconnect** — Either side closes; session released, rate limiter counters decremented

### IPv6 Binding
```javascript
const socket = net.createConnection({
  host: targetHost,
  port: targetPort,
  localAddress: allocatedIPv6,  // the magic
  family: 6
});
```
Requires `net.ipv6.ip_nonlocal_bind=1` sysctl on the host.

---

## REST API

Base: `http://<host>:3000/api/v1`
Auth: `X-API-Key: <token>` header (except `/health`, `/health/ready`)

### Authentication & Health
| Method | Path             | Auth  | Description                    |
|--------|------------------|-------|--------------------------------|
| GET    | /health          | No    | Liveness probe                 |
| GET    | /health/ready    | No    | Readiness probe (DB check)     |

### Users
| Method | Path              | Description                  |
|--------|-------------------|------------------------------|
| POST   | /users            | Create user                  |
| GET    | /users            | List all users               |
| GET    | /users/:id        | Get user detail              |
| PATCH  | /users/:id        | Update user (partial)        |
| DELETE | /users/:id        | Delete user                  |

### Subnets
| Method | Path              | Description                  |
|--------|-------------------|------------------------------|
| POST   | /subnets          | Add subnet                   |
| GET    | /subnets          | List all subnets             |
| GET    | /subnets/:id      | Get subnet detail            |
| DELETE | /subnets/:id      | Remove subnet                |
| POST   | /subnets/:id/health | Trigger health check       |

### User-Subnet Bindings
| Method | Path                           | Description           |
|--------|--------------------------------|-----------------------|
| POST   | /users/:id/bindings            | Bind subnet to user   |
| GET    | /users/:id/bindings            | List user's bindings  |
| DELETE | /users/:id/bindings/:bindingId | Unbind subnet         |

### IPv6 Address Control
| Method | Path                 | Description                          |
|--------|----------------------|--------------------------------------|
| POST   | /users/:id/refresh   | Refresh sticky IPv6 (pick new random)|
| GET    | /users/:id/current-ip| Get user's current sticky IPv6       |

### Sessions
| Method | Path                  | Description             |
|--------|-----------------------|-------------------------|
| GET    | /sessions             | List active sessions    |
| DELETE | /sessions/:sessionId  | Force disconnect session|

### Traffic Stats
| Method | Path      | Query Params                             |
|--------|-----------|------------------------------------------|
| GET    | /traffic  | user_id, start, end (date range)         |

### Rate Limits
| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| GET    | /users/:id/limits     | Get rate limits for user |
| PUT    | /users/:id/limits     | Set rate limits for user |

### Audit Logs
| Method | Path         | Query Params                              |
|--------|-------------|-------------------------------------------|
| GET    | /audit-logs  | user_id, action, start, end, limit, offset|

---

## Configuration (Environment Variables)

| Variable              | Default          | Description                         |
|-----------------------|------------------|-------------------------------------|
| SOCKS5_PORT           | 1080             | SOCKS5 server listen port           |
| API_PORT              | 3000             | REST API listen port                |
| API_HOST              | 0.0.0.0          | REST API listen address             |
| API_KEY               | (required)       | API authentication token            |
| DB_PATH               | /data/proxy.db   | SQLite database file path           |
| DEFAULT_SUBNET        | (optional)       | Auto-register a subnet on startup   |
| DEFAULT_SUBNET_GATEWAY| (optional)       | Gateway for the default subnet      |
| BCRYPT_ROUNDS         | 10               | Password hashing rounds             |
| LOG_LEVEL             | info             | Logging level                       |

---

## Directory Structure

```
ipv6-subnet-proxy/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── database/
│   │   ├── connection.ts
│   │   └── migrations.ts
│   ├── core/
│   │   ├── users.ts
│   │   ├── subnets.ts
│   │   ├── sessions.ts
│   │   ├── ip-allocator.ts
│   │   ├── traffic.ts
│   │   ├── rate-limiter.ts
│   │   └── audit.ts
│   ├── socks5/
│   │   └── server.ts
│   ├── api/
│   │   ├── server.ts
│   │   ├── middleware/
│   │   │   └── auth.ts
│   │   └── routes/
│   │       ├── users.ts
│   │       ├── subnets.ts
│   │       ├── bindings.ts
│   │       ├── sessions.ts
│   │       ├── traffic.ts
│   │       ├── limits.ts
│   │       └── audit.ts
│   └── utils/
│       ├── ipv6.ts
│       └── logger.ts
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── entrypoint.sh
├── .github/
│   └── workflows/
│       └── publish.yml
├── package.json
├── tsconfig.json
├── README.md
├── README_zh.md
└── .gitignore
```

---

## CI/CD

**Trigger:** Git tag matching `v*` (e.g., `v1.0.0`)

**Pipeline:**
1. Checkout code
2. Set up Docker Buildx
3. Log in to GHCR (`ghcr.io`)
4. Build multi-arch image (linux/amd64, linux/arm64)
5. Tag with `:latest` and `:<version>` (from git tag)
6. Push to GHCR

**Image name:** `ghcr.io/<username>/ipv6-subnet-proxy`

---

## Docker

### Runtime Requirements
- `NET_ADMIN` capability (for `sysctl net.ipv6.ip_nonlocal_bind=1`)
- Or alternatively, set the sysctl on the host before container start
- Host must have IPv6 enabled and the `/64` subnet routed to it

### docker-compose.yml
```yaml
services:
  ipv6-proxy:
    image: ghcr.io/<username>/ipv6-subnet-proxy:latest
    ports:
      - "1080:1080"
      - "3000:3000"
    environment:
      - API_KEY=changeme
      - DEFAULT_SUBNET=2001:db8:1::/64
    volumes:
      - ./data:/data
    cap_add:
      - NET_ADMIN
    sysctls:
      - net.ipv6.ip_nonlocal_bind=1
    restart: unless-stopped
```

---

## Dependencies (npm)

### Runtime
- `better-sqlite3` — synchronous SQLite with WAL support
- `bcrypt` — password hashing
- `uuid` — ID generation
- `fastify` — REST API (faster than Express, schema validation built-in)
- `pino` — structured logging (Fastify's default)

### Dev
- `typescript`
- `@types/better-sqlite3`
- `@types/bcrypt`
- `@types/uuid`
- `tsx` — TypeScript execution for development

---

## Security Considerations

- API Key transmitted via HTTP header; use HTTPS in production (reverse proxy)
- SOCKS5 credentials sent in plaintext per RFC 1929; no encryption at the SOCKS5 layer
- Password hashes stored with bcrypt (rounds=10)
- API Key stored as environment variable; never logged
- Audit logs capture all mutations for forensic traceability
- Rate limiting prevents abuse (connection count + bandwidth caps)

---

## Open Questions / Future

1. **UDP ASSOCIATE support** — Needed for DNS over SOCKS, some applications
2. **IPv4 fallback** — If a target is IPv4-only, the SOCKS5 server handles IPv6→IPv4 bridging
3. **Multi-VPS orchestration** — Coordinate multiple VPS instances behind a single API
4. **Web UI** — Dashboard for management instead of API-only
5. **Metrics export** — Prometheus-compatible metrics endpoint
