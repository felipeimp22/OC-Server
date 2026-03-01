# Architecture

## System Overview

```
┌──────────────────────────────────────┐
│   oc-restaurant-manager (Next.js)    │
│   (Frontend + Auth + Event Outbox)   │
└────────────────┬─────────────────────┘
                 │ HTTP POST /api/v1/events/ingest
                 │ (system JWT + X-Restaurant-Id)
                 ▼
┌──────────────────────────────────────────────────────┐
│                    oc-server                          │
│               (CRM Engine — This Service)             │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │ Fastify  │  │  Kafka   │  │  BullMQ  │  │ Cron  │ │
│  │  API     │  │ Consumer │  │  Worker  │  │ Jobs  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──┬────┘ │
│       │             │              │            │      │
│       └──────┬──────┴──────┬───────┘            │      │
│              ▼             ▼                    ▼      │
│        ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│        │ Services │  │  Flow    │  │  Schedulers   │  │
│        │          │  │  Engine  │  │               │  │
│        └────┬─────┘  └────┬─────┘  └──────────────┘  │
│             └──────┬──────┘                            │
│                    ▼                                   │
│           ┌───────────────┐                            │
│           │ Repositories  │                            │
│           │ (MongoDB)     │                            │
│           └───────────────┘                            │
│                    │                                   │
│                    ▼                                   │
│           ┌───────────────┐                            │
│           │     Kafka     │                            │
│           │  (Publish)    │                            │
│           └───────────────┘                            │
└──────────────────────────────────────────────────────┘
```

## Event Bridge (Outbox → HTTP → Kafka)

Events from `oc-restaurant-manager` reach Kafka via a two-hop bridge:

```
oc-restaurant-manager
  1. publishEvent() writes to Prisma CRMEvent outbox
  2. deliverEvent() POSTs to oc-server /api/v1/events/ingest
         │
         ▼
  oc-server /api/v1/events/ingest
  3. Validates system JWT
  4. Routes event to the correct Kafka topic
  5. Returns { ok: true }
         │
         ▼
  Kafka consumers (oc-server)
  6. OrderEventConsumer, CustomerEventConsumer, CartEventConsumer, etc.
  7. Process event → update contacts → evaluate triggers → enroll flows
```

Retry path: if HTTP delivery fails, the `/api/cron/crm-events` cron in `oc-restaurant-manager` retries pending outbox events every minute.

## Data Flow

### Event Processing Pipeline

1. **Event arrives** via Kafka (order.completed, customer.created, etc.)
2. **Consumer** deserializes and validates the event payload
3. **Idempotency guard** checks if event was already processed (ProcessedEvent collection)
4. **Contact resolution** — find or create the CRM contact for this customer
5. **Trigger evaluation** — find all active flows whose trigger matches the event
6. **Flow enrollment** — create a FlowExecution for each matching flow
7. **Node processing** — the Flow Engine traverses the DAG node by node:
   - **Trigger**: Already matched, advance to next node
   - **Action**: Execute via ActionService (send_email, send_sms, outgoing_webhook); action nodes may chain to other actions, timers, or conditions (fan-out supported)
   - **Condition**: Evaluate via ConditionService using trigger-bound semantics; yes/no branch selection
   - **Timer**: Schedule via BullMQ, pause execution until timer fires
8. **Completion** — when no more downstream nodes, mark execution as completed

### Timer Flow

```
Timer Node Hit → BullMQ Job Created → [delay/schedule] → Worker Picks Up → Resume Flow
```

Timer types:
- **Delay**: Fixed wait (5 minutes, 2 hours, 3 days)
- **Date Field**: Wait until a specific UTC date/time (`config.targetDateUtc`)

## Multi-Tenancy

Every data operation includes `restaurantId` as a mandatory filter:

```typescript
// BaseRepository enforces isolation on every query
async findById(restaurantId, id): Promise<T | null> {
  return this.model.findOne({ _id: id, restaurantId }).exec();
}
```

No cross-tenant data access is possible. The tenancy middleware extracts `restaurantId` from the `X-Restaurant-Id` header and verifies the JWT user has access.

## Authentication

1. Frontend sends JWT from NextAuth v5 in `Authorization: Bearer <token>`
2. The `auth` middleware verifies using `jose` with the shared `AUTH_SECRET`
3. The `tenancy` middleware validates `X-Restaurant-Id` against the user's restaurant access (via `UserRestaurant` collection)

## Database Strategy

### Shared Collections (Read-Only)
The CRM reads from existing OrderChop collections without modifying them:
- `restaurants`, `customers`, `orders`
- `store_hours`, `financial_settings`
- `user_restaurants`, `role_permissions`

### CRM-Owned Collections
Prefixed with `crm_` to avoid collisions:
- `crm_contacts`, `crm_tags`, `crm_custom_fields`
- `crm_flows`, `crm_flow_executions`, `crm_flow_execution_logs`
- `crm_communication_templates`, `crm_communication_logs`
- `crm_link_tracking`, `crm_review_requests`
- `crm_campaigns`, `crm_tasks`, `crm_processed_events`

## Frontend Integration — Node Format

The React Flow canvas (in `oc-restaurant-manager`) uses a different node representation than the `IFlowNode` interface stored in MongoDB.

### React Flow format (in-browser / Zustand store)
```json
{
  "id": "node-abc",
  "type": "trigger",
  "position": { "x": 100, "y": 100 },
  "data": {
    "subType": "order_completed",
    "label": "Order Completed",
    "config": {}
  }
}
```

### IFlowNode format (API / MongoDB)
```json
{
  "id": "node-abc",
  "type": "trigger",
  "subType": "order_completed",
  "label": "Order Completed",
  "config": {},
  "position": { "x": 100, "y": 100 }
}
```

**Critical**: `FlowRepository.findActiveByTrigger` queries `nodes.subType` at the top level. If subType is nested inside `data`, flows will never be found. The transformation happens in `useFlowBuilderStore.ts` via `toReactFlowNodes`/`fromReactFlowNodes` (and their single-item variants) before saving and after loading.

---

## Flow Engine — DAG Processing

Flows are directed acyclic graphs (DAGs):

```
[Trigger: Order Completed (minOrderTotal: 0)]
         │
    [Timer: Delay 2h]
         │
    [Condition: Yes/No]
        / \
     Yes   No
      │     │
 [Send Email] [Send SMS]
```

### Node Types

| Type | Purpose | Sub-types |
|------|---------|-----------|
| Trigger | Entry point | 7 event types: new_order, order_completed, order_status_changed, abandoned_cart, first_order, nth_order, no_order_in_x_days. **new_order** fires on payment.succeeded (uses upsertFromEvent for first-time customers). **order_completed fires on fulfillment statuses** (ready, out_for_delivery, delivered, completed) — not just manual 'completed'. |
| Action | Execute task (may chain to other actions, timers, or conditions) | 3 action types: send_email, send_sms, outgoing_webhook |
| Condition | Branch logic | yes_no (trigger-bound — reads filter from trigger node config; no operator UI) |
| Timer | Delay execution | delay, date_field |

### Edge Resolution

Each node can have multiple outgoing edges. The engine:
1. Finds all edges where `sourceNodeId` matches the current node
2. For conditions, uses `sourceHandle` to pick the correct branch (e.g., "yes"/"no")
3. For regular nodes, follows all outgoing edges (parallel execution)

## Kafka Topics

All topic names are defined in `src/kafka/topics.ts` (`KAFKA_TOPICS`):

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `orderchop.orders` | Consume | Order lifecycle events |
| `orderchop.payments` | Consume | Payment events |
| `orderchop.customers` | Consume | Customer creation/updates |
| `orderchop.carts` | Consume | Cart abandonment detection |
| `crm.flow.execute` | Consume/Produce | Flow step execution queue (flow.step.ready events) |
| `crm.flow.timer` | Internal | Timer job fire events |
| `crm.communications` | Internal | Communication dispatch |
| `crm.notifications` | Produce | Outgoing notifications to oc-restaurant-manager |

## Service Layer

| Service | Responsibility |
|---------|---------------|
| FlowService | Flow CRUD, activation, graph validation (11 rules R-1..R-11) |
| FlowEngineService | DAG traversal and node execution orchestration |
| TriggerService | Event → flow matching and enrollment |
| ActionService | Action node execution: send_email, send_sms, outgoing_webhook |
| ConditionService | Trigger-bound yes/no evaluation (reads from triggerNode.config) |
| CommunicationService | Email/SMS sending with dot-notation variable interpolation |
| TimezoneService | Restaurant timezone lookup with 5-min TTL cache |
| AnalyticsService | Dashboard stats and flow metrics |
| TimerService | Timer scheduling via BullMQ (delay + date_field subtypes) |
| WebhookService | Outgoing webhook execution with variable interpolation |
| InactivityChecker | Daily cron (0 8 * * *) for no_order_in_x_days enrollment |

## Order-Level Deduplication

Two complementary dedup mechanisms prevent duplicate processing and enrollment for order-related triggers:

### 1. `tryProcessEvent` — Cross-Event-Path Dedup (OrderEventConsumer)

When an order reaches a qualifying status, `processOrderAsCompleted()` is the shared handler for both `order.completed` and `order.status_changed` Kafka events. It uses `tryProcessEvent` with a synthetic key `order_completed_process:${orderId}` (stored in the `crm_processed_events` collection with a unique index).

This ensures stats (`incrementOrderStats`) are incremented exactly once per order, even when `kitchen.actions.ts` publishes BOTH `order.status_changed` AND `order.completed` events for the same status change to `completed`.

```
order.status_changed (status=completed) → processOrderAsCompleted()
  → tryProcessEvent('order_completed_process:ORDER123') → first call: proceeds ✓
order.completed → processOrderAsCompleted()
  → tryProcessEvent('order_completed_process:ORDER123') → duplicate: skips ✗
```

### 2. `hasOrderBeenProcessedForFlow` — Per-Flow Enrollment Dedup (TriggerService)

Queries `crm_flow_executions` for `{ restaurantId, flowId, 'context.orderId': orderId }` with **no status filter** — counts active, completed, stopped, and error executions. Returns true if count > 0.

This prevents a single order from enrolling in the same flow more than once. Used for both `order_completed` (multiple qualifying status changes) and `new_order` (payment.succeeded) triggers.

```
order status → 'ready' → order_completed trigger fires → flow enrolled ✓
order status → 'delivered' → order_completed trigger fires → hasOrderBeenProcessedForFlow → already enrolled ✗
```

### Qualifying Fulfillment Statuses

The `order_completed` trigger fires when an order reaches **any** of these statuses:

```
ORDER_COMPLETED_QUALIFYING_STATUSES = ['ready', 'out_for_delivery', 'delivered', 'completed']
```

This means restaurant operators don't need to know which status their staff uses as the "final" step — automations fire on the first qualifying status change.

### Two-Event-Path Design

When an order status changes, two Kafka event paths can fire `processOrderAsCompleted`:

1. **`order.status_changed`** → `handleOrderStatusChanged()` checks if `newStatus` is in `ORDER_COMPLETED_QUALIFYING_STATUSES` → calls `processOrderAsCompleted()`
2. **`order.completed`** → `handleOrderCompleted()` → calls `processOrderAsCompleted()`

Both paths converge on `processOrderAsCompleted()`, which uses `tryProcessEvent` to ensure it runs exactly once per order. Additionally, `TriggerService.evaluateSingleFlow` uses `hasOrderBeenProcessedForFlow` for per-flow dedup when `eventType === 'order_completed'` or `eventType === 'new_order'`.

```
order status → 'ready'    → order.status_changed → processOrderAsCompleted ✓ (first qualifying)
order status → 'delivered' → order.status_changed → processOrderAsCompleted ✗ (tryProcessEvent blocks)
order status → 'completed' → order.status_changed → processOrderAsCompleted ✗ (tryProcessEvent blocks)
                           → order.completed      → processOrderAsCompleted ✗ (tryProcessEvent blocks)
```

### New Order Trigger (`new_order`)

The `new_order` trigger fires on `payment.succeeded` Kafka events. Unlike `order_completed`, it:
- Uses `upsertFromEvent()` to create CRM contacts for first-time customers (fixes the previous `handleOrderEvent` bug where `getByCustomerId()` returned null)
- Does **NOT** increment order stats — payment confirmation is not order completion
- Also evaluates `payment_succeeded` triggers for backward compatibility
- Uses `hasOrderBeenProcessedForFlow` for per-flow orderId dedup (one fire per order per flow)

```
payment.succeeded → handleNewOrder()
  → upsertFromEvent (creates contact if new)
  → evaluateTriggers('new_order', ...) — per-flow orderId dedup
  → evaluateTriggers('payment_succeeded', ...) — backward compat
```

### Why Both Dedup Mechanisms Are Needed

- **`tryProcessEvent`** prevents double stats increment across two Kafka event paths (order.status_changed + order.completed both fire when status='completed')
- **`hasOrderBeenProcessedForFlow`** prevents per-flow re-enrollment across multiple qualifying status changes (ready → delivered → completed all qualify) and ensures one new_order fire per order per flow

## Time-Based Trigger Architecture

The CRM engine uses three distinct time-based mechanisms. Understanding which mechanism applies where is critical to avoid confusion.

### Overview

| Mechanism | Trigger | When It Runs | Queue / Scheduler | Config |
|-----------|---------|-------------|-------------------|--------|
| BullMQ delayed job (pre-enrollment) | `abandoned_cart` | Before flow enrollment — delays the trigger itself | `abandoned-cart-triggers` queue | `config.delayDays` (1–90 days) |
| Cron job (daily scan) | `no_order_in_x_days` | Daily at 08:00 — scans contacts for inactivity | `InactivityChecker` (node-cron) | `config.days` (integer, min 1) |
| BullMQ delayed job (during execution) | Any trigger | During flow execution — pauses at timer nodes | `flow-timers` queue | `config.duration`/`unit` or `config.targetDateUtc` |

### Timer Node Independence

Timer nodes (`delay` and `date_field`) within a flow are **completely independent** of the trigger type. The `FlowEngineService.processCurrentNode()` method handles timer nodes by calling `TimerService.scheduleTimer(node, executionId, restaurantId)` — no trigger information is passed or consulted.

This means timer nodes work identically whether the flow was started by `order_completed`, `abandoned_cart`, `no_order_in_x_days`, or any other trigger.

**Example — combined delays:**
```
Abandoned Cart (delayDays: 1) → [enrollment after 1 day] → Delay node (2 hours) → Send Email
= ~26 hours total from cart abandonment to email
```

The trigger delay (BullMQ `abandoned-cart-triggers` queue, pre-enrollment) and the timer node delay (BullMQ `flow-timers` queue, during execution) are **separate queues and mechanisms**:
- Trigger delay decides *when to enroll* the contact
- Timer node delay decides *when to execute the next step* within an already-enrolled flow

### 1. Abandoned Cart — BullMQ Delayed Jobs (Pre-Enrollment)

The `abandoned_cart` trigger uses **BullMQ delayed jobs** instead of immediate trigger evaluation. This allows restaurant owners to configure a delay (1–90 days) before the flow fires, giving customers time to complete their order.

#### Flow

```
cart.abandoned Kafka event
  → CartEventConsumer.handleCartAbandoned()
  → upsertFromEvent() (ensure contact exists)
  → FlowRepository.findActiveByTrigger(restaurantId, 'abandoned_cart')
  → For each flow:
      → Read triggerNode.config.delayDays (default 1, clamped 1–90)
      → Schedule BullMQ delayed job on 'abandoned-cart-triggers' queue
      → Job fires after delayDays * 86400000 ms
  → AbandonedCartProcessor (Worker) picks up job:
      → Check if order is still pending (not completed)
      → If pending: evaluate abandoned_cart trigger → enroll in flow
      → If completed: skip (customer already ordered)
```

#### BullMQ Queue: `abandoned-cart-triggers`

- **Queue instance**: Singleton exported from `CartEventConsumer.ts` as `abandonedCartQueue`
- **Job name**: `abandoned-cart-trigger`
- **Job ID format**: `abandoned-cart-${orderId}-${flowId}` (deterministic — enables O(1) cancellation)
- **Job data**: `{ restaurantId, flowId, orderId, customerId, contactId, customerEmail, customerName, customerPhone, cartItems, cartTotal, abandonTime }`
- **Delay**: `delayDays * 86400000` ms (configurable per-flow, 1–90 days)
- **Cleanup**: `removeOnComplete: true`, `removeOnFail: 100`

#### Cancellation (Order Completion)

When an order is completed or paid, `OrderEventConsumer.cancelAbandonedCartJobs()` removes all pending BullMQ jobs for that orderId. Two entry points trigger cancellation:

1. **`processOrderAsCompleted()`** — fires on fulfillment statuses (ready, out_for_delivery, delivered, completed)
2. **`handleNewOrder()`** — fires on payment.succeeded (payment = order no longer abandoned)

```
order completed/paid
  → OrderEventConsumer.cancelAbandonedCartJobs(restaurantId, orderId)
  → FlowRepository.findActiveByTrigger(restaurantId, 'abandoned_cart')
  → For each flow: abandonedCartQueue.remove('abandoned-cart-${orderId}-${flowId}')
  → BullMQ Queue.remove() is a no-op if job doesn't exist (safe)
```

Cancellation is scoped per-orderId — it never touches other customers' jobs or other flow types. If cancellation fails (e.g., Redis unavailable), the AbandonedCartProcessor's order status check provides defense-in-depth by skipping completed orders at processing time.

#### AbandonedCartProcessor (Worker)

`src/schedulers/AbandonedCartProcessor.ts` — BullMQ Worker that processes delayed abandoned cart jobs.

**Processing logic when a job fires:**

1. Extract job data (restaurantId, flowId, orderId, contactId, etc.)
2. If orderId exists: fetch order from `orders` collection via `Order.findById(orderId)`
   - If order not found: log warning and skip (order may have been deleted)
   - If order status is in completed set (`paid`, `confirmed`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `completed`): log and skip — customer already ordered
   - If order status is `pending`: proceed to trigger evaluation
3. If no orderId: proceed to trigger evaluation (cart may not have an associated order)
4. Build trigger context from job data and call `TriggerService.evaluateTriggers(restaurantId, 'abandoned_cart', contactId, context)`
5. TriggerService handles enrollment, dedup (isContactEnrolled), and flow engine start

**Worker configuration:**
- Concurrency: 10 (matches FlowTimerProcessor)
- Registered in `src/index.ts` alongside FlowTimerProcessor, guarded by `ENABLE_SCHEDULERS`
- Graceful shutdown via `worker.close()` on SIGINT/SIGTERM

#### Design Decisions

1. **Separate queue from flow-timers**: `abandoned-cart-triggers` is independent from `flow-timers` for separate scaling and monitoring
2. **Contact upserted before scheduling**: Ensures contactId exists in job data when the job fires days later
3. **Deterministic jobId**: Enables O(1) cancellation without needing to scan the queue
4. **Per-flow scheduling**: Multiple flows with different `delayDays` are handled independently — each gets its own job
5. **Order status check at processing time**: Even if cancellation fails or a race condition occurs, the processor double-checks order status before triggering — defense in depth

### 2. No Order in X Days — Daily Cron Scan

The `no_order_in_x_days` trigger uses a **daily cron job** (`InactivityChecker`) to scan for contacts whose last order was more than `config.days` days ago.

#### Flow

```
Daily cron (0 8 * * *) — InactivityChecker
  → Find all active flows with no_order_in_x_days trigger
  → For each flow:
      → Read triggerNode.config.days (default 30)
      → Query contacts where lastOrderAt < (now - days) and totalOrders > 0
      → For each inactive contact: TriggerService.evaluateTriggers(...)
```

- **Config key**: `config.days` (integer, min 1) — set via TriggerConfigForm in the flow builder
- **Scheduler**: `src/schedulers/InactivityChecker.ts`, guarded by `ENABLE_SCHEDULERS`
- **No BullMQ queue** — uses node-cron for scheduling, not BullMQ

### 3. Timer Nodes — BullMQ Delayed Jobs (During Execution)

Timer nodes pause flow execution until a specified time. They fire **during** flow execution (after enrollment), regardless of what trigger started the flow.

#### Flow

```
FlowEngineService.processCurrentNode() → case 'timer'
  → TimerService.scheduleTimer(node, executionId, restaurantId)
  → Calculate target date from config (delay duration or absolute date)
  → Schedule BullMQ delayed job on 'flow-timers' queue
  → Execution pauses
  → FlowTimerProcessor picks up job when delay expires
  → Calls FlowEngineService.resumeFromTimer() → advances to next node
```

#### BullMQ Queue: `flow-timers`

- **Queue instance**: Singleton in `TimerService.ts`
- **Job name**: `flow-timer`
- **Job ID format**: `timer-${executionId}-${nodeId}`
- **Job data**: `{ executionId, nodeId }`
- **Delay**: Calculated from node config (duration-based or absolute date)

#### Timer Subtypes

| Subtype | Config | Calculation |
|---------|--------|-------------|
| `delay` | `{ duration: number, unit: 'minutes'\|'hours'\|'days' }` | `duration * unitMs` from now |
| `date_field` | `{ targetDateUtc: string }` | Absolute UTC date/time (must be in the future) |
