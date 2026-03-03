# Print System Architecture

## Overview

OrderChop uses an event-driven, Kafka-based print system to deliver HTML receipts to Star Micronics thermal printers via email. When a restaurant registers their Star Micronics printer's device email, the system automatically sends formatted HTML receipts whenever qualifying orders arrive.

```
┌─────────────────────────────────┐
│    OrderEventConsumer           │
│  (order.completed /             │
│   order.status_changed)         │
└──────────┬──────────────────────┘
           │ Creates PrintJob + publishes
           ▼
┌─────────────────────────────────┐
│      Kafka: print.jobs          │──────────┐
└──────────┬──────────────────────┘          │
           │                                 │ on failure
           ▼                                 ▼
┌─────────────────────────────────┐  ┌──────────────────────┐
│    PrintJobConsumer             │  │ Kafka: print.jobs.    │
│  (format receipt + send email)  │  │       retry           │
│                                 │  └──────────┬───────────┘
│  Concurrency:                   │             │ re-consumed
│  - Global per restaurant        │◄────────────┘
│  - Per-printer                  │
└──────────┬──────────────────────┘
           │                  │
           │ success          │ max retries exceeded
           ▼                  ▼
    PrintJob.status      ┌──────────────────────┐
      = 'sent'           │ Kafka: print.jobs.    │
                         │       dead-letter      │
    Email delivered       └──────────┬───────────┘
    to printer                       ▼
                         ┌──────────────────────┐
                         │ PrintDeadLetterConsumer│
                         │ (logs + updates DB)    │
                         └──────────────────────┘
```

---

## End-to-End Flows

This section shows the complete path for every print scenario. Each diagram traces from the originating event through to the printer receiving the email.

### Flow 1: Auto-Print (Order Completed)

Triggered when an order reaches a completed/fulfillment status. Creates customer receipt(s) on matching receipt-type printers.

```
  Kafka: orderchop.orders             OrderEventConsumer
  ─────────────────────────           ────────────────────
        │                                     │
        │  order.completed                    │
        │  OR order.status_changed            │
        │  (ready/out_for_delivery/           │
        │   delivered/completed)              │
        ├────────────────────────────────────►│
        │                                     │
        │                          processOrderAsCompleted()
        │                          [idempotent per orderId]
        │                                     │
        │                          triggerAutoPrint(restaurantId,
        │                                        orderId, orderType)
        │                                     │
        │                                     ▼
        │                          ┌──────────────────────────┐
        │                          │ 1. Load PrinterSettings   │
        │                          │    - enabled? autoPrint?  │
        │                          │ 2. Check order type toggle│
        │                          │    (printPickup, etc.)    │
        │                          │ 3. Find receipt printers  │
        │                          │    matching orderType     │
        │                          │ 4. selectPrintersForJob() │
        │                          │    - duplicate: all       │
        │                          │    - distribute: one (RR) │
        │                          │ 5. Load Order + Restaurant│
        │                          │ 6. Resolve timezone       │
        │                          │ 7. formatCustomerReceipt()│
        │                          │ 8. Create PrintJob(queued)│
        │                          │ 9. Publish to print.jobs  │
        │                          └──────────┬───────────────┘
        │                                     │
        │                                     ▼
        │                          Kafka: print.jobs
        │                                     │
        │                                     ▼
        │                          ┌──────────────────────────┐
        │                          │ PrintJobConsumer          │
        │                          │ 1. Load PrintJob (queued?)│
        │                          │ 2. Acquire semaphores     │
        │                          │ 3. Load Printer (enabled?)│
        │                          │ 4. Update status: sending │
        │                          │ 5. Re-format if needed    │
        │                          │ 6. sendPrintJob() via     │
        │                          │    PrintDeliveryService   │
        │                          │ 7. Update status: sent    │
        │                          └──────────┬───────────────┘
        │                                     │
        │                                     ▼
        │                          ┌──────────────────────────┐
        │                          │ PrintDeliveryService      │
        │                          │ 1. Resolve from address   │
        │                          │ 2. Build subject line     │
        │                          │    "Order #<last6>"       │
        │                          │ 3. Send via Mailgun       │
        │                          └──────────┬───────────────┘
        │                                     │
        │                                     ▼
        │                          Star Micronics printer
        │                          receives email, prints HTML
```

### Flow 2: Kitchen Print (Order Preparing)

Triggered when an order status changes to `preparing`. Creates kitchen tickets on matching kitchen-type printers.

```
  Kafka: orderchop.orders             OrderEventConsumer
  ─────────────────────────           ────────────────────
        │                                     │
        │  order.status_changed               │
        │  { newStatus: 'preparing' }         │
        ├────────────────────────────────────►│
        │                                     │
        │                          handleOrderStatusChanged()
        │                                     │
        │                          triggerKitchenPrint(restaurantId,
        │                                             orderId, orderType)
        │                                     │
        │                                     ▼
        │                          ┌──────────────────────────┐
        │                          │ 1. Load PrinterSettings   │
        │                          │    - enabled? (no autoPrint│
        │                          │      check for kitchen)   │
        │                          │ 2. Find kitchen printers  │
        │                          │    matching orderType     │
        │                          │ 3. selectPrintersForJob() │
        │                          │    indexKey: kitchen_<type>│
        │                          │ 4. Load Order + Restaurant│
        │                          │ 5. Resolve timezone       │
        │                          │ 6. formatKitchenTicket()  │
        │                          │    (large #, NO pricing)  │
        │                          │ 7. Create PrintJob(queued)│
        │                          │    trigger: 'kitchen'     │
        │                          │ 8. Publish to print.jobs  │
        │                          └──────────┬───────────────┘
        │                                     │
        │                                     ▼
        │                          (same PrintJobConsumer flow
        │                           as auto-print above)
```

**Key difference from auto-print:**
- Kitchen print does NOT check the `autoPrint` setting — only the master `enabled` toggle
- Uses `formatKitchenTicket()` (large order number, items only, no pricing)
- Index key uses `kitchen_` prefix (e.g., `kitchen_pickup`) to keep round-robin state separate from receipt printers
- Only fires for `newStatus === 'preparing'` — not for completed/delivered statuses

### Flow 3: Manual Print (User-Initiated)

Triggered when a restaurant staff member clicks "Print Receipt" on an order. Always sends to ALL matching printers regardless of distribution mode.

```
  Restaurant Manager UI               oc-server API
  ──────────────────────              ──────────────
        │                                     │
        │  Click "Print Receipt"              │
        │  → printOrder server action         │
        ├────────────────────────────────────►│
        │                          POST /api/v1/printers/
        │                               orders/:orderId/print
        │                                     │
        │                                     ▼
        │                          ┌──────────────────────────┐
        │                          │ 1. Load Order from DB     │
        │                          │ 2. Find ALL enabled       │
        │                          │    printers for orderType │
        │                          │    (NO distribution mode  │
        │                          │     filtering — always    │
        │                          │     sends to ALL)         │
        │                          │ 3. Load Restaurant        │
        │                          │ 4. Resolve timezone       │
        │                          │ 5. For EACH printer:      │
        │                          │    a. Format receipt       │
        │                          │       (kitchen ticket if   │
        │                          │        type='kitchen',    │
        │                          │        else customer)     │
        │                          │    b. Create PrintJob     │
        │                          │       trigger: 'manual'   │
        │                          │    c. Publish to          │
        │                          │       print.jobs          │
        │                          └──────────┬───────────────┘
        │                                     │
        │                          201 { printJobIds, printerCount }
        │◄────────────────────────────────────┤
        │                                     │
        │                          (PrintJobConsumer processes
        │                           each job as normal)
```

**Why manual print ignores distribution mode:** The user explicitly chose to print — they expect ALL their printers to produce the receipt. Distribution mode is an optimization for automatic triggers only.

### Flow 4: Retry (Failed Job Re-Attempt)

Triggered when a user clicks "Retry" on a failed or dead-lettered print job, or automatically via the retry topic.

```
  ── Automatic Retry (from PrintJobConsumer failure) ──

  PrintJobConsumer                     Kafka
  ────────────────                    ───────
        │                                │
        │  sendPrintJob() fails          │
        │  (retryable error)             │
        │  attempts < maxAttempts        │
        │                                │
        │  1. Update PrintJob:           │
        │     status → failed            │
        │     lastError → error msg      │
        │     attempts += 1              │
        │                                │
        │  2. Publish to                 │
        │     print.jobs.retry ─────────►│
        │     headers:                   │
        │       retry-after: timestamp   │
        │       retry-attempt: N         │
        │       original-error: msg      │
        │                                │
        │                                │
        │  PrintJobConsumer picks up     │
        │  retry message (subscribes to  │
        │  both print.jobs AND           │
        │◄───print.jobs.retry)───────────│
        │                                │
        │  3. Update PrintJob:           │
        │     status → queued            │
        │  4. Normal processing flow     │
        │     (format + send)            │


  ── Manual Retry (from UI) ──

  Restaurant Manager UI               oc-server API
  ──────────────────────              ──────────────
        │                                     │
        │  Click "Retry" on failed job        │
        ├────────────────────────────────────►│
        │                          POST /api/v1/printers/
        │                               jobs/:printJobId/retry
        │                                     │
        │                          1. Load PrintJob            │
        │                          2. Reset: status → queued   │
        │                             attempts → 0             │
        │                          3. Publish to print.jobs    │
        │                                     │
        │◄────────────────────────────────────┤
        │                          200 { success: true }
```

---

## Distribution Modes

Distribution mode controls how orders are assigned to printers when multiple printers handle the same order type. This applies only to automatic triggers (auto-print and kitchen print) — manual prints always go to all printers.

### Duplicate Mode (Default)

Every matching printer receives every order.

```
  Order A (pickup) ──► Printer 1 (receipt, pickup)  ✓ prints
                   └─► Printer 2 (receipt, pickup)  ✓ prints

  Order B (pickup) ──► Printer 1 (receipt, pickup)  ✓ prints
                   └─► Printer 2 (receipt, pickup)  ✓ prints
```

**Use cases:**
- Redundancy — if one printer is offline, the other still prints
- Multiple stations — front counter and back office each need a copy
- Small operations where duplicate paper is acceptable

### Distribute Mode (Round-Robin)

Each order goes to ONE printer, rotating between matching printers.

```
  Order A (pickup) ──► Printer 1 (receipt, pickup)  ✓ prints
                   └─► Printer 2 (receipt, pickup)  ✗ skipped

  Order B (pickup) ──► Printer 1 (receipt, pickup)  ✗ skipped
                   └─► Printer 2 (receipt, pickup)  ✓ prints

  Order C (pickup) ──► Printer 1 (receipt, pickup)  ✓ prints  (wraps around)
                   └─► Printer 2 (receipt, pickup)  ✗ skipped
```

**Use cases:**
- Workload splitting — divide orders between two receipt printers
- Paper savings — each order prints once, not N times
- High-volume restaurants with dedicated printer stations

### Round-Robin Index Tracking

The round-robin position is stored in `PrinterSettings.lastDistributedIndex`, a Map with separate keys for each order type context:

| Index Key | Context |
|-----------|---------|
| `pickup` | Receipt printers handling pickup orders |
| `delivery` | Receipt printers handling delivery orders |
| `dineIn` | Receipt printers handling dine-in orders |
| `kitchen_pickup` | Kitchen printers handling pickup orders |
| `kitchen_delivery` | Kitchen printers handling delivery orders |
| `kitchen_dineIn` | Kitchen printers handling dine-in orders |

The `kitchen_` prefix prevents receipt and kitchen round-robin from interfering with each other.

### Implementation: `selectPrintersForJob()`

**File:** `src/kafka/consumers/OrderEventConsumer.ts`

```
selectPrintersForJob(printers[], settings, indexKey)
  │
  ├─ printers.length <= 1? → return printers (no selection needed)
  │
  ├─ distributionMode === 'duplicate'? → return all printers
  │
  └─ distributionMode === 'distribute':
       1. Read currentIndex = lastDistributedIndex[indexKey] ?? 0
       2. If currentIndex >= printers.length → reset to 0
       3. Select printers[currentIndex]
       4. Compute nextIndex = (currentIndex + 1) % printers.length
       5. Persist nextIndex atomically via updateDistributedIndex()
       6. Return [selectedPrinter]
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Single printer matching | Always returned regardless of mode — no DB write |
| No printers matching | Empty array returned — no print jobs created |
| Printer removed (index stale) | Index wraps: if `currentIndex >= printers.length`, resets to 0 |
| Disabled printer | Filtered out before `selectPrintersForJob` — only enabled printers participate |
| Manual print | Distribution mode ignored — always sends to ALL matching printers |
| New printer added | Joins the rotation at the next index wrap; no special handling needed |

---

## Print Job Lifecycle

### State Machine

```
                          ┌──────────┐
                          │ pending  │  PrintJob created, not yet published
                          └────┬─────┘
                               │ publish to print.jobs
                               ▼
                          ┌──────────┐
              ┌──────────►│  queued  │  Awaiting PrintJobConsumer pickup
              │           └────┬─────┘
              │                │ consumer picks up message
              │                ▼
              │           ┌──────────┐
              │           │ sending  │  Formatting receipt + sending email
              │           └────┬─────┘
              │                │
              │      ┌─────────┴──────────┐
              │      │                    │
              │      ▼                    ▼
              │ ┌──────────┐         ┌──────────┐
              │ │   sent   │         │  failed  │
              │ │ (success)│         │          │
              │ └──────────┘         └────┬─────┘
              │                           │
              │            ┌──────────────┴──────────────┐
              │            │                             │
              │   retryable error               permanent error
              │   AND attempts < max            OR attempts >= max
              │            │                             │
              │            ▼                             ▼
              │  publish to print.jobs.retry    ┌───────────────┐
              │  (exponential backoff)          │  dead_letter  │
              │            │                    └───────┬───────┘
              │            │                            │
              │            ▼                   publish to print.jobs.
              │  PrintJobConsumer picks up       dead-letter
              │  retry message                          │
              │            │                            ▼
              │  reset status → queued        PrintDeadLetterConsumer
              └────────────┘                  (log + confirm status)
```

### Status Reference

| Status | Meaning | Next States |
|--------|---------|-------------|
| `pending` | PrintJob created in DB, not yet published to Kafka | `queued` |
| `queued` | Published to `print.jobs` topic, awaiting consumer | `sending` |
| `sending` | Consumer acquired semaphores, formatting/sending | `sent`, `failed` |
| `sent` | Email delivered to Mailgun → printer receives it | (terminal) |
| `failed` | Send attempt failed | `queued` (retry), `dead_letter` |
| `dead_letter` | All retries exhausted or permanent error | `queued` (manual retry) |

### Retry Behavior

- **Exponential backoff delays:** 5s → 15s → 45s (3 attempts)
- **Retryable errors:** network timeouts (ECONNABORTED, ETIMEDOUT, ECONNREFUSED), HTTP 5xx
- **Permanent errors:** HTTP 4xx (invalid email, auth failure) — go straight to dead_letter
- **Unknown errors:** treated as retryable (safer to retry than drop)
- **Manual retry:** resets attempts to 0, status to `queued`, re-publishes to `print.jobs`

---

## Printer Configuration Examples

### Scenario 1: Single Receipt Printer

The simplest setup — one printer handles all order types.

```
Printers:
  ┌─────────────────────────────────────────┐
  │ "Front Counter"                         │
  │   type: receipt                         │
  │   email: printer1@star.cloudprnt.com    │
  │   orderTypes: [pickup, delivery, dineIn]│
  └─────────────────────────────────────────┘

Settings:
  enabled: true
  autoPrint: true
  distributionMode: duplicate (irrelevant — single printer)

Behavior:
  All orders (pickup, delivery, dine-in) → Front Counter
  Distribution mode has no effect with a single printer.
```

### Scenario 2: Receipt + Kitchen Printer

Separate printers for customer receipts and kitchen tickets.

```
Printers:
  ┌─────────────────────────────────────────┐
  │ "Front Counter"                         │
  │   type: receipt                         │
  │   email: receipt@star.cloudprnt.com     │
  │   orderTypes: [pickup, delivery, dineIn]│
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ "Kitchen Display"                       │
  │   type: kitchen                         │
  │   email: kitchen@star.cloudprnt.com     │
  │   orderTypes: [pickup, delivery, dineIn]│
  └─────────────────────────────────────────┘

Settings:
  enabled: true
  autoPrint: true
  distributionMode: duplicate

Behavior:
  Order completed (pickup):
    → Front Counter prints customer receipt (subtotal, tax, total, etc.)
  Order status → 'preparing':
    → Kitchen Display prints kitchen ticket (large order #, items only, NO pricing)

  Receipt and kitchen printers never overlap — different triggers, different formats.
```

### Scenario 3: Two Receipt Printers — Duplicate Mode

Both printers print every order. Good for redundancy or multiple stations.

```
Printers:
  ┌─────────────────────────────────────────┐
  │ "Front Counter"                         │
  │   type: receipt                         │
  │   email: front@star.cloudprnt.com       │
  │   orderTypes: [pickup, delivery]        │
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ "Back Office"                           │
  │   type: receipt                         │
  │   email: back@star.cloudprnt.com        │
  │   orderTypes: [pickup, delivery]        │
  └─────────────────────────────────────────┘

Settings:
  enabled: true
  autoPrint: true
  distributionMode: duplicate

Behavior:
  Order A (pickup):
    → Front Counter: ✓ prints customer receipt
    → Back Office:   ✓ prints customer receipt
  Order B (delivery):
    → Front Counter: ✓ prints customer receipt
    → Back Office:   ✓ prints customer receipt

  Every order produces 2 copies — one at each station.
```

### Scenario 4: Two Receipt Printers — Distribute Mode

Orders alternate between printers. Good for high-volume workload splitting.

```
Printers:
  ┌─────────────────────────────────────────┐
  │ "Station A"                             │
  │   type: receipt                         │
  │   email: a@star.cloudprnt.com           │
  │   orderTypes: [pickup, delivery]        │
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ "Station B"                             │
  │   type: receipt                         │
  │   email: b@star.cloudprnt.com           │
  │   orderTypes: [pickup, delivery]        │
  └─────────────────────────────────────────┘

Settings:
  enabled: true
  autoPrint: true
  distributionMode: distribute
  lastDistributedIndex: { pickup: 0, delivery: 0 }

Behavior:
  Order 1 (pickup):  → Station A prints  (index advances to 1)
  Order 2 (pickup):  → Station B prints  (index wraps to 0)
  Order 3 (pickup):  → Station A prints  (index advances to 1)
  Order 4 (delivery): → Station A prints (delivery index starts at 0)
  Order 5 (delivery): → Station B prints (delivery index advances to 1)

  Each order prints exactly once. Separate round-robin per order type.
```

### Scenario 5: Mixed Setup — 2 Receipt + 1 Kitchen with Order Type Specialization

Advanced setup with printers specialized by order type and a kitchen printer.

```
Printers:
  ┌─────────────────────────────────────────┐
  │ "Pickup Counter"                        │
  │   type: receipt                         │
  │   email: pickup@star.cloudprnt.com      │
  │   orderTypes: [pickup]                  │
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ "Delivery Desk"                         │
  │   type: receipt                         │
  │   email: delivery@star.cloudprnt.com    │
  │   orderTypes: [delivery]                │
  └─────────────────────────────────────────┘
  ┌─────────────────────────────────────────┐
  │ "Kitchen Line"                          │
  │   type: kitchen                         │
  │   email: kitchen@star.cloudprnt.com     │
  │   orderTypes: [pickup, delivery, dineIn]│
  └─────────────────────────────────────────┘

Settings:
  enabled: true
  autoPrint: true
  distributionMode: distribute (only matters if 2+ share an order type)

Behavior:
  Pickup order completed:
    → Pickup Counter: prints customer receipt (only receipt printer for pickup)
  Delivery order completed:
    → Delivery Desk: prints customer receipt (only receipt printer for delivery)
  Any order status → 'preparing':
    → Kitchen Line: prints kitchen ticket (only kitchen printer)

  Distribution mode has no effect here because no two printers of the same type
  share the same order type. Each printer handles its own lane exclusively.
```

---

## Queue Abstraction Layer

The print system uses a swappable queue abstraction so the backend can be changed by switching a single environment variable.

### QueuePort Interface

```typescript
// src/ports/QueuePort.ts

interface QueueMessage {
  key: string;            // Partition key (restaurantId for locality)
  value: Record<string, unknown>;  // Serializable payload
  headers?: Record<string, string>; // Metadata (timestamps, retry info)
}

type MessageHandler = (message: QueueMessage) => Promise<void>;

interface ConsumeOptions {
  concurrency?: number;
  retries?: number;
  deadLetterTopic?: string;
  groupId?: string;
}

interface QueuePort {
  publish(topic: string, message: QueueMessage): Promise<void>;
  consume(topic: string, handler: MessageHandler, options?: ConsumeOptions): Promise<void>;
  disconnect(): Promise<void>;
}
```

### QueueFactory

```typescript
// src/factories/QueueFactory.ts
import { getQueueAdapter } from '../factories/QueueFactory';

const queue = getQueueAdapter('kafka');  // or 'mongo'
await queue.publish('print.jobs', { key: restaurantId, value: payload });
```

Set `QUEUE_ADAPTER` env var to switch between adapters.

### KafkaQueueAdapter (Production)

- Wraps existing KafkaJS producer/consumer from `config/kafka.ts`
- Uses singleton producer (already connected at startup)
- Creates new consumer per `consume()` call with its own group ID
- `partitionsConsumedConcurrently` controls parallelism
- Headers converted between `Record<string, string>` ↔ KafkaJS Buffer format

### MongoQueueAdapter (Development)

- Polls `queue_messages` MongoDB collection every 1 second
- Atomic message claiming via `findOneAndUpdate` (status: pending → processing)
- In-memory concurrency counter (not partition-based)
- **Not production-scale** — intended for local dev and testing without Kafka
- Set `QUEUE_ADAPTER=mongo` in env to use

> **Note:** The print consumers (PrintJobConsumer, PrintDeadLetterConsumer) use KafkaJS directly rather than the QueuePort abstraction, matching the existing consumer patterns in the codebase (e.g., OrderEventConsumer). The QueuePort is available for future services that need backend-agnostic queue access.

## Kafka Topics

| Topic | Purpose | Partitions | Consumer Group |
|-------|---------|------------|----------------|
| `print.jobs` | Main print job processing queue | 3 | `print-worker-group` |
| `print.jobs.retry` | Retry queue for failed jobs (exponential backoff) | 3 | `print-worker-group` |
| `print.jobs.dead-letter` | Permanently failed jobs (logging + observability) | 3 | `print-dead-letter-group` |

All topics are auto-created by `ensureTopics()` on startup when `ENABLE_KAFKA=true`.

### Message Payload (print.jobs)

```json
{
  "printJobId": "67abc123...",
  "restaurantId": "67abc456...",
  "printerId": "67abc789...",
  "orderId": "67abcdef...",
  "trigger": "auto"
}
```

The payload contains only IDs — the consumer loads full documents from MongoDB. This keeps messages small and ensures the consumer always works with fresh data.

`trigger` values: `"auto"` (order completed), `"manual"` (user-initiated), `"kitchen"` (preparing status), `"retry"` (re-attempt).

### Retry Headers

When a job is retried, these headers are added to the `print.jobs.retry` message:

| Header | Value | Example |
|--------|-------|---------|
| `retry-after` | Unix timestamp (ms) for scheduled retry | `1709500000000` |
| `retry-attempt` | Current attempt number (1-based) | `2` |
| `original-error` | Error message from the failed attempt | `ETIMEDOUT` |

### Dead-Letter Headers

When a job is dead-lettered, these headers are added to the `print.jobs.dead-letter` message:

| Header | Value | Example |
|--------|-------|---------|
| `final-error` | Last error message before giving up | `HTTP 401 Unauthorized` |
| `total-attempts` | Total number of attempts made | `3` |

## Consumers

### PrintJobConsumer

**File:** `src/kafka/consumers/PrintJobConsumer.ts`
**Group:** `print-worker-group`
**Topics:** `print.jobs`, `print.jobs.retry`

Processing flow:
1. Deserialize message → extract printJobId, restaurantId, printerId, orderId
2. Load PrintJob from DB → validate status is `queued`
3. Acquire concurrency semaphores (global + per-printer)
4. Load Printer config → check `enabled`
5. Update status to `sending`
6. Generate receipt HTML via `ReceiptFormatter` (if not already stored on PrintJob):
   - `trigger === 'kitchen'` → `formatKitchenTicket()`
   - All others → `formatCustomerReceipt()`
7. Send email via `PrintDeliveryService.sendPrintJob()`
8. Update PrintJob status to `sent` with `sentAt` timestamp

**On failure:**
- `attempts < maxAttempts` AND retryable error → publish to `print.jobs.retry` with exponential backoff
- `attempts >= maxAttempts` OR permanent error → publish to `print.jobs.dead-letter`, status → `dead_letter`

**Retry delays (exponential):** 5 seconds, 15 seconds, 45 seconds

### PrintDeadLetterConsumer

**File:** `src/kafka/consumers/PrintDeadLetterConsumer.ts`
**Group:** `print-dead-letter-group`
**Topic:** `print.jobs.dead-letter`

Simple consumer that:
1. Extracts `final-error` and `total-attempts` from message headers
2. Loads PrintJob and ensures status is `dead_letter`
3. Logs error with full context (restaurantId, orderId, printerId, error, attempts)

Acts as a safety net — PrintJobConsumer already sets `dead_letter` status before publishing to the DLQ topic.

### Registration

Both consumers are registered in `src/index.ts` bootstrap, guarded by `ENABLE_PRINT_WORKER` feature flag:

```typescript
if (env.ENABLE_PRINT_WORKER) {
  const printJobConsumer = new PrintJobConsumer();
  await printJobConsumer.start();
  consumers.push(printJobConsumer);

  const printDeadLetterConsumer = new PrintDeadLetterConsumer();
  await printDeadLetterConsumer.start();
  consumers.push(printDeadLetterConsumer);
}
```

## Concurrency Model

The system enforces two levels of concurrency to prevent overwhelming printers:

### Global Concurrency (per restaurant)

- Controlled by `PRINT_GLOBAL_CONCURRENCY` env var (default: 2) — internal tuning knob, not user-configurable via API
- In-memory semaphore keyed by restaurantId in `PrintJobConsumer`
- Limits total parallel print jobs across all printers for one restaurant

### Per-Printer Concurrency

- Controlled by `Printer.concurrency` (default: 1)
- Separate in-memory semaphore per printerId
- Limits parallel jobs to a single printer (most printers can only handle one job at a time)

### Backpressure

When all concurrency slots are full:
1. Consumer pauses the Kafka partition for 2 seconds
2. After 2 seconds, partition resumes and the message is reprocessed
3. If slots are still full, the cycle repeats

This is native KafkaJS backpressure — no external rate limiters needed.

## Receipt Formatting

**File:** `src/services/ReceiptFormatter.ts`

### Customer Receipt (`formatCustomerReceipt`)

Generated for `auto`, `manual`, and `retry` triggers.

Content:
- Restaurant header (name, address, phone)
- Order number + type badge (Pickup/Delivery/Dine-In)
- Customer name (when available)
- Itemized list with quantities, modifiers, and special instructions
- Pricing breakdown: subtotal, tax, delivery fee, platform fee, tip, total
- Payment status
- Timestamp in restaurant timezone
- "Thank you for your order!" footer

### Kitchen Ticket (`formatKitchenTicket`)

Generated for `kitchen` trigger only.

Content:
- Restaurant name
- **LARGE** order number header (28px font)
- Order type badge
- Items with quantities, modifiers, and special instructions
- **NO pricing information**
- Timestamp in restaurant timezone

### HTML Requirements

- **Inline CSS only** — no external stylesheets (email rendering)
- **Monospace font** (Courier New) for alignment
- **Max width 320px** — optimized for ~80mm thermal paper (~42 characters/line)
- All monetary values: `(cents / 100).toFixed(2)` with currency symbol
- Timestamps: `Intl.DateTimeFormat` with restaurant timezone from store_hours
- User-provided content escaped via `escapeHtml()` to prevent injection

## Email-Based Print Delivery

**File:** `src/services/PrintDeliveryService.ts`

Star Micronics printers receive print jobs via email. The system sends HTML receipts to the printer's registered device email address using the existing Mailgun provider.

### sendPrintJob(printJob, printer, receiptHtml)

- **To:** `printer.email` (Star Micronics device email)
- **From:** Resolved via priority chain (see below)
- **Subject:** `Order #${last6OfOrderId}` (Star printers use subject as job name)
- **Body:** HTML receipt

### From Address Resolution

Priority order:
1. `PrinterSettings.emailFrom` — per-restaurant custom sender
2. `PRINT_EMAIL_FROM` env var — system-wide print sender
3. `EMAIL_FROM_ADDRESS` env var — general system email sender
4. `noreply@${EMAIL_DOMAIN}` — fallback

### Error Classification

| Error Type | Examples | Retryable? |
|-----------|---------|------------|
| Network errors | ECONNABORTED, ETIMEDOUT, ECONNREFUSED | Yes |
| Server errors | HTTP 500, 502, 503 | Yes |
| Client errors | HTTP 400, 401, 403, 422 | No (permanent) |
| Unknown errors | — | Yes (safe default) |

### Test Print

`sendTestPrint(printer, restaurantName)` sends a sample receipt with dummy order data to verify the printer receives and renders HTML correctly.

## Auto-Print Trigger

**File:** `src/kafka/consumers/OrderEventConsumer.ts` → `triggerAutoPrint()`

When an order is completed, the system automatically creates print jobs for matching receipt printers.

### Trigger Flow

```
order.completed / order.status_changed (qualifying status)
  → OrderEventConsumer.processOrderAsCompleted()
    → triggerAutoPrint(restaurantId, orderId, orderType)
```

### Checks

1. **PrinterSettings** exists AND `enabled === true` AND `autoPrint === true`
2. **Order type** matches settings toggle:
   - `pickup` → `printPickup`
   - `delivery` → `printDelivery`
   - `dine_in` / `dineIn` → `printDineIn`
3. Find enabled printers with `type === 'receipt'` matching the order type
4. **Apply distribution mode** via `selectPrintersForJob()`:
   - `duplicate`: all matching printers receive the order (default)
   - `distribute`: one printer selected via round-robin using `lastDistributedIndex[orderType]`
5. For each selected printer: create PrintJob → format receipt → publish to `print.jobs`

### Idempotency

Auto-print runs inside `processOrderAsCompleted()` which is guarded by `tryProcessEvent('order_completed_process:${orderId}')`. This prevents duplicate print jobs when both `order.completed` and `order.status_changed` fire for the same order.

### Failure Handling

All print failures are caught and logged — auto-print **never blocks the order flow**. If printing fails, orders continue processing normally.

## Kitchen Print Trigger

**File:** `src/kafka/consumers/OrderEventConsumer.ts` → `triggerKitchenPrint()`

When an order status changes to `preparing`, kitchen tickets are printed on kitchen-type printers.

### Trigger Flow

```
order.status_changed → newStatus === 'preparing'
  → OrderEventConsumer.handleOrderStatusChanged()
    → triggerKitchenPrint(restaurantId, orderId, orderType)
```

### Checks

1. **PrinterSettings** exists AND `enabled === true` (master toggle only — `autoPrint` not checked)
2. Find enabled printers with `type === 'kitchen'` matching the order type
3. **Apply distribution mode** via `selectPrintersForJob()`:
   - `duplicate`: all matching kitchen printers receive the order (default)
   - `distribute`: one printer selected via round-robin using `lastDistributedIndex[kitchen_<orderType>]`
4. For each selected printer: create PrintJob (trigger: `kitchen`) → format kitchen ticket → publish to `print.jobs`

### Dual-Event Safety

Kitchen triggers only fire for `newStatus === 'preparing'`. The `order.status_changed` event for `completed` status is ignored by the kitchen trigger, preventing duplicate tickets.

## MongoDB Models

### Printer (`src/domain/models/Printer.ts`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| restaurantId | ObjectId | required | Tenant isolation |
| name | string | required | Display name (e.g., "Front Counter") |
| email | string | required | Star Micronics device email |
| type | 'receipt' \| 'kitchen' | 'receipt' | Printer purpose |
| enabled | boolean | true | Whether printer accepts jobs |
| orderTypes | string[] | ['pickup', 'delivery', 'dineIn'] | Which order types trigger this printer |
| concurrency | number | 1 | Max parallel jobs for this printer |

**Indexes:** `{ restaurantId: 1, email: 1 }` (unique)

### PrintJob (`src/domain/models/PrintJob.ts`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| restaurantId | ObjectId | required | Tenant isolation |
| printerId | ObjectId | required | Ref to Printer |
| orderId | ObjectId | required | Ref to Order |
| status | enum | 'pending' | Job lifecycle state |
| trigger | 'auto' \| 'manual' \| 'retry' \| 'kitchen' | required | What initiated the print |
| attempts | number | 0 | Send attempts so far |
| maxAttempts | number | 3 | Max retries before dead-letter |
| lastError | string | — | Most recent error message |
| receiptHtml | string | — | Pre-rendered HTML receipt |
| timezone | string | — | Restaurant timezone for formatting |
| scheduledAt | Date | — | When job was scheduled |
| sentAt | Date | — | When email was successfully sent |

**Indexes:** `{ restaurantId: 1, status: 1 }`, `{ printerId: 1, status: 1 }`, `{ orderId: 1 }`

### PrinterSettings (`src/domain/models/PrinterSettings.ts`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| restaurantId | ObjectId | required | One per restaurant (unique) |
| enabled | boolean | false | Master toggle for all printing |
| autoPrint | boolean | true | Auto-print on order completion |
| printPickup | boolean | true | Print pickup orders |
| printDelivery | boolean | true | Print delivery orders |
| printDineIn | boolean | true | Print dine-in orders |
| globalConcurrency | number | 2 | Internal: max concurrent print jobs per restaurant. Not exposed via API — set via `PRINT_GLOBAL_CONCURRENCY` env var |
| distributionMode | 'duplicate' \| 'distribute' | 'duplicate' | How orders are sent to matching printers: duplicate = all get every order, distribute = round-robin |
| lastDistributedIndex | Map<string, number> | {} | Internal: round-robin position per order type key (e.g., `{ 'pickup': 1, 'kitchen_pickup': 2 }`) |
| emailFrom | string | — | Custom from address for print emails |

### QueueMessage (`src/domain/models/QueueMessage.ts`)

Used by MongoQueueAdapter only.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| topic | string | required | Queue topic name |
| key | string | required | Partition key |
| value | Mixed | required | Message payload |
| headers | Map | {} | Metadata |
| status | enum | 'pending' | pending → processing → completed/failed |
| attempts | number | 0 | Processing attempts |

**Index:** `{ topic: 1, status: 1, createdAt: 1 }`

## Repositories

| Repository | Key Methods |
|-----------|-------------|
| `PrinterRepository` | `findByRestaurant(id)`, `findEnabledByRestaurantAndOrderType(id, type)` + BaseRepository CRUD |
| `PrintJobRepository` | `findByRestaurant(id, filters?)`, `updateStatus(id, status, extra?)`, `findPendingByPrinter(id)`, `getStats(id)` |
| `PrinterSettingsRepository` | `findByRestaurant(id)`, `upsert(id, data)`, `updateDistributedIndex(id, key, value)` |

## REST API

All endpoints at `/api/v1/printers`, requiring auth headers (`Authorization: Bearer <token>`, `X-Restaurant-Id: <id>`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/printers` | List printers for restaurant |
| POST | `/api/v1/printers` | Register new printer |
| PUT | `/api/v1/printers/:printerId` | Update printer config |
| DELETE | `/api/v1/printers/:printerId` | Remove printer |
| GET | `/api/v1/printers/settings` | Get printer settings (returns defaults if none) |
| PUT | `/api/v1/printers/settings` | Update printer settings (upserts) |
| GET | `/api/v1/printers/jobs` | List print jobs (paginated, filterable) |
| GET | `/api/v1/printers/jobs/stats` | Job counts by status |
| POST | `/api/v1/printers/jobs/:printJobId/retry` | Retry failed/dead_letter job |
| POST | `/api/v1/printers/:printerId/test` | Send test print |
| POST | `/api/v1/printers/orders/:orderId/print` | Manual print for an order (always duplicates to all printers — ignores distributionMode) |

Input validation uses Zod schemas in `api/validators/index.ts`.

## Environment Variables

### Print System Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_PRINT_WORKER` | boolean | `true` | Feature flag — when `false`, PrintJobConsumer and PrintDeadLetterConsumer are not started. Print jobs can still be created but won't be processed |
| `QUEUE_ADAPTER` | `'kafka'` \| `'mongo'` | `'kafka'` | Queue backend selection. Use `'mongo'` for local dev without Kafka |
| `PRINT_EMAIL_FROM` | string (email) | — | System-wide from address for print emails. Overridden by per-restaurant `PrinterSettings.emailFrom` |
| `PRINT_GLOBAL_CONCURRENCY` | number | `2` | Max concurrent print jobs per restaurant. Internal tuning knob — controls the in-memory semaphore in PrintJobConsumer. Not exposed to users via API |
| `PRINT_MAX_RETRIES` | number | `3` | Max retry attempts before a print job is dead-lettered |

### Related Email Variables (shared with CRM)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `EMAIL_PROVIDER` | `'mailgun'` \| `'sendgrid'` | `'mailgun'` | Email provider for sending print emails |
| `EMAIL_DOMAIN` | string | — | Mailgun/SendGrid domain for email sending |
| `EMAIL_API_KEY` | string | — | Provider API key |
| `EMAIL_FROM_ADDRESS` | string (email) | — | Fallback from address (lowest priority for print emails) |

### Related Kafka Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_KAFKA` | boolean | `true` | When `false`, Kafka producers/consumers are not initialized |
| `KAFKA_BROKERS` | string (comma-separated) | — | Kafka broker addresses |
| `KAFKA_CONSUMER_GROUP` | string | — | Default consumer group for order events |

---

## Troubleshooting

### Printer not receiving emails

1. **Check printer email address:** Verify the `email` field on the Printer document matches the Star Micronics device email exactly. Typos are the #1 cause.
2. **Check printer enabled:** The printer must have `enabled: true`. Disabled printers are skipped by both auto-print and manual print.
3. **Check Mailgun delivery:** Look at Mailgun logs for the `PRINT_EMAIL_FROM` / `PrinterSettings.emailFrom` sender domain. Common issues:
   - Domain not verified in Mailgun → emails silently dropped
   - Printer email flagged as spam → check Mailgun suppressions list
   - API key invalid → HTTP 401 errors (permanent, won't retry)
4. **Check PrintJob status:** Query `GET /api/v1/printers/jobs?status=sent` to confirm the job was sent. If it shows `sent` but the printer didn't print, the issue is email delivery or printer hardware, not the system.
5. **Test print:** Use `POST /api/v1/printers/:printerId/test` to send a test receipt. If the test print works but real orders don't, the issue is in trigger logic (settings, order type mismatch).

### Orders not auto-printing

1. **Check PrinterSettings.enabled:** Master toggle must be `true`.
2. **Check PrinterSettings.autoPrint:** Must be `true` for auto-print (not required for kitchen print).
3. **Check order type toggles:** The specific order type must be enabled:
   - Pickup → `printPickup: true`
   - Delivery → `printDelivery: true`
   - Dine-In → `printDineIn: true`
4. **Check printer type:** Auto-print only sends to `type: 'receipt'` printers. Kitchen printers are triggered separately by status change to `preparing`.
5. **Check printer orderTypes:** The printer's `orderTypes` array must include the order's type. A receipt printer with `orderTypes: ['pickup']` won't print delivery orders.
6. **Check ENABLE_PRINT_WORKER:** If `false`, print jobs are created but never processed (stuck in `queued`).
7. **Check Kafka connectivity:** If `ENABLE_KAFKA=false` or brokers are unreachable, messages can't be published.

### Unexpected duplicate prints

1. **Check distribution mode:** If `distributionMode: 'duplicate'` (default), ALL matching printers print every order. Switch to `'distribute'` for round-robin.
2. **Check for duplicate events:** Both `order.completed` and `order.status_changed` can trigger auto-print. The `tryProcessEvent('order_completed_process:${orderId}')` idempotency guard prevents this, but verify it's working by checking logs for "Order already processed as completed".
3. **Manual + auto:** If a user clicks "Print Receipt" AND auto-print fires, the order gets printed twice (manual always sends to all printers). This is expected behavior — manual print is an explicit override.

### Jobs stuck in `queued` status

1. **PrintJobConsumer not running:** Check if `ENABLE_PRINT_WORKER=true` and the consumer started successfully. Look for log message "Print job consumer started".
2. **Concurrency limit hit:** If all semaphore slots are full, the consumer pauses the partition. This is normal backpressure — jobs will eventually process. Check for log "Concurrency limit reached — pausing partition".
3. **Kafka consumer lag:** Use Kafka admin tools to check consumer group `print-worker-group` lag on `print.jobs` topic. High lag = consumer is falling behind.

### Dead-letter jobs accumulating

1. **Check `lastError` field:** Query `GET /api/v1/printers/jobs?status=dead_letter` — the `lastError` field shows why the job failed permanently.
2. **Common permanent errors:**
   - `HTTP 401 Unauthorized` — Mailgun API key is invalid or expired
   - `HTTP 400 Bad Request` — invalid printer email format
   - `HTTP 403 Forbidden` — domain not authorized in Mailgun
3. **Retry manually:** Use `POST /api/v1/printers/jobs/:printJobId/retry` to re-attempt a dead-lettered job after fixing the underlying issue. This resets attempts to 0.
4. **Monitor trend:** If dead-letter jobs spike suddenly, it usually indicates an infrastructure issue (Mailgun outage, API key rotation) rather than individual printer problems.

---

## How to Add a New Queue Adapter

1. Create a new class implementing `QueuePort` at `src/adapters/YourAdapter.ts`
2. Implement `publish()`, `consume()`, and `disconnect()` methods
3. Add the adapter type to the `QueueAdapter` type union in `src/factories/QueueFactory.ts`
4. Register the adapter in `getQueueAdapter()` with a singleton pattern
5. Add the adapter name to the `QUEUE_ADAPTER` Zod enum in `src/config/env.ts`
6. Update `.env` and `.env.example` with the new option

Example skeleton:

```typescript
import { QueuePort, QueueMessage, MessageHandler, ConsumeOptions } from '../ports/QueuePort';

export class SQSQueueAdapter implements QueuePort {
  async publish(topic: string, message: QueueMessage): Promise<void> {
    // Map topic to SQS queue URL
    // Serialize message.value to JSON
    // Use message.key as MessageGroupId (FIFO) or dedup key
    // Send via AWS SDK
  }

  async consume(topic: string, handler: MessageHandler, options?: ConsumeOptions): Promise<void> {
    // Map topic to SQS queue URL
    // Poll with long-polling (WaitTimeSeconds: 20)
    // Respect options.concurrency
    // Call handler for each message
    // Delete message on success
  }

  async disconnect(): Promise<void> {
    // Stop polling
  }
}
```

## Timezone Handling

Print jobs resolve the restaurant timezone at creation time and store it on the PrintJob document. This ensures consistent formatting even if timezone settings change later.

Timezone is resolved via `TimezoneService` which reads from the restaurant's `store_hours` document. The timezone string (e.g., `'America/New_York'`) is passed to `Intl.DateTimeFormat` for receipt timestamp formatting.

## Frontend Integration

The frontend (`oc-restaurant-manager`) interacts with the print system through server actions that proxy to the REST API:

| Server Action | Endpoint |
|--------------|----------|
| `getPrinters` | GET `/api/v1/printers` |
| `addPrinter` | POST `/api/v1/printers` |
| `updatePrinter` | PUT `/api/v1/printers/:id` |
| `deletePrinter` | DELETE `/api/v1/printers/:id` |
| `getPrinterSettings` | GET `/api/v1/printers/settings` |
| `updatePrinterSettings` | PUT `/api/v1/printers/settings` |
| `getPrintJobs` | GET `/api/v1/printers/jobs` |
| `getPrintJobStats` | GET `/api/v1/printers/jobs/stats` |
| `retryPrintJob` | POST `/api/v1/printers/jobs/:id/retry` |
| `testPrint` | POST `/api/v1/printers/:id/test` |
| `printOrder` | POST `/api/v1/printers/orders/:id/print` |

Server actions are in `oc-restaurant-manager/lib/serverActions/printer.actions.ts`.
Types are in `oc-restaurant-manager/types/printer.ts`.

### Settings UI

The printer settings page (`components/settings/printer/PrinterSettings.tsx`) provides:

- **Global Settings**: enable/disable toggle, auto-print toggle, order type checkboxes, distribution mode selector (radio group: "Print on all matching printers" / "Distribute orders across printers")
- **Printer Management**: list of registered printers with test/edit/delete actions
  - Each printer card shows order types as colored badges: Pickup (blue/info), Delivery (green/success), Dine-In (orange/warning)
  - When 2+ printers share an order type, a distribution indicator appears on the shared badge: "(copies to all)" in duplicate mode, "(round-robin)" in distribute mode
- **Print Job Stats**: total/sent/failed/dead_letter counters
- **Print History**: paginated table of recent print jobs with retry buttons

The Add/Edit Printer modals include helper text below Order Types checkboxes explaining the current distribution mode behavior for shared order types.

The orders page includes a "Print Receipt" button per order for manual printing.
