# Integration Guide

## Connecting to oc-server (CRM Engine) from oc-restaurant-manager

### Authentication

All API calls require two headers:

```typescript
const headers = {
  'Authorization': `Bearer ${session.accessToken}`,  // NextAuth JWT
  'X-Restaurant-Id': restaurantId,                    // Active restaurant
  'Content-Type': 'application/json',
};
```

### Base URL

```
Development: http://localhost:3001
Production:  Set via CRM_ENGINE_URL environment variable
```

In `oc-restaurant-manager`, the base URL is configured via `CRM_ENGINE_URL`:

```env
CRM_ENGINE_URL=http://localhost:3001
```

### Node Format (IFlowNode)

Nodes sent to the API must use **IFlowNode format** — `subType` at the top level, not inside `data`. The React Flow canvas uses a different in-browser format; the frontend transformation layer (`useFlowBuilderStore.ts` → `fromReactFlowNodes`) converts between them before saving.

```typescript
// CORRECT — subType at top level
{ id: 'trigger-1', type: 'trigger', subType: 'order_completed', label: '...', config: {}, position: {...} }

// WRONG — subType nested in data (React Flow format — never send this to API)
{ id: 'trigger-1', type: 'trigger', position: {...}, data: { subType: 'order_completed', ... } }
```

### Example: Creating a Flow

```typescript
const response = await fetch(`${process.env.CRM_ENGINE_URL}/api/v1/flows`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: 'Post-Order Follow-up',
    description: 'Send a thank-you email 2 hours after order completion',
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        subType: 'order_completed',
        label: 'Order Completed',
        config: {},
        position: { x: 100, y: 100 },
      },
      {
        id: 'timer-1',
        type: 'timer',
        subType: 'delay',
        label: 'Wait 2 Hours',
        config: { duration: 2, unit: 'hours' },
        position: { x: 100, y: 250 },
      },
      {
        id: 'action-1',
        type: 'action',
        subType: 'send_email',
        label: 'Thank You Email',
        config: {
          recipients: [{ type: 'customer' }],
          subject: 'Thanks for your order, {{customer.first_name}}!',
          body: 'Hi {{customer.first_name}}, your order #{{order.number}} is on its way!',
        },
        position: { x: 100, y: 400 },
      },
    ],
    edges: [
      { sourceNodeId: 'trigger-1', targetNodeId: 'timer-1' },
      { sourceNodeId: 'timer-1', targetNodeId: 'action-1' },
    ],
  }),
});
```

### Example: Listing Contacts (Paginated)

```typescript
const params = new URLSearchParams({
  page: '1',
  limit: '20',
  sort: 'lastOrderAt',
  order: 'desc',
});

const response = await fetch(
  `${process.env.CRM_ENGINE_URL}/api/v1/contacts?${params}`,
  { headers },
);

const { data, total, page, limit, totalPages, hasMore } = await response.json();
```

### Example: Updating a Contact

```typescript
await fetch(`${process.env.CRM_ENGINE_URL}/api/v1/contacts/${contactId}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    customFields: {
      favorite_item: 'Margherita Pizza',
      birthday: '1990-03-15',
    },
    smsOptIn: true,
  }),
});
```

---

## Kafka Event Bridge

Events from `oc-restaurant-manager` reach oc-server's Kafka pipeline via an HTTP bridge using the **Transactional Outbox pattern**.

### Flow

```
oc-restaurant-manager
  1. publishEvent(restaurantId, eventType, payload)
     → writes CRMEvent record to Prisma outbox (status: 'pending')
  2. deliverEvent() POSTs to oc-server /api/v1/events/ingest
     → system JWT signed with AUTH_SECRET
  3. On success: outbox status → 'delivered'
     On failure: outbox status → 'failed' (retry cron picks up)

oc-server /api/v1/events/ingest
  4. Validates system JWT (no X-Restaurant-Id tenancy check — restaurantId in payload)
  5. Routes eventType to correct Kafka topic:
     - order.*      → orderchop.orders
     - payment.*    → orderchop.payments
     - customer.*   → orderchop.customers
     - cart.*       → orderchop.carts
  6. Returns { ok: true } or { ok: false, error: '...' }

Retry path (oc-restaurant-manager)
  - GET /api/cron/crm-events runs every minute
  - retryPendingEvents() re-attempts failed/pending outbox events
  - Max 5 attempts; after that → status: 'dead_letter'
```

### Event Message Schema

All events sent to the `/api/v1/events/ingest` endpoint follow this shape:

```typescript
interface KafkaEvent {
  eventId: string;      // UUID — used for idempotency (deduplication)
  eventType: string;    // e.g., 'order.completed', 'customer.created'
  payload: {
    restaurantId: string; // MongoDB ObjectId string (required)
    customerId?: string;  // MongoDB ObjectId string
    [key: string]: unknown; // Event-specific data
  };
}
```

### Kafka Topic Routing

| eventType prefix | Kafka Topic |
|-----------------|-------------|
| `order.*` | `orderchop.orders` |
| `payment.*` | `orderchop.payments` |
| `customer.*` | `orderchop.customers` |
| `cart.*` | `orderchop.carts` |

### Required Kafka Topics

All 8 topics are auto-created by `ensureTopics()` on startup (`ENABLE_KAFKA=true`):

| Topic | Producer | Consumer |
|-------|----------|----------|
| `orderchop.orders` | oc-restaurant-manager (via bridge) | oc-server |
| `orderchop.payments` | oc-restaurant-manager (via bridge) | oc-server |
| `orderchop.customers` | oc-restaurant-manager (via bridge) | oc-server |
| `orderchop.carts` | oc-restaurant-manager (via bridge) | oc-server |
| `crm.flow.execute` | oc-server | oc-server (CRMEventConsumer — flow.step.ready only) |
| `crm.flow.timer` | oc-server | oc-server |
| `crm.communications` | oc-server | oc-server |
| `crm.notifications` | oc-server | oc-restaurant-manager |

---

## Trigger-Scoped Variables

Email/SMS inline composers use `{{dot.notation}}` variables scoped to the trigger type. All triggers include universal variables:

### Universal Variables (all triggers)
| Variable | Description | Resolution |
|----------|-------------|------------|
| `{{customer.first_name}}` | Contact's first name | `contact.firstName`; falls back to first token of `payload.customerName` |
| `{{customer.last_name}}` | Contact's last name | `contact.lastName`; falls back to remaining tokens of `payload.customerName` (e.g. `'John Smith Jr'` → `'Smith Jr'`) |
| `{{customer.email}}` | Contact's email | `contact.email` |
| `{{customer.phone}}` | Contact's phone | `contact.phone` (object `{countryCode, number}` or plain string); falls back to `payload.customerPhone` |
| `{{restaurant.name}}` | Restaurant name | `restaurant.name` |
| `{{restaurant.phone}}` | Restaurant phone | `restaurant.phone` |

> **Backwards-compat alias:** `{{restaurant.owner_name}}` is silently rewritten to `{{restaurant.name}}` before interpolation, so old saved flow templates continue to render correctly. The variable is no longer shown in the variable picker.

### Trigger-Specific Variables

| Trigger | Additional Variables |
|---------|---------------------|
| `new_order` (fires on payment.succeeded — uses upsertFromEvent for first-time customers, does NOT increment stats) | `{{order.total}}`, `{{order.number}}`, `{{payment.method}}` |
| `order_completed` (fires once on first qualifying fulfillment status: ready, out_for_delivery, delivered, completed), `first_order`, `nth_order` | `{{order.total}}`, `{{order.number}}`, `{{order.items_summary}}`, `{{order.date}}` |
| `payment_failed` | `{{order.total}}`, `{{order.number}}`, `{{payment.failure_reason}}` |
| `order_status_changed` (supports `config.targetStatus` filter — if set, fires only when `newStatus` matches; if empty/unset, fires on every status change) | `{{order.number}}`, `{{order.status}}` |
| `abandoned_cart` | `{{cart.items_summary}}`, `{{cart.total}}`, `{{cart.abandon_time}}` |
| `no_order_in_x_days` | `{{customer.last_order_date}}`, `{{customer.days_since_order}}` |

#### Variable Resolution Notes

- **`order.items_summary`**: Kafka events do not include order items. When `payload.items` is empty but `payload.orderId` exists, `buildContext()` performs an async DB lookup (`Order.findById(orderId)`) to fetch items and format them as `"2x Burger, 1x Fries"`.
- **`customer.last_name`**: If `contact.lastName` is empty (e.g., single-word name, or ContactService hasn't split the name yet), `buildContext()` splits `payload.customerName` by whitespace — first token → `first_name`, remaining tokens → `last_name`.
- **`customer.phone`**: Accepts both `{ countryCode, number }` object (from Contact model) and plain string (from Kafka `customerPhone` field). Falls back to `payload.customerPhone` when contact has no phone.
- **`buildContext()` is async** — callers must `await` it (ActionService, ReviewRequestScheduler).

Unknown variables are replaced with an empty string.

---

## Trigger Config Keys

Each trigger node stores its configuration in `node.config`. The backend reads these keys when evaluating triggers.

| Trigger | Config Key | Type | Default | Backend Reader |
|---------|-----------|------|---------|----------------|
| `order_completed` | `minOrderTotal` | `number` | — | `TriggerService.checkTriggerConditions()` |
| `nth_order` | `n` | `number` | 5 | `TriggerService.checkTriggerConditions()` |
| `no_order_in_x_days` | `days` | `number` | 30 | `InactivityChecker.ts` (line ~72) |
| `order_status_changed` | `targetStatus` | `string` | — (any) | `TriggerService.checkTriggerConditions()` |
| `payment_failed` | — | — | — | — |
| `abandoned_cart` | — | — | — | — |
| `first_order` | — | — | — | — |
| `new_order` | — | — | — | — |

---

## Docker Deployment

```bash
# Build the image
docker build -t oc-server .

# Run with docker-compose
docker-compose up -d
```

The `docker-compose.yml` includes MongoDB, Redis, and Kafka for local development.
