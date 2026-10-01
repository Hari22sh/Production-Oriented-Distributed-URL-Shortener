# Production-Oriented Distributed URL Shortener

A high-performance, production-ready **URL Shortener Service** built with **NestJS**, **TypeScript**, **PostgreSQL**, **Redis**, and **Apache Kafka**.

This repository is designed as a system-design reference implementation demonstrating key distributed systems concepts, including **Snowflake ID generation**, **Base62 encoding**, **Cache-Aside pattern**, **SingleFlight request coalescing (Cache Stampede protection)**, **database uniqueness constraints for concurrent deduplication**, **asynchronous event-driven click analytics**, and **horizontal scalability to billions of URLs**.

---

## Architecture Overview

```text
                         ┌───────────────┐
                         │     Users     │
                         └───────┬───────┘
                                 │
                                 ▼
                              ┌─────┐
                              │ CDN │
                              └──┬──┘
                                 │
                            Cache Miss
                                 │
                                 ▼
                         ┌──────────────┐
                         │Load Balancer │
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              URL Service A          URL Service B
                    │                       │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
             Snowflake ID              Redis Cluster
                    │                       │
                    ▼                       │
                 Base62                     │
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
                          Shard Router
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
           Shard 1           Shard 2           Shard N
              │                 │                 │
          Primary/          Primary/          Primary/
           Replica           Replica           Replica

Redirect analytics:

Request
   │
   ├──────────────► 302 response (Immediate redirect)
   │
   └──────────────► Kafka (url-click-events)
                         │
                         ▼
                    Kafka Consumer / Analytics Warehouse
```

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Requirements](#2-requirements)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Request Flows](#4-request-flows)
5. [ID Generation](#5-id-generation)
6. [Snowflake vs DB Auto Increment vs UUID](#6-snowflake-vs-db-auto-increment-vs-uuid)
7. [Why Snowflake Was Chosen](#7-why-snowflake-was-chosen)
8. [Base62 Encoding](#8-base62-encoding)
9. [Collision vs Deduplication](#9-collision-vs-deduplication)
10. [Concurrent Same-URL Requests](#10-concurrent-same-url-requests)
11. [Redis Cache-Aside](#11-redis-cache-aside)
12. [Cache Invalidation](#12-cache-invalidation)
13. [Cache Stampede Protection](#13-cache-stampede-protection)
14. [Hot Keys & Celebrity Links](#14-hot-keys--celebrity-links)
15. [CDN / Edge Caching](#15-cdn--edge-caching)
16. [Analytics with Kafka](#16-analytics-with-kafka)
17. [URL Expiration](#17-url-expiration)
18. [Handling Billions of URLs](#18-handling-billions-of-urls)
19. [Database Indexing](#19-database-indexing)
20. [Read Replicas](#20-read-replicas)
21. [Sharding](#21-sharding)
22. [Consistent Hashing](#22-consistent-hashing)
23. [Replication vs Sharding](#23-replication-vs-sharding)
24. [Rate Limiting](#24-rate-limiting)
25. [Malicious URL Protection](#25-malicious-url-protection)
26. [Failure Scenarios](#26-failure-scenarios)
27. [Scalability Considerations](#27-scalability-considerations)
28. [Trade-offs](#28-trade-offs)
29. [Local Setup](#29-local-setup)
30. [API Documentation](#30-api-documentation)

---

## 1. Problem Statement

A URL shortener converts long URLs into compact, short links (e.g., `https://example.com/some/very/long/url` $\rightarrow$ `http://localhost:3000/a8Kd2`). When users navigate to the short URL, the service quickly redirects them to the original destination using HTTP 302 Found.

Key engineering challenges:
- High read-to-write ratio (100:1 or 1000:1 read heavy).
- Low latency redirects ($<10\text{ ms}$).
- Distributed unique ID generation without database contention.
- Compact, web-friendly short codes.
- High concurrency and race-condition safety.
- Asynchronous click analytics without blocking the redirect execution path.

---

## 2. Requirements

### Core Functional Requirements
- **Create Short URL:** `POST /api/v1/urls` generates a unique short code and optional expiration timestamp.
- **Redirect:** `GET /:shortCode` performs a sub-millisecond HTTP 302 redirect.
- **URL Expiration:** Expired links return HTTP 410 Gone and stop redirecting.
- **URL Deletion:** `DELETE /api/v1/urls/:shortCode` deactivates the record and invalidates cache entries.
- **Click Analytics:** Click metadata (`timestamp`, `ip`, `userAgent`, `referrer`) is published to Kafka asynchronously.

### Technical & Non-Functional Requirements
- **Backend:** NestJS + TypeScript.
- **Database:** PostgreSQL (TypeORM).
- **Cache:** Redis.
- **Message Broker:** Kafka.
- **Containerization:** Docker + Docker Compose.
- **Documentation:** Swagger/OpenAPI.
- **Testing:** Comprehensive Jest unit tests (100% test pass rate across 7 test suites).

---

## 3. High-Level Architecture

The service adopts a decoupled, modular NestJS architecture:

- `src/id-generator/`: Reusable **Snowflake ID Generator Service**.
- `src/encoding/`: Reusable **Base62 Encoding Service**.
- `src/cache/`: Redis client wrapper handling **Cache-Aside**, TTL calculations, and retried invalidations.
- `src/url/`: URL creation, deduplication logic, entity repository, and management controller.
- `src/redirect/`: High-speed redirect engine with **SingleFlight request coalescing**.
- `src/analytics/`: Kafka producer and consumer for non-blocking click stream tracking with IP anonymization.
- `src/rate-limit/`: Redis atomic counter sliding window rate limiter guard.
- `src/safety/`: Pluggable URL validation and malicious domain blocklist checker.

---

## 4. Request Flows

### URL Creation Flow (`POST /api/v1/urls`)
```text
User Request
    │
    ▼
Rate Limit Guard (Redis atomic INCR)
    │
    ▼
URL Safety Check (Validation & Blocklist)
    │
    ▼
Deduplication Check (Query originalUrl in DB)
    ├── Existing active & non-expired? ──► Return existing short code
    │
    ▼
Snowflake Service (Generates 64-bit ID locally)
    │
    ▼
Base62 Service (Encodes numeric ID to string shortCode)
    │
    ▼
PostgreSQL Insert (UNIQUE originalUrl constraint)
    ├── Race condition 23505? ──► Fetch winning record & return
    │
    ▼
Return HTTP 201 Response { shortCode, shortUrl, expiresAt }
```

### URL Redirect Flow (`GET /:shortCode`)
```text
GET /a8Kd2
    │
    ▼
Check Redis Cache (Key: url:a8Kd2)
    ├── Cache HIT ──► Validate Expiration ──► Async Kafka Click Event ──► HTTP 302 Redirect
    │
    ▼
Cache MISS
    │
    ▼
SingleFlight Coalescing (Only 1 request queries DB)
    │
    ▼
Query PostgreSQL
    ├── Not Found / Inactive ──► HTTP 404
    ├── Expired ──────────────► Delete Cache ──► HTTP 410
    │
    ▼
Populate Redis Cache (JSON payload + TTL)
    │
    ▼
Async Kafka Click Event (Non-blocking)
    │
    ▼
HTTP 302 Redirect
```

---

## 5. ID Generation

The system uses a **Snowflake-style 64-bit distributed ID generator**.

```text
┌──────────────────────────┬──────────────────┬──────────────────┐
│   Timestamp (41 bits)    │ Worker ID (10)   │ Sequence (12)    │
│  ms since Jan 1 2026 UTC │  0 to 1023       │ 0 to 4095 per ms │
└──────────────────────────┴──────────────────┴──────────────────┘
```

- **Timestamp (41 bits):** Milliseconds since custom epoch (`1767225600000` ms / 2026-01-01 UTC), providing ~69 years of operational lifespan.
- **Worker ID (10 bits):** Identifies the application instance (supports up to 1,024 nodes configured via `WORKER_ID` env variable).
- **Sequence (12 bits):** Supports up to 4,096 unique IDs per millisecond per node.

### Safety & Concurrency Guarantees
- **Rollover Handling:** If sequence overflows 4095 within the same millisecond, the generator spins until the next millisecond (`tilNextMillis`).
- **Clock Rollback Protection:** If system clock drifts backwards by $\le 5\text{ ms}$, the generator waits until the clock catches up. If drift is $> 5\text{ ms}$, it throws `ClockMovedBackwardsException`.

---

## 6. Snowflake vs DB Auto Increment vs UUID

| Identifier Mechanism | Generation Location | Storage Size | Time Ordered? | Compact Short Code? | Multi-Master Safe? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DB Auto-Increment** | Central Database | 64-bit integer | Yes | Yes (Base62) | No (Requires central locks/offsets) |
| **UUIDv4** | Application Instance | 128-bit (16 bytes) | No | No (36 chars / Base62 is long) | Yes |
| **UUIDv7** | Application Instance | 128-bit (16 bytes) | Yes | No (22+ chars in Base62) | Yes |
| **Snowflake ID** | Application Instance | 64-bit integer | Yes | **Yes (5–11 Base62 chars)** | **Yes (Decentralized per worker)** |

---

## 7. Why Snowflake Was Chosen

Snowflake was chosen based on the following system requirements:
- **Decentralized Generation:** Applications generate IDs locally without database round trips.
- **Database Independence:** ID allocation never creates database row/sequence lock contention.
- **Compact Numeric ID:** Produces a 64-bit positive integer suitable for concise Base62 encoding.
- **High Throughput:** Generates up to 4,096,000 IDs per second per worker node.

> **Crucial Distinction:** Snowflake is **not** chosen because time ordering is strictly required. It is chosen primarily because it provides **decentralized unique ID generation** and a **compact numeric identifier suitable for Base62 encoding**.
>
> **Important Principle:** **Base62 does not provide uniqueness.** The **Snowflake ID provides uniqueness**; Base62 only converts the numeric ID into a URL-friendly string representation.

---

## 8. Base62 Encoding

Base62 converts big-integer Snowflake IDs into compact, web-safe characters:

```text
Alphabet (62 characters):
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
```

### Conversion Example
```text
Numeric Snowflake ID: 123456789
        ↓
    Base62 Algorithm (Repeated division by 62)
        ↓
Short Code: "8M0kX"
```

The `Base62Service` is fully deterministic, supports bidirectional `encode(id: bigint)` and `decode(code: string)`, and passes unit tests across 0, maximum 64-bit integers, and boundary values.

---

## 9. Collision vs Deduplication

It is vital to distinguish **ID Uniqueness** from **URL Deduplication**:

- **ID Uniqueness:**
  ```text
  Request A → Snowflake ID 1001 → Code "g8"
  Request B → Snowflake ID 1002 → Code "g9"
  ```
  Guaranteed by the Snowflake generator design (timestamp + worker ID + sequence).

- **URL Deduplication:**
  ```text
  User A submits "https://google.com" → Code "abc"
  User B submits "https://google.com" → Code "abc"
  ```
  Guaranteed by database constraints (`UNIQUE(originalUrl)`). Snowflake does not perform URL deduplication.

---

## 10. Concurrent Same-URL Requests

Relying on application-level `SELECT` followed by `INSERT` introduces a severe race condition under high concurrency:

```text
Request A (Thread 1)                Request B (Thread 2)
       │                                   │
SELECT originalUrl = google.com     SELECT originalUrl = google.com
       │                                   │
   NOT FOUND                           NOT FOUND
       │                                   │
INSERT (Code "abc")                 INSERT (Code "xyz")  ◄── RACE CONDITION!
```

### Production Solution: Database Uniqueness Constraints
The service enforces a database constraint: `UNIQUE(originalUrl)` on the PostgreSQL `urls` table.

Under concurrent requests:
1. Both requests attempt to insert.
2. PostgreSQL accepts the first insert and throws error `23505` (unique_violation) on the second.
3. The `UrlService` catches exception `23505`, logs a warning, queries the winning record, and safely returns the existing short code.

---

## 11. Redis Cache-Aside

The service implements the **Cache-Aside (Lazy Loading)** pattern for redirects:

```text
GET /a8Kd2
   │
   ▼
Redis GET url:a8Kd2
 ├── HIT ──► Return JSON payload ──► HTTP 302 Redirect
 │
 └── MISS ──► Query PostgreSQL ──► Set Redis (Key: url:a8Kd2, EX: 86400s) ──► HTTP 302
```

### Redis Key & Payload Format
- **Key:** `url:{shortCode}`
- **Value:** `{"originalUrl":"https://example.com","expiresAt":"2027-01-01T00:00:00Z","isActive":true}`

Storing structured JSON in Redis allows cache hits to verify expiration (`expiresAt`) and active status (`isActive`) **without querying PostgreSQL**.

---

## 12. Cache Invalidation

> **Fundamental Principle:** **PostgreSQL is the source of truth. Redis is a performance layer.**

When a short URL is deleted or deactivated via `DELETE /api/v1/urls/:shortCode`:
1. PostgreSQL record is soft-deleted (`isActive = false`).
2. Redis key `url:{shortCode}` is invalidated via `DEL`.

### Cache Invalidation Resilience
If the Redis `DEL` operation fails (e.g., transient network glitch), `RedisService` executes an exponential backoff retry loop (up to 3 attempts). If invalidation still fails, error logs alert operators while PostgreSQL enforces `isActive = false` on subsequent cache misses.

---

## 13. Cache Stampede Protection

When a popular cache key expires (e.g., celebrity link receiving 10,000 requests/sec), a naïve system experiences a **Cache Stampede** (thundering herd problem), swamping PostgreSQL with 10,000 concurrent database queries.

### Solution: SingleFlight Request Coalescing
The service implements a `SingleFlight` utility (`src/common/utils/single-flight.ts`).

```text
10,000 Concurrent Requests for /a8Kd2
                 │
                 ▼
      SingleFlight Manager
                 │
  ┌──────────────┴──────────────┐
  ▼                             ▼
1 DB Query Executed     9,999 Requests Wait for Promise
  │                             │
  └──────────────┬──────────────┘
                 ▼
      Populate Redis Cache
                 ▼
    All 10,000 Requests Receive Result
```

Unit tests in `test/redirect.service.spec.ts` verify that 10 concurrent requests for an uncached short code result in **exactly 1 database query**.

---

## 14. Hot Keys & Celebrity Links

For extreme celebrity links ("Hot Keys") generating millions of reads per second:
- **Local Application Memory Cache (L1 Cache):** In-memory LRU cache inside NestJS nodes to intercept reads before Redis.
- **Redis Read Replicas / Cluster:** Read-traffic distribution across Redis read replicas.
- **CDN Edge Caching:** Offload HTTP redirects entirely to edge locations.

---

## 15. CDN / Edge Caching

Redirects (HTTP 302 Found) are highly cacheable at the CDN level.

```text
User ──► CDN Edge ──► Cache HIT ──► HTTP 302 (Latency < 5ms)
           │
       Cache MISS
           │
           ▼
    Load Balancer ──► URL Service ──► Redis ──► PostgreSQL
```

- **Cache-Control Header:** `Cache-Control: public, max-age=300, s-maxage=86400`
- **301 vs 302:** HTTP 302 (Found) is preferred over 301 (Moved Permanently) because 301 is permanently cached by browser clients, preventing server-side click analytics tracking and URL deactivation.

---

## 16. Analytics with Kafka

Click counts are **never** updated synchronously in PostgreSQL on redirects to avoid row lock contention:

```sql
-- AVOID ON REDIRECT PATH!
UPDATE urls SET clicks = clicks + 1 WHERE short_code = 'a8Kd2';
```

### Event-Driven Click Stream Architecture
When a redirect occurs, the service returns the HTTP 302 response immediately and asynchronously publishes a `ClickEventDto` to Kafka topic `url-click-events`.

```json
{
  "shortCode": "a8Kd2",
  "originalUrl": "https://example.com/long/url",
  "timestamp": "2026-09-29T10:00:00Z",
  "userAgent": "Mozilla/5.0...",
  "referrer": "https://google.com",
  "ip": "192.168.1.xxx"
}
```

- **Non-blocking Execution:** If Kafka is unavailable, the error is caught asynchronously and logged. **Kafka failures never crash or delay user redirects.**
- **IP Privacy Anonymization:** IP addresses are anonymized (`192.168.1.100` $\rightarrow$ `192.168.1.xxx`) prior to event publication.

---

## 17. URL Expiration

URL expiration supports optional timestamps (`expiresAt`):

- **No Expiration:** `expiresAt = NULL`
- **Active Expiration:** `Current Time < expiresAt` $\rightarrow$ HTTP 302 Redirect.
- **Expired:** `Current Time >= expiresAt` $\rightarrow$ HTTP 410 Gone.

### Expired Cache Cleanup
When a request encounters an expired URL, the service asynchronously deletes the Redis cache key to ensure subsequent requests do not receive stale mappings.

Background cleanup workers purge expired records from PostgreSQL in batches during low-traffic windows (`WHERE expiresAt < NOW() LIMIT 5000`).

---

## 18. Handling Billions of URLs

Scaling from thousands to billions of URLs follows a progressive architectural evolution:

```text
Single Database
      ↓
Database Indexes (shortCode, originalUrl, expiresAt)
      ↓
Read Replicas (Separate write and read traffic)
      ↓
Table Partitioning (Time-based or hash-based)
      ↓
Database Sharding (Horizontal partition across nodes)
```

---

## 19. Database Indexing

The primary redirect query is:
```sql
SELECT original_url, expires_at, is_active
FROM urls
WHERE short_code = 'a8Kd2';
```

Without an index, PostgreSQL executes a Sequential Scan ($O(N)$), failing at scale. The schema defines:
- `UNIQUE INDEX idx_urls_short_code ON urls(short_code);` (B-Tree lookup: $O(\log N)$)
- `UNIQUE INDEX idx_urls_original_url ON urls(original_url);` (Fast deduplication lookup)
- `INDEX idx_urls_expires_at ON urls(expires_at);` (Efficient batch cleanup)

---

## 20. Read Replicas

```text
                      Primary PostgreSQL (Writes)
                                  │
                       Replication (Async/Sync)
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   Read Replica 1          Read Replica 2          Read Replica 3
```

- Write requests (`POST /api/v1/urls`, `DELETE`) hit the **Primary DB**.
- Read misses (`GET /:shortCode`) hit **Read Replicas**.
- Redis caching absorbs ~99% of read traffic, protecting replicas from replication lag issues.

---

## 21. Sharding

When a single database node exceeds storage memory or disk I/O capacity, horizontal **Sharding** is introduced.

- **Shard Key:** `shortCode`
- **Routing:** `hash(shortCode) % totalShards`

Because every redirect request naturally includes `shortCode`, the Shard Router directs queries to the exact shard holding the target record without cross-shard scatter-gather queries.

---

## 22. Consistent Hashing

Traditional modulo hashing (`hash(key) % N`) causes catastrophic key remapping when adding or removing database nodes ($N \rightarrow N+1$ remaps ~100% of keys).

### Hash Ring & Virtual Nodes
Consistent Hashing maps both shards and `shortCode` keys onto a $2^{32}$ Hash Ring.

```text
           [Shard 1]
         /           \
  [Shard 3]         [Shard 2]
         \           /
           [Virtual]
```

- **Node Addition:** Adding a node remaps only $1/N$ of keys to the new shard.
- **Virtual Nodes:** Assigning multiple virtual tokens per physical node ensures uniform data distribution across shards.

---

## 23. Replication vs Sharding

| Aspect | Database Replication | Database Sharding |
| :--- | :--- | :--- |
| **Data Distribution** | **Same full copy** on all nodes | **Data partitioned** across different nodes |
| **Primary Benefit** | Read scalability & High Availability | Write & Storage capacity scalability |
| **Complexity** | Low to Medium | High (Shard routing, rebalancing) |

---

## 24. Rate Limiting

The `RateLimitGuard` protects `POST /api/v1/urls` against creation abuse using Redis atomic counters:

- Configured via `RATE_LIMIT_WINDOW_SECONDS=60` and `RATE_LIMIT_MAX_REQUESTS=30`.
- Client IP identified via `X-Forwarded-For` or socket address.
- Exceeding limit returns `HTTP 429 Too Many Requests`.

---

## 25. Malicious URL Protection

The `DefaultUrlSafetyService` validates incoming URLs:
1. Syntax and URL scheme validation (`http://` or `https://` required).
2. Domain blocklist verification against security databases (e.g., `phishing.test`, `malware.test`).
3. Interface `UrlSafetyChecker` allows seamless integration with third-party reputation providers (e.g., Google Safe Browsing API).

---

## 26. Failure Scenarios

- **Redis Down:** Application logs warning and seamlessly falls back to PostgreSQL queries.
- **Kafka Down:** Click events log fallbacks; redirects continue with zero degradation.
- **PostgreSQL Read Failure:** Returns HTTP 500 error response cleanly formatted by `HttpExceptionFilter`.
- **Clock Drift:** Snowflake generator catches drift $\le 5\text{ ms}$ or throws explicit `ClockMovedBackwardsException`.

---

## 27. Scalability Considerations

- **Stateless Application Tier:** NestJS nodes maintain no shared in-memory session state, enabling infinite horizontal auto-scaling behind an AWS ALB or NGINX load balancer.
- **Asynchronous Click Pipeline:** Kafka buffers click streams, isolating consumer database writes from traffic spikes.

---

## 28. Trade-offs

1. **Eventually Consistent Analytics:** Clicks are processed asynchronously via Kafka rather than real-time DB increments.
2. **Duplicate Code on Soft Delete:** If a URL is deleted and re-created later, a new Snowflake ID is assigned.
3. **Cache Invalidation Delays:** In rare Redis cluster partition events, stale cache keys persist until TTL expiry.

---

## 29. Local Setup

### Prerequisites
- Node.js v18+ & npm
- Docker & Docker Compose

### Step 1: Clone Repository & Install Dependencies
```bash
git clone <repository-url>
cd url-shortener
npm install
```

### Step 2: Configure Environment
```bash
cp .env.example .env
```

### Step 3: Run Unit Tests
```bash
npm test
```

### Step 4: Start Infrastructure via Docker Compose
```bash
docker compose up -d
```

### Step 5: Run Application Locally
```bash
npm run start:dev
```

The service will start on `http://localhost:3000`.

---

## 30. API Documentation

Interactive Swagger OpenAPI documentation is accessible at:
👉 **`http://localhost:3000/docs`**

### API Endpoints Summary

| Method | Endpoint | Description | Request Body / Params | Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/urls` | Shorten a long URL | `{ "originalUrl": "https://example.com", "expiresAt": "2027-01-01T00:00:00Z" }` | `201 Created` `{ "shortCode": "a8Kd2", "shortUrl": "...", "expiresAt": "..." }` |
| `GET` | `/:shortCode` | Redirect to original URL | `:shortCode` (e.g., `a8Kd2`) | `302 Found` (Redirect) |
| `GET` | `/api/v1/urls/:shortCode` | Get URL metadata | `:shortCode` | `200 OK` (URL entity details) |
| `DELETE` | `/api/v1/urls/:shortCode` | Deactivate URL & clear cache | `:shortCode` | `200 OK` `{ "success": true, "message": "..." }` |
| `GET` | `/api/v1/urls/:shortCode/stats` | Get click analytics | `:shortCode` | `200 OK` `{ "shortCode": "a8Kd2", "totalClicks": 42 }` |
| `GET` | `/health` | System health check | None | `200 OK` `{ "status": "ok", "services": { ... } }` |
