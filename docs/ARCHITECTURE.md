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
| Trigger | Entry point | 9 event types: new_order, order_completed, order_status_changed, abandoned_cart, first_order, nth_order, no_order_in_x_days, item_ordered, item_ordered_x_times. **new_order** fires on payment.succeeded (uses upsertFromEvent for first-time customers). **order_completed fires on fulfillment statuses** (ready, out_for_delivery, delivered, completed) — not just manual 'completed'. **item_ordered** fires when an order contains configured menu items (with optional modifier matching). **item_ordered_x_times** fires when a customer's cumulative count of ordering specific items reaches a threshold (exact equality). |
| Action | Execute task (may chain to other actions, timers, or conditions) | 3 action types: send_email, send_sms, outgoing_webhook |
| Condition | Branch logic | yes_no (trigger-bound — reads filter from trigger node config; no operator UI) |
| Timer | Delay execution | delay, date_field |

### Edge Resolution

Each node can have multiple outgoing edges. The engine:
1. Finds all edges where `sourceNodeId` matches the current node
2. For conditions, uses `sourceHandle` to pick the correct branch (e.g., "yes"/"no")
3. For regular nodes, follows all outgoing edges (parallel execution)

### Fan-Out Execution Model

When a node has multiple outgoing edges, the engine dispatches each downstream node as a separate Kafka `flow.step.ready` event, enabling parallel branch execution within a single FlowExecution.

#### Tracking Fields (`crm_flow_executions`)

| Field | Type | Purpose |
|-------|------|---------|
| `currentNodeId` | `string` | Backward-compat: set to the first downstream target on advance |
| `pendingNodes` | `string[]` | Node IDs currently being processed or dispatched (default `[]`) |
| `completedNodes` | `string[]` | Node IDs that finished successfully (default `[]`) |
| `erroredNodes` | `string[]` | Node IDs that failed (default `[]`) |

#### Lifecycle

```
enrollContact()
  → create execution with pendingNodes=[triggerNodeId]
  → processCurrentNode(executionId)

processCurrentNode(executionId, nodeId)
  → process the node (action/condition/trigger)
  → advanceToNext(): filter ALL outgoing edges
      → $addToSet downstream nodeIds to pendingNodes
      → produce flow.step.ready Kafka event per target
  → $pull nodeId from pendingNodes, $addToSet to completedNodes
  → if pendingNodes is empty → determine final status
```

#### Error Isolation

Each node processes inside a try-catch. On failure:
- The failed node is moved from `pendingNodes` to `erroredNodes` ($pull/$addToSet atomic)
- **Sibling branches continue unaffected** — they have their own pending entries
- Final status: if `pendingNodes` empties with only `erroredNodes` (no `completedNodes`), execution is marked `error`. Otherwise, execution is marked `completed` (partial errors are tolerated).

#### Concurrency Safety

Multiple `flow.step.ready` Kafka events for the same execution may be processed concurrently (e.g., 3 action nodes in a fan-out). Thread-safety is ensured by:
- **Atomic MongoDB operations**: `findOneAndUpdate` with `$pull`/`$addToSet` on `pendingNodes` — each returns the document *after* the update
- **No shared mutable state**: each concurrent call processes a different `nodeId`
- **Deterministic completion**: the last concurrent call to empty `pendingNodes` triggers the completion check

#### Fan-Out Example

```
[Trigger] → [Email₁] + [Email₂] + [SMS₁]   (3 outgoing edges)

1. Trigger processes → advanceToNext adds [email₁, email₂, sms₁] to pendingNodes
2. 3 Kafka events dispatched, processed concurrently:
   - email₁ completes → pendingNodes=[email₂, sms₁] → not empty
   - email₂ completes → pendingNodes=[sms₁] → not empty
   - sms₁ completes → pendingNodes=[] → COMPLETE
```

#### Action Chaining Example

```
[Trigger] → [Email] → [Timer: 2h] → [SMS]

1. Trigger → advanceToNext → pendingNodes=[email]
2. Email processes → advanceToNext → pendingNodes=[email, timer] → completeNode(email) → pendingNodes=[timer]
3. Timer schedules BullMQ job → pauses (stays in pendingNodes)
4. Timer fires → FlowTimerProcessor → advanceToNext → pendingNodes=[timer, sms] → completeNode(timer) → pendingNodes=[sms]
5. SMS processes → no outgoing edges → completeNode(sms) → pendingNodes=[] → COMPLETE
```

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

## Payment Status Enforcement

All order-related triggers require confirmed payment (`paymentStatus === 'paid'` or `paymentStatus === 'succeeded'`) before any trigger conditions are evaluated. This is a **universal guard** at the top of `TriggerService.checkTriggerConditions()` — it runs before orderTypes, minOrderTotal, and targetStatuses checks.

### Triggers Requiring Payment

| Trigger | Payment Required | Notes |
|---------|-----------------|-------|
| `order_completed` | Yes | Fires on fulfillment statuses — payment must be confirmed |
| `first_order` | Yes | Same path as order_completed |
| `nth_order` | Yes | Same path as order_completed |
| `item_ordered` | Yes | Same path as order_completed |
| `item_ordered_x_times` | Yes | Same path as order_completed |
| `new_order` | Yes | Fires on payment.succeeded — paymentStatus will be 'succeeded' |
| `order_status_changed` | Yes | Status changes for unpaid orders should NOT trigger CRM flows |
| `abandoned_cart` | **Exempt** | Inherently targets pending/unpaid orders |
| `no_order_in_x_days` | **Exempt** | Cron-based, no order context in payload |

### Payment Status Normalization

Stripe sends `'succeeded'` via webhook; the internal order system uses `'paid'`. The guard accepts **both** values with simple string comparison (`!== 'paid' && !== 'succeeded'`). Any other value (e.g., `'pending'`, `'failed'`, `undefined`) blocks the trigger.

### Performance Benefit

The payment guard runs at the **top** of `checkTriggerConditions()`, before expensive checks like item matching (`item_ordered`) or DB aggregations (`item_ordered_x_times`). Unpaid orders are rejected immediately without querying MongoDB.

## Target Status Filtering

Triggers can optionally restrict which order statuses they fire on using `config.targetStatuses: string[]`. This is a **generic check** in `TriggerService.checkTriggerConditions()` — it runs for any trigger that has `targetStatuses` set, not just a specific trigger type.

### How It Works

1. Read `config.targetStatuses` (array of status strings, e.g. `['delivered', 'completed']`)
2. If the array is present and non-empty, get `actualStatus` from `payload.newStatus ?? payload.status`
3. If `actualStatus` exists and is **NOT** in the `targetStatuses` array → return false (skip trigger)
4. If `targetStatuses` is empty, undefined, or not an array → skip the check entirely (fire on any status — backward compatible default)

### Backward Compatibility

Legacy flows may have `config.targetStatus` (single string) instead of the new array format. Before the array check runs, the code converts:

```
if config.targetStatus is a non-empty string AND config.targetStatuses is NOT set:
  effectiveTargetStatuses = [config.targetStatus]
```

This ensures existing `order_status_changed` flows with the old single-string config continue to work.

### Which Triggers Use It

| Trigger | targetStatuses | Notes |
|---------|---------------|-------|
| `item_ordered` | Optional | Filter by order status at time of trigger |
| `item_ordered_x_times` | Optional | Filter by order status at time of trigger |
| `order_status_changed` | Optional | Filter which status changes fire the trigger |
| `order_completed` | Not used | Fires on qualifying fulfillment statuses via `processOrderAsCompleted` |
| `first_order` | Not used | Same as order_completed |
| `nth_order` | Not used | Same as order_completed |

## nth_order Trigger — Ordering Dependency

The `nth_order` trigger fires exactly once when a customer's total completed orders reaches the configured threshold (`config.n`). This depends on a critical ordering invariant in `processOrderAsCompleted()`:

```
processOrderAsCompleted()
  1. incrementOrderStats() → totalOrders includes current order ($inc + { new: true })
  2. evaluateTriggers('nth_order', ..., { totalOrders: updatedContact.totalOrders })
  3. TriggerService.checkTriggerConditions() → exact equality: totalOrders === config.n
```

**Key invariants:**
- `incrementOrderStats()` is called **BEFORE** `evaluateTriggers()` — so `totalOrders` includes the current order when checked against `config.n`
- The check uses `===` (exact equality, not `>=`) — ensures the trigger fires exactly once at the threshold, not on every subsequent order
- `tryProcessEvent('order_completed_process:${orderId}')` prevents double-incrementing `totalOrders` for the same order
- Only `processOrderAsCompleted()` increments `totalOrders` (not `handleNewOrder`) — so only paid/fulfilled orders count
- The `first_order` trigger uses a separate `totalOrders === 1` check in `processOrderAsCompleted()` and does NOT go through `checkTriggerConditions`

## item_ordered Trigger — Item Matching Logic

The `item_ordered` trigger fires when an order contains specific menu items (with optional modifier matching). It evaluates in `processOrderAsCompleted()` alongside `order_completed`, `first_order`, and `nth_order`.

```
processOrderAsCompleted()
  1. Fetch order items from DB (Order.findById) → payload.items[]
  2. evaluateTriggers('item_ordered', ..., { items, ... })
  3. TriggerService.checkTriggerConditions() → match config.items against payload.items
```

### Matching Algorithm

1. **Config shape**: `config.items[]` — each has `{ menuItemId, menuItemName, modifiers?: [{ optionName, choiceNames }] }`
2. **Payload shape**: `payload.items[]` — each has `{ menuItemId, name, options: [{ name, choice }] }`
3. **Item match**: `String(orderItem.menuItemId) === String(configItem.menuItemId)`
4. **Modifier match** (if config item has modifiers): ALL specified modifiers must match — for each modifier, the order item's `options[]` must contain an entry where `option.name === modifier.optionName` AND `option.choice` is in `modifier.choiceNames`
5. **No modifiers**: If config item has no modifiers, menuItemId match alone is sufficient (any modifier combination accepted)
6. **Match mode**: `'any'` (default) = at least one config item matches; `'all'` = every config item must match
7. **Edge cases**: Empty `config.items` or empty `payload.items` → false (no match)

### Order-Level Dedup

The `item_ordered` trigger uses the same `hasOrderBeenProcessedForFlow` dedup as `order_completed` and `new_order` — one fire per order per flow.

### Guard: Items Must Exist

`evaluateTriggers('item_ordered', ...)` is only called when `items.length > 0` (i.e., order items were successfully fetched from DB). If the DB fetch fails, the trigger is skipped for that order.

## item_ordered_x_times Trigger — Cumulative Counting

The `item_ordered_x_times` trigger fires when a customer has ordered a specific menu item a cumulative number of times across their lifetime (paid orders only), hitting the threshold exactly on this order. It evaluates in `processOrderAsCompleted()` alongside `item_ordered`.

```
processOrderAsCompleted()
  1. Fetch order items from DB (Order.findById) → payload.items[]
  2. evaluateTriggers('item_ordered_x_times', ..., { items, restaurantId, ... })
  3. TriggerService.checkTriggerConditions():
     a. Early return: check current order contains matching config items (same logic as item_ordered)
     b. For each matching item: countItemOrdersByCustomer() → lifetime count
     c. Fire only when count === threshold (exact equality)
```

### Counting Method: `countItemOrdersByCustomer()`

MongoDB aggregation pipeline:
1. `$match`: restaurantId + customerId + paymentStatus='paid'
2. `$unwind`: '$items'
3. `$match`: 'items.menuItemId' = target menuItemId (ObjectId)
4. If modifiers specified: `$match` with `$elemMatch` on 'items.options' for each modifier (name + choice)
5. `$count`: 'total'

**Performance**: Leverages index on `(restaurantId, customerId, paymentStatus)`. Query runs once per matching config item per order completion per active `item_ordered_x_times` flow. Acceptable for MVP.

### Exact Threshold (`===`)

The `=== threshold` check is critical: using `>=` would fire on every order after the threshold. The `===` ensures the trigger fires exactly once per customer per threshold value, without needing additional dedup beyond the existing `hasOrderBeenProcessedForFlow`.

### Match Mode

- `'any'` (default): fire if ANY configured item reaches the threshold count
- `'all'`: fire only if ALL configured items have each reached the threshold count

### Dedup

Uses the same `hasOrderBeenProcessedForFlow` order-level dedup as `order_completed`, `new_order`, and `item_ordered` — one fire per order per flow.

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
