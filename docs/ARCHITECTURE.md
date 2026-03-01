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
   - **Action**: Execute via ActionService (send_email, send_sms, outgoing_webhook); action nodes are terminal (no outgoing edges)
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
| Trigger | Entry point | 7 event types: order_completed, payment_failed, order_status_changed, abandoned_cart, first_order, nth_order, no_order_in_x_days |
| Action | Execute task | 3 action types: send_email, send_sms, outgoing_webhook |
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
| FlowService | Flow CRUD, activation, graph validation (9 rules R-1..R-9) |
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

This prevents a single order from enrolling in the same flow more than once, even across multiple qualifying status changes (e.g., order goes `ready` → `delivered` — both are qualifying statuses, but the flow should only fire once per order).

```
order status → 'ready' → order_completed trigger fires → flow enrolled ✓
order status → 'delivered' → order_completed trigger fires → hasOrderBeenProcessedForFlow → already enrolled ✗
```

### Why Both Are Needed

- **`tryProcessEvent`** prevents double stats increment across two Kafka event paths (order.status_changed + order.completed both fire when status='completed')
- **`hasOrderBeenProcessedForFlow`** prevents per-flow re-enrollment across multiple qualifying status changes (ready → delivered → completed all qualify)
