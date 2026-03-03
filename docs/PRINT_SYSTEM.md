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

## Print Job Lifecycle

```
pending → queued → sending → sent
                           ↘ failed → (retry) → queued
                                    ↘ dead_letter
```

| Status | Meaning |
|--------|---------|
| `pending` | PrintJob created, not yet published to Kafka |
| `queued` | Published to `print.jobs` topic, awaiting consumer pickup |
| `sending` | Consumer is formatting receipt and sending email |
| `sent` | Email successfully delivered to Mailgun (and thus to printer) |
| `failed` | Send attempt failed; will retry if attempts < maxAttempts |
| `dead_letter` | All retry attempts exhausted or permanent error |

## Kafka Topics

| Topic | Purpose | Partitions |
|-------|---------|------------|
| `print.jobs` | Main print job processing queue | 3 |
| `print.jobs.retry` | Retry queue for failed jobs | 3 |
| `print.jobs.dead-letter` | Permanently failed jobs | 3 |

All topics are auto-created by `ensureTopics()` on startup when `ENABLE_KAFKA=true`.

### Message Payload

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

### Retry Headers

When a job is retried, these headers are added:

| Header | Value |
|--------|-------|
| `retry-after` | ISO timestamp for when to process (exponential backoff) |
| `retry-attempt` | Current attempt number |
| `original-error` | Error message from the failed attempt |

### Dead-Letter Headers

| Header | Value |
|--------|-------|
| `final-error` | Last error message before giving up |
| `total-attempts` | Total number of attempts made |

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
5. Load Order and Restaurant from DB
6. Generate receipt HTML via `ReceiptFormatter`:
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

- Controlled by `PrinterSettings.globalConcurrency` (default: 2) — internal, not user-configurable via API
- In-memory semaphore keyed by restaurantId
- Limits total parallel print jobs across all printers for one restaurant
- Falls back to `PRINT_GLOBAL_CONCURRENCY` env var

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
4. For each printer: create PrintJob → format receipt → publish to `print.jobs`

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
3. For each printer: create PrintJob (trigger: `kitchen`) → format kitchen ticket → publish to `print.jobs`

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
| globalConcurrency | number | 2 | Max concurrent print jobs per restaurant (internal — not exposed via API) |
| distributionMode | 'duplicate' \| 'distribute' | 'duplicate' | How orders are sent to matching printers: duplicate = all get every order, distribute = round-robin |
| lastDistributedIndex | Map<string, number> | {} | Round-robin position per order type key (e.g., { 'pickup': 1, 'kitchen_pickup': 2 }) |
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
| `PrinterSettingsRepository` | `findByRestaurant(id)`, `upsert(id, data)` |

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
| POST | `/api/v1/printers/orders/:orderId/print` | Manual print for an order |

Input validation uses Zod schemas in `api/validators/index.ts`.

## Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ENABLE_PRINT_WORKER` | boolean | `true` | Feature flag for print consumers |
| `QUEUE_ADAPTER` | 'kafka' \| 'mongo' | `'kafka'` | Queue backend selection |
| `PRINT_EMAIL_FROM` | string (email) | — | System-wide from address for print emails |
| `PRINT_GLOBAL_CONCURRENCY` | number | `2` | Default global concurrency per restaurant |
| `PRINT_MAX_RETRIES` | number | `3` | Default max retries before dead-letter |

Related email variables (shared with CRM):
- `EMAIL_PROVIDER` — 'mailgun' or 'sendgrid'
- `EMAIL_DOMAIN` — Mailgun/SendGrid domain
- `EMAIL_API_KEY` — Provider API key
- `EMAIL_FROM_ADDRESS` — Fallback from address

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

- **Global Settings**: enable/disable toggle, auto-print toggle, order type checkboxes, concurrency slider
- **Printer Management**: list of registered printers with test/edit/delete actions
- **Print Job Stats**: total/sent/failed/dead_letter counters
- **Print History**: paginated table of recent print jobs with retry buttons

The orders page includes a "Print Receipt" button per order for manual printing.
