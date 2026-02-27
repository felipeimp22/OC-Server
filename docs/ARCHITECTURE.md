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
   - **Action**: Execute via ActionService (send email, apply tag, etc.)
   - **Condition**: Evaluate via ConditionService, choose branch
   - **Timer**: Schedule via BullMQ, pause execution until timer fires
   - **Logic**: Handle branching (A/B split, loop, stop, etc.)
8. **Completion** — when no more downstream nodes, mark execution as completed

### Timer Flow

```
Timer Node Hit → BullMQ Job Created → [delay/schedule] → Worker Picks Up → Resume Flow
```

Timer types:
- **Delay**: Fixed wait (5 minutes, 2 hours, 3 days)
- **Smart Date Sequence**: Wait until specific weekday + time in timezone
- **Date Field**: Relative to a contact custom field date value

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

## Flow Engine — DAG Processing

Flows are directed acyclic graphs (DAGs):

```
[Trigger: Order Completed]
         │
    [Timer: Wait 2h]
         │
    [Condition: Order > $30?]
        / \
     Yes   No
      │     │
 [Send Email] [Apply Tag: "low_value"]
```

### Node Types

| Type | Purpose | Sub-types |
|------|---------|-----------|
| Trigger | Entry point | 18 event types |
| Action | Execute task | 11 action types |
| Condition | Branch logic | yes_no, multi_branch, ab_split, random_distribution |
| Timer | Delay execution | delay, date_field, smart_date_sequence |
| Logic | Control flow | loop, stop, skip, until_condition |

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
| `crm.flow.execute` | Internal | Flow step execution queue |
| `crm.flow.timer` | Internal | Timer job fire events |
| `crm.contacts` | Internal | Contact tag/field change events |
| `crm.communications` | Internal | Communication dispatch |
| `crm.notifications` | Produce | Outgoing notifications to oc-restaurant-manager |

## Service Layer

| Service | Responsibility |
|---------|---------------|
| FlowService | Flow CRUD, activation, validation |
| FlowEngineService | DAG traversal and node execution orchestration |
| TriggerService | Event → flow matching and enrollment |
| ActionService | Action node execution dispatch |
| ConditionService | Condition evaluation and branch selection |
| CommunicationService | Email/SMS sending with template interpolation |
| ContactService | Contact CRUD and lifecycle management |
| SegmentationService | Dynamic contact filtering |
| AnalyticsService | Dashboard stats and flow metrics |
| TimerService | Timer scheduling and management |
| WebhookService | Outgoing webhook execution |
| CampaignService | Campaign management |
| TemplateService | Communication template CRUD |
| ReviewRequestService | Review request management |
