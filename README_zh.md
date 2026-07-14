# IPv6 子网代理

一个基于 Node.js TypeScript 的 SOCKS5 代理服务，能够将出站连接分布到托管 `/64` 子网中的不同 IPv6 地址。包含 REST 管理 API、SQLite 持久化存储、用户级速率限制、流量统计和审计日志功能。

---

## 目录

- [功能特性](#功能特性)
- [架构设计](#架构设计)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [SOCKS5 代理使用](#socks5-代理使用)
- [REST API 参考](#rest-api-参考)
  - [健康检查](#健康检查)
  - [用户管理](#用户管理)
  - [子网管理](#子网管理)
  - [绑定管理](#绑定管理)
  - [会话管理](#会话管理)
  - [流量统计](#流量统计)
  - [速率限制](#速率限制)
  - [审计日志](#审计日志)
- [数据模型](#数据模型)
- [速率限制机制](#速率限制机制)
- [开发指南](#开发指南)
- [Docker 部署](#docker-部署)
- [CI/CD 持续集成](#cicd-持续集成)

---

## 功能特性

- **SOCKS5 密码认证** — 完整实现 RFC 1928（SOCKS5）和 RFC 1929（用户名/密码）协议。支持 CONNECT 命令；BIND 和 UDP ASSOCIATE 请求将被拒绝。
- **用户级 IPv6 分配** — 两种分配模式：`sticky`（同一用户+子网对复用固定 IPv6 地址）和 `random`（每次连接随机分配新地址）。
- **多子网管理** — 管理多个 `/64`（或任意前缀长度）子网，可为每个用户绑定任意子网组合。
- **REST 管理 API** — 完整的用户、子网和绑定关系 CRUD 操作；查询活跃会话、流量统计、审计日志；管理速率限制。
- **速率限制** — 用户级并发连接数限制和令牌桶带宽限流。
- **流量统计** — 按用户、按日统计字节数（入站/出站）。
- **审计日志** — 所有管理操作均记录时间戳和操作者信息。
- **Docker 多架构** — 支持 `linux/amd64` 和 `linux/arm64` 架构镜像，发布至 GHCR。
- **SQLite 持久化** — 使用 WAL 模式的 SQLite 数据库，存储于持久卷中。

---

## 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                   IPv6 子网代理                             │
│                                                           │
│  ┌──────────┐    ┌──────────────────────────────────┐    │
│  │ SOCKS5   │    │    Fastify API (端口 3000)        │    │
│  │ 服务器    │    │  ┌─────┐ ┌──────┐ ┌──────────┐  │    │
│  │(端口 1080)│    │  │用户 │ │子网  │ │会话      │  │    │
│  │           │    │  │路由 │ │路由  │ │路由      │  │    │
│  │ 认证      │    │  └─────┘ └──────┘ └──────────┘  │    │
│  │ (RFC1929) │    │  ┌──────┐ ┌──────┐ ┌────────┐  │    │
│  │           │    │  │流量  │ │限制  │ │审计    │  │    │
│  │ CONNECT   │    │  │路由  │ │路由  │ │路由    │  │    │
│  │ 处理      │    │  └──────┘ └──────┘ └────────┘  │    │
│  └─────┬─────┘    └──────────────────────────────────┘    │
│        │                        │                          │
│        └──────────┬─────────────┘                          │
│                   │                                        │
│        ┌──────────▼──────────┐                             │
│        │      核心模块        │                             │
│        │  ┌──────────────┐   │                             │
│        │  │ IP 分配器    │   │                             │
│        │  │  (sticky/    │   │                             │
│        │  │   random)    │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  用户管理器   │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  子网管理器   │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  速率限制器   │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  流量统计    │   │                             │
│        │  ├──────────────┤   │                             │
│        │  │  审计日志    │   │                             │
│        │  └──────────────┘   │                             │
│        └──────────┬──────────┘                             │
│                   │                                        │
│        ┌──────────▼──────────┐                             │
│        │  SQLite (WAL 模式)   │                             │
│        │  /data/proxy.db     │                             │
│        └─────────────────────┘                             │
└──────────────────────────────────────────────────────────┘

         ┌──────┐    SOCKS5        ┌────────────┐
         │客户端 │◄───────────────►│  目标服务器  │
         │      │   (IPv6 绑定)    │            │
         └──────┘                  └────────────┘
```

应用程序为单进程架构，运行两个服务：

- **SOCKS5 服务器**（端口 `1080`）— 接受客户端连接，使用用户名/密码进行认证，从用户绑定的子网中分配 IPv6 地址，并转发流量。
- **REST API 服务器**（端口 `3000`）— 基于 Fastify 的 HTTP 管理 API。除 `/health` 外，所有端点均需 `X-API-Key` 头进行认证。

两个服务共享相同的核心模块和 SQLite 数据库。

---

## 快速开始

### 前置要求

- 启用了 IPv6 并设置了 `net.ipv6.ip_nonlocal_bind=1` 的 Linux 系统
- Node.js 20+（手动部署时需要）
- Docker（容器部署时需要）

### Docker 部署（推荐）

```bash
# 克隆仓库
git clone https://github.com/your-username/ipv6-subnet-proxy.git
cd ipv6-subnet-proxy

# 编辑 docker-compose.yml，设置 API_KEY 和 DEFAULT_SUBNET
# 然后启动
docker compose -f docker/docker-compose.yml up -d
```

### 手动部署

```bash
# 克隆并安装
git clone https://github.com/your-username/ipv6-subnet-proxy.git
cd ipv6-subnet-proxy
npm install
npm run build

# 设置必需的环境变量
export API_KEY=your-secret-api-key

# 可选：配置默认子网
export DEFAULT_SUBNET=2001:db8:1::/64

# 启动
npm start
```

### 验证

```bash
# 健康检查
curl http://localhost:3000/health

# 创建用户
curl -X POST http://localhost:3000/api/v1/users \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "secret123"}'

# 添加子网
curl -X POST http://localhost:3000/api/v1/subnets \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"cidr": "2001:db8:1::/64"}'

# 绑定用户到子网
curl -X POST http://localhost:3000/api/v1/users/<USER_ID>/bindings \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"subnet_id": "<SUBNET_ID>"}'
```

现在可以使用 SOCKS5 代理 `localhost:1080`，用户名为 `alice`，密码为 `secret123`。

---

## 配置说明

所有配置通过环境变量进行设置：

| 变量 | 默认值 | 描述 |
|---|---|---|
| `API_KEY` | _(必需)_ | REST API 认证的 API 密钥 |
| `SOCKS5_PORT` | `1080` | SOCKS5 代理监听端口 |
| `API_PORT` | `3000` | REST API 监听端口 |
| `API_HOST` | `0.0.0.0` | REST API 绑定地址 |
| `DB_PATH` | `/data/proxy.db` | SQLite 数据库文件路径 |
| `DEFAULT_SUBNET` | — | 启动时自动注册子网（CIDR 格式） |
| `DEFAULT_SUBNET_GATEWAY` | — | 默认子网的网关地址 |
| `BCRYPT_ROUNDS` | `10` | 密码哈希的 bcrypt 轮次 |
| `LOG_LEVEL` | `info` | 日志级别：`trace`、`debug`、`info`、`warn`、`error`、`fatal` |

---

## SOCKS5 代理使用

使用任意 SOCKS5 客户端，配置以下参数：

- **地址**：代理服务器 IP 或主机名
- **端口**：`1080`（或自定义的 `SOCKS5_PORT`）
- **协议**：SOCKS5
- **认证**：用户名 / 密码
- **用户名**：已创建用户的用户名
- **密码**：对应的密码

代理仅支持 TCP CONNECT 命令。BIND 和 UDP ASSOCIATE 请求将被拒绝（返回 `0x07` 命令不支持）。

### 用户地址模式

用户可在两种 IPv6 分配模式下运行：

- **sticky**（默认）：每个用户+子网对分配一个固定 IPv6 地址。该地址在重连后保持不变，直到通过 `POST /users/:id/refresh` 显式刷新。
- **random**：每次连接从子网中随机生成新的 IPv6 地址。

### IPv6 内核要求

主机必须设置 `net.ipv6.ip_nonlocal_bind=1`，以允许绑定到未分配给任何本地接口的 IPv6 地址：

```bash
sysctl -w net.ipv6.ip_nonlocal_bind=1
```

若要永久生效，请将 `net.ipv6.ip_nonlocal_bind=1` 添加到 `/etc/sysctl.conf` 或 `/etc/sysctl.d/99-ipv6.conf`。

---

## REST API 参考

所有 API 端点均以 `/api/v1` 作为前缀。除健康检查端点外，所有请求均需通过 `X-API-Key` 头进行认证。

### 健康检查

| 方法 | 路径 | 描述 | 认证 |
|---|---|---|---|
| `GET` | `/health` | 基础健康检查（运行时长） | 否 |
| `GET` | `/health/ready` | 就绪检查（验证数据库连接） | 否 |

### 用户管理

| 方法 | 路径 | 描述 |
|---|---|---|
| `POST` | `/api/v1/users` | 创建用户 |
| `GET` | `/api/v1/users` | 列出所有用户 |
| `GET` | `/api/v1/users/:id` | 根据 ID 获取用户 |
| `PATCH` | `/api/v1/users/:id` | 更新用户（密码、模式、状态） |
| `DELETE` | `/api/v1/users/:id` | 删除用户 |
| `POST` | `/api/v1/users/:id/refresh` | 刷新 sticky IPv6 绑定 |
| `GET` | `/api/v1/users/:id/current-ip` | 获取当前的 sticky 地址 |

**POST /api/v1/users**

```json
{
  "username": "alice",
  "password": "secret123",
  "mode": "sticky"
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

### 子网管理

| 方法 | 路径 | 描述 |
|---|---|---|
| `POST` | `/api/v1/subnets` | 添加子网 |
| `GET` | `/api/v1/subnets` | 列出所有子网 |
| `GET` | `/api/v1/subnets/:id` | 根据 ID 获取子网 |
| `DELETE` | `/api/v1/subnets/:id` | 删除子网 |
| `POST` | `/api/v1/subnets/:id/health` | 检查子网健康状态（尝试 IPv6 绑定） |

**POST /api/v1/subnets**

```json
{
  "cidr": "2001:db8:1::/64",
  "gateway": "2001:db8:1::1"
}
```

### 绑定管理

将用户绑定到子网。用户必须绑定到至少一个子网才能使用 SOCKS5 代理。

| 方法 | 路径 | 描述 |
|---|---|---|
| `POST` | `/api/v1/users/:id/bindings` | 将用户绑定到子网 |
| `GET` | `/api/v1/users/:id/bindings` | 列出用户的子网绑定 |
| `DELETE` | `/api/v1/users/:id/bindings/:bindingId` | 删除绑定 |

**POST /api/v1/users/:id/bindings**

```json
{
  "subnet_id": "<subnet-uuid>"
}
```

### 会话管理

| 方法 | 路径 | 描述 |
|---|---|---|
| `GET` | `/api/v1/sessions` | 列出活跃的 SOCKS5 会话（可选 `?user_id=` 过滤） |
| `DELETE` | `/api/v1/sessions/:sessionId` | 强制断开会话 |

### 流量统计

| 方法 | 路径 | 描述 |
|---|---|---|
| `GET` | `/api/v1/traffic` | 查询流量统计数据 |

**查询参数：** `user_id`、`start`（ISO 日期）、`end`（ISO 日期）、`limit`、`offset`

### 速率限制

| 方法 | 路径 | 描述 |
|---|---|---|
| `GET` | `/api/v1/users/:id/limits` | 获取速率限制规则及当前连接数 |
| `PUT` | `/api/v1/users/:id/limits` | 设置速率限制规则 |

**PUT /api/v1/users/:id/limits**

```json
{
  "max_connections": 10,
  "max_bandwidth": 1048576
}
```

- `max_connections`：最大并发 SOCKS5 连接数（`null` 表示不限制）
- `max_bandwidth`：最大带宽，字节/秒（`null` 表示不限制）

### 审计日志

| 方法 | 路径 | 描述 |
|---|---|---|
| `GET` | `/api/v1/audit-logs` | 查询审计日志 |

**查询参数：** `user_id`、`action`、`start`（ISO 日期时间）、`end`（ISO 日期时间）、`limit`、`offset`

**审计操作记录：**
- `user.created`、`user.updated`、`user.deleted`
- `subnet.created`、`subnet.deleted`
- `binding.created`、`binding.deleted`
- `ip.refreshed`
- `rate_limits.updated`

---

## 数据模型

### 用户表 (users)

| 列名 | 类型 | 描述 |
|---|---|---|
| `id` | TEXT (UUID) | 主键 |
| `username` | TEXT | 唯一用户名 |
| `password` | TEXT | bcrypt 哈希 |
| `mode` | TEXT | `sticky` 或 `random` |
| `status` | TEXT | `active` 或 `disabled` |
| `created_at` | TEXT | ISO 8601 时间戳 |
| `updated_at` | TEXT | ISO 8601 时间戳 |

### 子网表 (subnets)

| 列名 | 类型 | 描述 |
|---|---|---|
| `id` | TEXT (UUID) | 主键 |
| `cidr` | TEXT | 唯一 CIDR 表示法（如 `2001:db8:1::/64`） |
| `gateway` | TEXT | 网关地址（可选） |
| `status` | TEXT | `active` 或 `disabled` |
| `created_at` | TEXT | ISO 8601 时间戳 |

### 粘性绑定表 (sticky_bindings)

| 列名 | 类型 | 描述 |
|---|---|---|
| `id` | TEXT (UUID) | 主键 |
| `user_id` | TEXT | 引用 users(id) |
| `subnet_id` | TEXT | 引用 subnets(id) |
| `ipv6_addr` | TEXT | 分配的 IPv6 地址（完整展开格式） |
| `bound_at` | TEXT | ISO 8601 时间戳 |

### 流量统计表 (traffic_stats)

| 列名 | 类型 | 描述 |
|---|---|---|
| `id` | TEXT (UUID) | 主键 |
| `user_id` | TEXT | 引用 users(id) |
| `date` | TEXT | `YYYY-MM-DD` 格式的日期 |
| `bytes_in` | INTEGER | 从目标接收的字节数 |
| `bytes_out` | INTEGER | 发送到目标的字节数 |

### 审计日志表 (audit_logs)

| 列名 | 类型 | 描述 |
|---|---|---|
| `id` | TEXT (UUID) | 主键 |
| `user_id` | TEXT | 引用 users(id)，可为空 |
| `actor` | TEXT | 操作执行者（`system` 或用户名） |
| `action` | TEXT | 操作标识符 |
| `detail` | TEXT | 包含操作详情的 JSON 字符串 |
| `created_at` | TEXT | ISO 8601 时间戳 |

### 速率限制表 (rate_limits)

| 列名 | 类型 | 描述 |
|---|---|---|
| `id` | TEXT (UUID) | 主键 |
| `user_id` | TEXT | 唯一，引用 users(id) |
| `max_connections` | INTEGER | 最大并发连接数（可为空） |
| `max_bandwidth` | INTEGER | 最大带宽，字节/秒（可为空） |

---

## 速率限制机制

速率限制在用户级别通过两种方式进行控制：

1. **连接数限制** — 对并发 SOCKS5 会话数量的硬性限制。在连接时强制执行。默认：不限制。
2. **带宽限制** — 令牌桶算法。每个用户拥有一个桶，以 `max_bandwidth` 字节/秒的速率补充令牌。如果桶为空，数据将被延迟。默认：不限制。

速率限制是可选的 — 将值设置为 `null`（或在 JSON 请求体中省略）即可禁用。

---

## 开发指南

```bash
# 安装依赖
npm install

# 开发模式运行（热重载）
npm run dev

# 类型检查
npm run typecheck

# 构建
npm run build
```

### 项目结构

```
src/
├── index.ts                    # 入口文件
├── config.ts                   # 环境配置
├── database/
│   ├── connection.ts           # SQLite 单例
│   └── migrations.ts           # 数据库迁移
├── core/
│   ├── ip-allocator.ts         # IPv6 地址分配
│   ├── users.ts                # 用户管理
│   ├── subnets.ts              # 子网管理
│   ├── sessions.ts             # 会话跟踪
│   ├── traffic.ts              # 流量统计
│   ├── rate-limiter.ts         # 速率限制
│   └── audit.ts                # 审计日志
├── socks5/
│   └── server.ts               # SOCKS5 协议实现
├── api/
│   ├── server.ts               # Fastify 服务器设置
│   ├── middleware/
│   │   └── auth.ts             # API 密钥认证
│   └── routes/
│       ├── health.ts           # 健康检查端点
│       ├── users.ts            # 用户 CRUD 端点
│       ├── subnets.ts          # 子网 CRUD 端点
│       ├── bindings.ts         # 用户-子网绑定端点
│       ├── sessions.ts         # 会话管理端点
│       ├── traffic.ts          # 流量统计端点
│       ├── limits.ts           # 速率限制端点
│       └── audit.ts            # 审计日志端点
└── utils/
    ├── ipv6.ts                 # IPv6 地址工具
    └── logger.ts               # Pino 日志器
```

---

## Docker 部署

### 构建镜像

```bash
docker build -f docker/Dockerfile -t ipv6-subnet-proxy .
```

### docker-compose 配置

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

> **注意：** 在 Docker 中，IPv6 绑定需要 `network_mode: host` 才能正常工作。使用主机网络模式时，端口映射仅起说明作用，容器将直接使用主机的网络栈。

---

## CI/CD 持续集成

当推送匹配 `v*` 格式的 Git 标签时，Docker 镜像将自动构建并发布到 GitHub Container Registry (GHCR)。

GitHub Actions 工作流执行以下步骤：

1. 检出仓库代码
2. 生成 Docker 元数据标签（语义化版本 + `latest`）
3. 设置 QEMU 用于多架构构建
4. 登录 GHCR
5. 构建并推送 `linux/amd64` 和 `linux/arm64` 架构的镜像

**使用方法：**

```bash
git tag v1.0.0
git push origin v1.0.0
```

镜像将发布至 `ghcr.io/<your-username>/ipv6-subnet-proxy`。

---

## 许可证

MIT
