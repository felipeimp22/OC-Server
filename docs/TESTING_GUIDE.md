# OC-Server CRM Engine — Testing Guide

How to manually test the CRM engine end-to-end: REST API via Insomnia/Postman, Kafka event simulation, BullMQ job verification, and full pipeline testing.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment Setup](#2-environment-setup)
3. [Starting the Server](#3-starting-the-server)
4. [REST API Testing (Insomnia / Postman)](#4-rest-api-testing)
5. [Kafka Event Testing](#5-kafka-event-testing)
6. [BullMQ Timer Job Testing](#6-bullmq-timer-job-testing)
7. [Full Pipeline Testing (Event → Flow → Action)](#7-full-pipeline-testing)
8. [Seed Data](#8-seed-data)
9. [Testing the Event Bridge from oc-restaurant-manager](#9-testing-the-event-bridge)
10. [Trigger System Testing](#10-trigger-system-testing)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

| Service   | Required | Default Address         |
|-----------|----------|-------------------------|
| MongoDB   | Yes      | `mongodb://localhost:27017` |
| Redis     | Yes      | `redis://localhost:6379` |
| Kafka     | Optional | `localhost:9092`        |

- **MongoDB**: Must be the same instance as the OrderChop Next.js app (shared database).
- **Redis**: Required for BullMQ timer jobs.
- **Kafka**: Only needed for event-driven flow testing. The API works without Kafka by setting `ENABLE_KAFKA=false`.

---

## 2. Environment Setup

Create a `.env` file in the project root:

```env
# Server
PORT=3001
NODE_ENV=development
LOG_LEVEL=debug

# Database (same as your OrderChop .env.local)
MONGODB_URI=mongodb://localhost:27017/orderchop

# Kafka (set to false to skip Kafka for API-only testing)
ENABLE_KAFKA=false
KAFKA_BROKERS=localhost:9092

# Redis
REDIS_URL=redis://localhost:6379

# Auth (MUST match the AUTH_SECRET from your NextAuth configuration)
AUTH_SECRET=your-nextauth-secret-here

# Schedulers (disable for isolated testing)
ENABLE_SCHEDULERS=false

# Email/SMS (optional — providers won't send real messages in dev)
EMAIL_PROVIDER=mailgun
SMS_PROVIDER=twilio
```

**Key notes:**
- `AUTH_SECRET` **must match** your OrderChop Next.js app's `AUTH_SECRET` — the CRM engine uses it to verify JWT tokens.
- Set `ENABLE_KAFKA=false` and `ENABLE_SCHEDULERS=false` for isolated API testing without Kafka/Redis dependencies.

---

## 3. Starting the Server

```bash
# Install dependencies
npm install

# Start in development mode (with tsx watch)
npm run dev

# Or build and run
npm run build
npm start
```

Verify the server is running:

```bash
curl http://localhost:3001/api/v1/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 1.234,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "mongodb": "connected"
}
```

---

## 4. REST API Testing

### Authentication Setup

Every API request (except `/api/v1/health` and `/t/:trackingId`) requires two headers:

| Header             | Value                         |
|--------------------|-------------------------------|
| `Authorization`    | `Bearer <jwt-token>`          |
| `X-Restaurant-Id`  | Your restaurant's ObjectId    |

#### How to get a JWT token

**Option A: Copy from browser** (easiest)
1. Log into your OrderChop app in the browser
2. Open DevTools → Application → Cookies
3. Find the `next-auth.session-token` cookie value
4. Use it as your Bearer token

**Option B: Generate a test token** using Node.js:
```javascript
// generate-token.js
import { SignJWT } from 'jose';

const secret = new TextEncoder().encode('your-nextauth-secret-here');

const token = await new SignJWT({
  sub: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
})
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('24h')
  .sign(secret);

console.log(token);
```

Run: `node --experimental-modules generate-token.js`

#### How to get a Restaurant ID

Query MongoDB:
```bash
mongosh orderchop --eval "db.restaurants.findOne({}, {_id:1, name:1})"
```

### Insomnia / Postman Setup

1. Create an environment with variables:
   - `base_url`: `http://localhost:3001`
   - `token`: `<your-jwt-token>`
   - `restaurant_id`: `<your-restaurant-objectid>`

2. Set default headers for every request:
   ```
   Authorization: Bearer {{token}}
   X-Restaurant-Id: {{restaurant_id}}
   Content-Type: application/json
   ```

### API Endpoints — Request Examples

#### Health Check (no auth needed)
```
GET {{base_url}}/api/v1/health
```

#### List Flows
```
GET {{base_url}}/api/v1/flows?page=1&limit=10
```

#### Create a Flow
```
POST {{base_url}}/api/v1/flows
Content-Type: application/json

{
  "name": "Test Welcome Flow",
  "description": "A test flow",
  "nodes": [
    {
      "id": "trigger-1",
      "type": "trigger",
      "subType": "order_completed",
      "label": "Order Completed",
      "config": {},
      "position": { "x": 250, "y": 50 }
    },
    {
      "id": "action-1",
      "type": "action",
      "subType": "send_email",
      "label": "Send Welcome Email",
      "config": { "subject": "Thanks for your order!" },
      "position": { "x": 250, "y": 200 }
    },
    {
      "id": "stop-1",
      "type": "logic",
      "subType": "stop",
      "label": "End",
      "config": {},
      "position": { "x": 250, "y": 350 }
    }
  ],
  "edges": [
    { "id": "e1", "sourceNodeId": "trigger-1", "targetNodeId": "action-1" },
    { "id": "e2", "sourceNodeId": "action-1", "targetNodeId": "stop-1" }
  ]
}
```

#### Get Flow by ID
```
GET {{base_url}}/api/v1/flows/{{flow_id}}
```

#### Update a Flow (PUT — not PATCH)
```
PUT {{base_url}}/api/v1/flows/{{flow_id}}
Content-Type: application/json

{
  "name": "Updated Flow Name",
  "description": "Updated description"
}
```

#### Activate a Flow
```
POST {{base_url}}/api/v1/flows/{{flow_id}}/activate
```

#### Pause a Flow
```
POST {{base_url}}/api/v1/flows/{{flow_id}}/pause
```

#### Delete a Flow
```
DELETE {{base_url}}/api/v1/flows/{{flow_id}}
```

#### List Flow Templates
```
GET {{base_url}}/api/v1/flows/templates
```

#### Create Flow from Template
```
POST {{base_url}}/api/v1/flows/from-template
Content-Type: application/json

{
  "templateKey": "template_0",
  "name": "My Post-Order Nurture"
}
```

#### List Contacts
```
GET {{base_url}}/api/v1/contacts?page=1&limit=20
GET {{base_url}}/api/v1/contacts?lifecycle=VIP
GET {{base_url}}/api/v1/contacts?search=john
GET {{base_url}}/api/v1/contacts?tag={{tag_id}}
```

#### Get Contact Segments
```
GET {{base_url}}/api/v1/contacts/segments
```

Expected response:
```json
{
  "lead": 42,
  "first_time": 18,
  "returning": 95,
  "lost": 12,
  "recovered": 5,
  "VIP": 8
}
```

#### Update a Contact
```
PUT {{base_url}}/api/v1/contacts/{{contact_id}}
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Doe",
  "emailOptIn": true,
  "smsOptIn": false,
  "customFields": {
    "favorite_dish": "Margherita Pizza"
  }
}
```

#### Apply Tags to Contact
```
POST {{base_url}}/api/v1/contacts/{{contact_id}}/tags
Content-Type: application/json

{
  "tagIds": ["{{tag_id_1}}", "{{tag_id_2}}"]
}
```

#### Remove Tag from Contact
```
DELETE {{base_url}}/api/v1/contacts/{{contact_id}}/tags/{{tag_id}}
```

#### Get Contact Timeline
```
GET {{base_url}}/api/v1/contacts/{{contact_id}}/timeline?limit=20
```

#### Create a Tag
```
POST {{base_url}}/api/v1/tags
Content-Type: application/json

{
  "name": "High spender",
  "description": "Customers with LTV > $500",
  "color": "#10B981"
}
```

#### Create a Template
```
POST {{base_url}}/api/v1/templates
Content-Type: application/json

{
  "channel": "email",
  "name": "Welcome Email",
  "subject": "Welcome, {{first_name}}!",
  "body": "<p>Hi {{first_name}}, thanks for joining {{restaurant_name}}!</p>"
}
```

#### Preview a Template
```
POST {{base_url}}/api/v1/templates/{{template_id}}/preview
Content-Type: application/json

{
  "sampleData": {
    "first_name": "John",
    "restaurant_name": "Pizza Palace"
  }
}
```

#### Create a Custom Field
```
POST {{base_url}}/api/v1/custom-fields
Content-Type: application/json

{
  "key": "dietary_preference",
  "name": "Dietary Preference",
  "fieldType": "dropdown",
  "options": ["vegetarian", "vegan", "gluten_free", "none"],
  "isRequired": false,
  "sortOrder": 1
}
```

#### Dashboard Overview
```
GET {{base_url}}/api/v1/analytics/overview
```

Expected response:
```json
{
  "totalContacts": 180,
  "newContactsThisMonth": 23,
  "segments": {
    "lead": 42,
    "first_time": 18,
    "returning": 95,
    "lost": 12,
    "recovered": 5,
    "VIP": 8
  },
  "activeFlows": 3,
  "totalEnrollments": 1250,
  "messagingStats": [
    { "channel": "email", "status": "sent", "count": 456 },
    { "channel": "sms", "status": "sent", "count": 120 }
  ]
}
```

#### Messaging Stats
```
GET {{base_url}}/api/v1/analytics/messaging
GET {{base_url}}/api/v1/analytics/messaging?since=2024-01-01T00:00:00Z
```

#### Create a Campaign
```
POST {{base_url}}/api/v1/campaigns
Content-Type: application/json

{
  "name": "Summer 2024 Promo",
  "description": "Summer promotion campaign",
  "flowIds": ["{{flow_id}}"],
  "source": "summer2024"
}
```

#### Sync Contacts from OrderChop
```
POST {{base_url}}/api/v1/system/sync-contacts
```

Returns: `{ "synced": 42, "total": 42 }`

---

## 5. Kafka Event Testing

### When to use Kafka

Kafka events are what trigger the flow engine. Without Kafka, the CRM API works for CRUD operations but flows won't execute automatically. You need Kafka to test:

- Order completed → flow triggers
- Customer created → contact sync
- Cart abandoned → abandoned cart flows
- CRM internal events (tag applied, field changed)

### Kafka Topics

| Topic                 | Direction | Event Types |
|-----------------------|-----------|-------------|
| `orderchop.orders`    | Incoming  | `order.completed`, `order.status_changed` |
| `orderchop.payments`  | Incoming  | `payment.failed` |
| `orderchop.customers` | Incoming  | `customer.created`, `customer.updated` |
| `orderchop.carts`     | Incoming  | `cart.abandoned` |
| `crm.flow.execute`    | Internal  | `flow.step.ready` |
| `crm.flow.timer`      | Internal  | `flow.timer.fire` |
| `crm.notifications`   | Outgoing  | `notification.email`, `notification.sms` |

### Producing Test Events

**Option A: Use `kafkacat` / `kcat`**

```bash
# Order completed event
echo '{"eventType":"order.completed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order123","customerId":"customer123","total":45.99,"orderType":"delivery"}}' | kcat -b localhost:9092 -t orderchop.orders -P

# Customer created event
echo '{"eventType":"customer.created","restaurantId":"YOUR_RESTAURANT_ID","payload":{"customerId":"customer123","name":"John Doe","email":"john@example.com","phone":{"countryCode":"+1","number":"5551234567"}}}' | kcat -b localhost:9092 -t orderchop.customers -P

# Cart abandoned event
echo '{"eventType":"cart.abandoned","restaurantId":"YOUR_RESTAURANT_ID","payload":{"customerId":"customer123","cartId":"cart123","total":32.50}}' | kcat -b localhost:9092 -t orderchop.carts -P

# Payment failed event
echo '{"eventType":"payment.failed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order456","customerId":"customer123","error":"insufficient_funds"}}' | kcat -b localhost:9092 -t orderchop.payments -P
```

**Option B: Use the Kafka console producer (comes with Kafka)**

```bash
kafka-console-producer --broker-list localhost:9092 --topic orderchop.orders
```

Then paste JSON messages line by line.

**Option C: Use a Node.js script**

```javascript
// test-kafka-producer.js
import { Kafka } from 'kafkajs';

const kafka = new Kafka({ brokers: ['localhost:9092'] });
const producer = kafka.producer();

async function sendEvent(topic, event) {
  await producer.connect();
  await producer.send({
    topic,
    messages: [{
      key: event.restaurantId,
      value: JSON.stringify(event),
    }],
  });
  console.log(`Sent to ${topic}:`, event.eventType);
  await producer.disconnect();
}

// Example: order completed
await sendEvent('orderchop.orders', {
  eventType: 'order.completed',
  restaurantId: 'YOUR_RESTAURANT_ID',
  payload: {
    orderId: 'order-' + Date.now(),
    customerId: 'EXISTING_CUSTOMER_ID',
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    total: 45.99,
    orderType: 'delivery',
    items: ['Margherita Pizza', 'Coke'],
  },
});
```

Run: `node test-kafka-producer.js`

### Event Message Schema

All Kafka messages follow this shape:

```typescript
interface KafkaEvent {
  eventType: string;        // e.g., "order.completed"
  restaurantId: string;     // ObjectId string
  payload: {
    customerId: string;     // ObjectId string (required for all events)
    [key: string]: unknown; // Event-specific data
  };
}
```

### Verifying Kafka Consumption

Watch the server logs (`LOG_LEVEL=debug`):

```
[2024-01-01T00:00:00.000Z] DEBUG (OrderEventConsumer): Processing event {"eventType":"order.completed","restaurantId":"..."}
[2024-01-01T00:00:01.000Z] INFO (TriggerService): Matched 2 active flows for trigger "order_completed"
[2024-01-01T00:00:01.000Z] INFO (FlowEngineService): Enrolling contact "contact123" into flow "flow456"
```

---

## 6. BullMQ Timer Job Testing

Timer nodes in flows (e.g., "wait 24 hours") are processed by BullMQ. The server schedules a delayed job in Redis, which fires when the delay expires.

### Checking pending timer jobs

```bash
# Connect to Redis CLI
redis-cli

# List all BullMQ queues
KEYS bull:flow-timers:*

# Check waiting jobs
LRANGE bull:flow-timers:wait 0 -1

# Check delayed jobs
ZRANGE bull:flow-timers:delayed 0 -1 WITHSCORES
```

### Testing with short delays

When creating test flows, use very short timer durations:

```json
{
  "id": "timer-1",
  "type": "timer",
  "subType": "delay",
  "config": { "duration": 1, "unit": "minutes" }
}
```

Then watch the logs for the timer firing:

```
[...] INFO (FlowTimerProcessor): Processing timer job for execution "exec123", node "timer-1"
[...] INFO (FlowEngineService): Resuming execution "exec123" from node "action-1"
```

---

## 7. Full Pipeline Testing (Event → Flow → Action)

This tests the complete automation chain: an external event triggers a flow, the flow executes actions on the contact.

### Step-by-step

1. **Sync contacts** (so you have CRM contacts from OrderChop customers):
   ```
   POST /api/v1/system/sync-contacts
   ```

2. **Create a tag**:
   ```
   POST /api/v1/tags
   { "name": "test-tag", "color": "#EF4444" }
   ```

3. **Create a simple flow** (order completed → send_email):
   ```
   POST /api/v1/flows
   {
     "name": "Test Pipeline Flow",
     "nodes": [
       { "id": "t1", "type": "trigger", "subType": "order_completed", "label": "Order Completed", "config": {}, "position": {"x":0,"y":0} },
       { "id": "a1", "type": "action", "subType": "send_email", "label": "Thank You Email",
         "config": {
           "recipients": [{"type": "customer"}],
           "subject": "Thanks, {{customer.first_name}}!",
           "body": "Hi {{customer.first_name}}, thanks for your order."
         },
         "position": {"x":0,"y":150} }
     ],
     "edges": [
       { "id": "e1", "sourceNodeId": "t1", "targetNodeId": "a1" }
     ]
   }
   ```

4. **Activate the flow**:
   ```
   POST /api/v1/flows/{{flow_id}}/activate
   ```

5. **Produce a Kafka event** (order.completed for an existing customer):
   ```bash
   echo '{"eventType":"order.completed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"test-order-1","customerId":"YOUR_CUSTOMER_ID","total":29.99,"orderType":"pickup"}}' | kcat -b localhost:9092 -t orderchop.orders -P
   ```

6. **Verify the results**:
   - Check server logs for flow execution
   - Check the contact has the tag applied:
     ```
     GET /api/v1/contacts/{{contact_id}}
     ```
   - Check the contact timeline for execution logs:
     ```
     GET /api/v1/contacts/{{contact_id}}/timeline
     ```
   - Check flow analytics:
     ```
     GET /api/v1/flows/{{flow_id}}/analytics
     ```

### Testing without Kafka (API-only mode)

If you don't have Kafka running, you can still test the API CRUD operations and seed data. Set:

```env
ENABLE_KAFKA=false
ENABLE_SCHEDULERS=false
```

This lets you:
- Create, update, delete flows, tags, templates, custom fields, campaigns
- Sync contacts from the existing OrderChop database
- View analytics (based on existing data in MongoDB)
- Test the flow builder UI (frontend) against real API responses

Flow execution won't happen automatically, but all management APIs work.

---

## 8. Seed Data

Seed system tags, templates, and the review request flow:

```bash
npx tsx src/seeds/seed.ts YOUR_RESTAURANT_ID
```

This creates:
- **System tags**: VIP, lost, recovered, at-risk
- **System templates**: Review SMS template, Review Email template
- **System flow**: Post-Order Review Request flow (auto-activated)

You can verify:
```
GET /api/v1/tags
GET /api/v1/templates
GET /api/v1/flows
```

---

## 9. Testing the Event Bridge from oc-restaurant-manager

The Event Bridge is the HTTP path from `oc-restaurant-manager` → oc-server → Kafka. This tests the real production flow for order/payment/customer events.

### How the Bridge Works

1. `publishEvent(restaurantId, eventType, payload)` in `oc-restaurant-manager/lib/services/eventPublisher.ts` writes to the Prisma `CRMEvent` outbox and fires `deliverEvent()`.
2. `deliverEvent()` POSTs `{ eventId, eventType, payload }` to `POST /api/v1/events/ingest` with a system JWT signed using `AUTH_SECRET`.
3. oc-server routes the event to the correct Kafka topic and returns `{ ok: true }`.
4. Failed deliveries are retried by `GET /api/cron/crm-events` (protected by `CRON_SECRET`).

### Prerequisites

Both services must be running and share the same `AUTH_SECRET`:
- `oc-restaurant-manager`: `npm run dev` (default port 3000)
- `oc-server`: `npm run dev` (default port 3001)

### Step 1: Verify the ingest endpoint

Call the ingest endpoint directly with a test event using a manually signed token:

```bash
# Generate a system token (run in oc-server directory)
node -e "
import { SignJWT } from 'jose';
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
const token = await new SignJWT({ system: true })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('system-event-publisher')
  .setExpirationTime('5m')
  .sign(key);
console.log(token);
" --input-type=module
```

Then post to the ingest endpoint:

```bash
curl -X POST http://localhost:3001/api/v1/events/ingest \
  -H "Authorization: Bearer <system-token>" \
  -H "X-Restaurant-Id: <your-restaurant-id>" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-event-1",
    "eventType": "order.completed",
    "payload": {
      "restaurantId": "<your-restaurant-id>",
      "customerId": "<existing-customer-id>",
      "orderId": "test-order-1",
      "total": 29.99,
      "orderType": "delivery"
    }
  }'
```

Expected response: `{ "ok": true }`

### Step 2: Trigger via oc-restaurant-manager

Use `publishEvent()` directly in a Next.js server action or API route:

```typescript
// In oc-restaurant-manager — e.g., a test API route or server action
import { publishEvent, CRMEventType } from '@/lib/services/eventPublisher';

publishEvent(restaurantId, CRMEventType.ORDER_COMPLETED, {
  orderId: 'test-order-123',
  orderNumber: 'ORD-001',
  customerId: existingCustomerId,
  customerEmail: 'test@example.com',
  customerName: 'Test Customer',
  orderType: 'delivery',
  orderTotal: 45.99,
  paymentStatus: 'paid',
  status: 'completed',
});
```

### Step 3: Verify delivery

1. Check the Prisma outbox in oc-restaurant-manager's database:
   ```sql
   SELECT eventId, eventType, status, attempts, deliveredAt
   FROM CRMEvent ORDER BY createdAt DESC LIMIT 5;
   ```
   Look for `status: 'delivered'`.

2. Watch oc-server logs (`LOG_LEVEL=debug`) for the consumer processing the event:
   ```
   [OrderEventConsumer] Processing event: order.completed
   [TriggerService] Matched N flows for trigger "order_completed"
   [FlowEngineService] Enrolling contact into flow ...
   ```

3. Verify in MongoDB:
   ```javascript
   db.crm_flow_executions.find({ restaurantId: ObjectId("...") }).sort({ createdAt: -1 }).limit(3)
   ```

### Step 4: Test the retry cron

To simulate a retry cycle (when oc-server is temporarily down):

```bash
# Trigger the retry cron manually
curl -H "Authorization: Bearer <cron-secret>" \
  http://localhost:3000/api/cron/crm-events
```

Expected response: `{ "retried": N }`

### Automated Smoke Test

Run the full pipeline smoke test (requires running infrastructure):

```bash
cd oc-server
npm run smoke-test <restaurantId> <authToken>
```

This tests sync-contacts, seed, flow creation/activation, Kafka event publishing, execution polling, tag verification, timeline, and analytics overview.

---

## 10. Trigger System Testing

This section covers testing triggers, execution features, and item-based triggers in the CRM engine. Subsections 10.1–10.7 cover the original trigger types: **order_completed** (fulfillment statuses), **order_status_changed** (targetStatuses multi-select filter), **new_order** (payment.succeeded), template variables, and abandoned cart. Subsection 10.8 covers **action chaining and fan-out** (v3). Subsection 10.9 covers **item_ordered** and **item_ordered_x_times** triggers (v3). Subsection 10.10 covers **multi-select status filtering** (targetStatuses array for item triggers). Subsection 10.11 covers the **runOnce toggle** for order_status_changed. Subsection 10.12 covers **payment status enforcement** (universal guard). Each subsection includes copy-paste commands, expected server logs, and MongoDB verification queries.

**Prerequisites**: Kafka running (`ENABLE_KAFKA=true`), an existing restaurant ID, and at least one customer ID in the database. Replace `YOUR_RESTAURANT_ID` and `YOUR_CUSTOMER_ID` with real ObjectId strings throughout.

---

### 10.1 Order Completed — Fulfillment Statuses

The `order_completed` trigger fires when an order reaches any of these statuses: `ready`, `out_for_delivery`, `delivered`, `completed`. It fires exactly once per order thanks to `tryProcessEvent` idempotency.

#### Setup: Create and activate a flow with order_completed trigger

```bash
# Create flow
curl -s -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Order Completed Flow",
    "nodes": [
      { "id": "t1", "type": "trigger", "subType": "order_completed", "label": "Order Completed", "config": {}, "position": {"x":0,"y":0} },
      { "id": "a1", "type": "action", "subType": "send_email", "label": "Thank You Email",
        "config": { "recipients": [{"type":"customer"}], "subject": "Thanks!", "body": "Your order is on its way." },
        "position": {"x":0,"y":150} }
    ],
    "edges": [{ "id": "e1", "sourceNodeId": "t1", "targetNodeId": "a1" }]
  }'
# Note the flow ID from the response

# Activate the flow
curl -s -X POST http://localhost:3001/api/v1/flows/FLOW_ID/activate \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID"
```

#### Test A: First qualifying status fires the trigger

Send an `order.status_changed` event with status `ready`:

```bash
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-001","orderNumber":"ORD-001","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":45.99,"paymentStatus":"paid","status":"ready","previousStatus":"preparing"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected server logs:**
```
[OrderEventConsumer] Processing order event {"eventType":"order.status_changed","orderId":"order-test-001"}
[TriggerService] Matched N active flows for trigger "order_status_changed"
[OrderEventConsumer] Qualifying fulfillment status — firing processOrderAsCompleted {"orderId":"order-test-001","newStatus":"ready"}
[TriggerService] Matched N active flows for trigger "order_completed"
[FlowEngineService] Enrolling contact into flow ...
```

**Verify — flow execution created:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-001"
}).pretty()
// Expected: 1 document with status "active" or "completed"
```

**Verify — order stats incremented:**
```javascript
db.crm_contacts.findOne({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  customerId: ObjectId("YOUR_CUSTOMER_ID")
}, { totalOrders: 1, totalSpent: 1 })
// Expected: totalOrders incremented by 1, totalSpent increased by 45.99
```

**Verify — idempotency record created:**
```javascript
db.crm_processed_events.findOne({ eventId: "order_completed_process:order-test-001" })
// Expected: 1 document (confirms tryProcessEvent recorded this order)
```

#### Test B: Second qualifying status does NOT re-fire

Send a `order.status_changed` event for the same order with status `delivered`:

```bash
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-001","orderNumber":"ORD-001","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":45.99,"paymentStatus":"paid","status":"delivered","previousStatus":"ready"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected server logs:**
```
[OrderEventConsumer] Qualifying fulfillment status — firing processOrderAsCompleted {"orderId":"order-test-001","newStatus":"delivered"}
[OrderEventConsumer] Order already processed as completed — skipping duplicate {"orderId":"order-test-001"}
```

**Verify — no additional flow execution:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-001"
}).count()
// Expected: still 1 (no new execution)
```

---

### 10.2 Order Completed — Dual-Event-Path Dedup

When `kitchen.actions.ts` sets an order to `completed`, it publishes BOTH `order.status_changed` and `order.completed` Kafka events. The system must process the order exactly once.

#### Test: Both events arrive for the same order

Use a fresh orderId to avoid interference:

```bash
# Event 1: order.status_changed with status=completed
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-002","orderNumber":"ORD-002","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"pickup","orderTotal":25.00,"paymentStatus":"paid","status":"completed","previousStatus":"ready"}}' | kcat -b localhost:9092 -t orderchop.orders -P

# Event 2: order.completed (arrives shortly after)
echo '{"eventType":"order.completed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-002","orderNumber":"ORD-002","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"pickup","orderTotal":25.00,"paymentStatus":"paid","status":"completed"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected:** The first event processed triggers the flow and increments stats. The second event is blocked by `tryProcessEvent`.

**Verify — exactly one execution:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-002"
}).count()
// Expected: 1

db.crm_processed_events.findOne({ eventId: "order_completed_process:order-test-002" })
// Expected: exists (confirms dedup key was set by whichever event arrived first)
```

---

### 10.3 Order Status Changed — targetStatuses Filter (Multi-Select)

The `order_status_changed` trigger supports `config.targetStatuses: string[]` (array). If set with one or more statuses, the trigger fires only when the new status is in the array. If empty or unset, it fires on every status change. Legacy `config.targetStatus` (single string) is auto-converted to `[targetStatus]` for backward compatibility.

#### Setup: Create a flow with targetStatuses = ['confirmed', 'ready']

```bash
curl -s -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Status Changed — Confirmed or Ready",
    "nodes": [
      { "id": "t1", "type": "trigger", "subType": "order_status_changed", "label": "Status Changed",
        "config": { "targetStatuses": ["confirmed", "ready"] }, "position": {"x":0,"y":0} },
      { "id": "a1", "type": "action", "subType": "send_email", "label": "Status Email",
        "config": { "recipients": [{"type":"customer"}], "subject": "Order Update!", "body": "Your order status has changed." },
        "position": {"x":0,"y":150} }
    ],
    "edges": [{ "id": "e1", "sourceNodeId": "t1", "targetNodeId": "a1" }]
  }'

# Activate the flow
curl -s -X POST http://localhost:3001/api/v1/flows/FLOW_ID/activate \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID"
```

#### Test A: Non-matching status — trigger does NOT fire

```bash
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-003","orderNumber":"ORD-003","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":30.00,"paymentStatus":"paid","newStatus":"preparing","previousStatus":"pending","status":"preparing"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected server logs:**
```
[TriggerService] targetStatuses mismatch {"configuredStatuses":["confirmed","ready"],"actualStatus":"preparing","reason":"targetStatuses mismatch"}
```

**Verify — no execution created:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-003"
}).count()
// Expected: 0
```

#### Test B: Matching status — trigger fires

```bash
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-004","orderNumber":"ORD-004","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":30.00,"paymentStatus":"paid","newStatus":"confirmed","previousStatus":"pending","status":"confirmed"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected:** Flow fires, contact enrolled.

**Verify — execution created:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-004"
}).count()
// Expected: 1
```

#### Test C: Empty targetStatuses — fires on every status change

Create a second flow with `"config": {}` (no targetStatuses), activate it, then send any status change — it should fire for every status.

#### Test D: Legacy targetStatus (single string) — backward compatibility

Create a flow with the old format: `"config": { "targetStatus": "confirmed" }`. The backend auto-converts this to `targetStatuses: ["confirmed"]`. Send a status change to `confirmed` — trigger should fire. Send a status change to `preparing` — trigger should NOT fire.

---

### 10.4 New Order — payment.succeeded

The `new_order` trigger fires on `payment.succeeded` Kafka events. It uses `upsertFromEvent()` so it works for first-time customers. It does NOT increment order stats.

#### Setup: Create and activate a flow with new_order trigger

```bash
curl -s -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test New Order Flow",
    "nodes": [
      { "id": "t1", "type": "trigger", "subType": "new_order", "label": "New Order", "config": {}, "position": {"x":0,"y":0} },
      { "id": "a1", "type": "action", "subType": "send_email", "label": "Order Received Email",
        "config": { "recipients": [{"type":"customer"}], "subject": "We got your order!", "body": "Thanks for ordering, {{customer.first_name}}!" },
        "position": {"x":0,"y":150} }
    ],
    "edges": [{ "id": "e1", "sourceNodeId": "t1", "targetNodeId": "a1" }]
  }'

# Activate the flow
curl -s -X POST http://localhost:3001/api/v1/flows/FLOW_ID/activate \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID"
```

#### Test: payment.succeeded fires new_order trigger

```bash
echo '{"eventType":"payment.succeeded","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-005","orderNumber":"ORD-005","customerId":"YOUR_CUSTOMER_ID","customerEmail":"newcustomer@example.com","customerName":"New Customer","customerPhone":"+15559876543","orderType":"pickup","orderTotal":18.50,"paymentStatus":"paid","paymentMethod":"card"}}' | kcat -b localhost:9092 -t orderchop.payments -P
```

**Expected server logs:**
```
[OrderEventConsumer] Processing order event {"eventType":"payment.succeeded","orderId":"order-test-005"}
[TriggerService] Matched N active flows for trigger "new_order"
[FlowEngineService] Enrolling contact into flow ...
```

**Verify — flow execution created:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-005"
}).count()
// Expected: 1
```

**Verify — contact upserted (works for first-time customers):**
```javascript
db.crm_contacts.findOne({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  customerId: ObjectId("YOUR_CUSTOMER_ID")
}, { totalOrders: 1, totalSpent: 1, email: 1 })
// Expected: contact exists; totalOrders and totalSpent NOT incremented by this event
```

**Verify — stats NOT incremented:**
Note the contact's `totalOrders` and `totalSpent` before and after the payment.succeeded event. They should remain unchanged — stats are only incremented in `processOrderAsCompleted()` (fulfillment statuses), not on payment confirmation.

#### Test: Duplicate payment.succeeded for same order — no re-fire

```bash
echo '{"eventType":"payment.succeeded","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-test-005","orderNumber":"ORD-005","customerId":"YOUR_CUSTOMER_ID","customerEmail":"newcustomer@example.com","customerName":"New Customer","customerPhone":"+15559876543","orderType":"pickup","orderTotal":18.50,"paymentStatus":"paid","paymentMethod":"card"}}' | kcat -b localhost:9092 -t orderchop.payments -P
```

**Expected:** The per-flow orderId dedup (`hasOrderBeenProcessedForFlow`) in TriggerService prevents re-enrollment.

**Verify — still exactly one execution:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-test-005"
}).count()
// Expected: 1 (no duplicate)
```

---

### 10.5 Quick Reference — MongoDB Verification Queries

```javascript
// Check all flow executions for a specific order
db.crm_flow_executions.find({ "context.orderId": "ORDER_ID" }).pretty()

// Check the processed events collection for dedup keys
db.crm_processed_events.find({ eventId: /order_completed_process/ }).sort({ processedAt: -1 }).limit(5)

// Check contact stats (totalOrders, totalSpent)
db.crm_contacts.findOne(
  { restaurantId: ObjectId("YOUR_RESTAURANT_ID"), customerId: ObjectId("YOUR_CUSTOMER_ID") },
  { totalOrders: 1, totalSpent: 1, lifecycleStatus: 1 }
)

// Count executions per flow (useful for verifying dedup)
db.crm_flow_executions.aggregate([
  { $match: { restaurantId: ObjectId("YOUR_RESTAURANT_ID") } },
  { $group: { _id: { flowId: "$flowId", orderId: "$context.orderId" }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
])
// Expected: empty result (no order should appear more than once per flow)
```

---

### 10.6 Template Variable Interpolation

This section covers verifying that template variables resolve correctly in CRM email/SMS actions, including the three variables that required special resolution logic.

#### Test A: `customer.last_name` — name splitting fallback

Create a flow with a send_email action using `{{customer.first_name}} {{customer.last_name}}` in the body. Send a Kafka event where:
- The contact has no `lastName` stored (or is a first-time customer)
- The Kafka payload includes `"customerName": "John Smith Jr"`

**Expected result**: The email body resolves to `"John Smith Jr"` — first token becomes `first_name`, remaining tokens joined as `last_name`.

**Verify in communication logs:**
```javascript
db.crm_communication_logs.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID")
}).sort({ sentAt: -1 }).limit(1).pretty()
// Check the interpolated subject/body fields contain the correct name
```

#### Test B: `customer.phone` — plain string from Kafka

Send an order.completed Kafka event with `"customerPhone": "+1 7787915942"` (flat string, not an object).

**Expected result**: `{{customer.phone}}` resolves to `"+1 7787915942"` even if the contact's phone field is empty or stored as an object.

**Note**: The phone resolution order is: `contact.phone` (object format) → `contact.phone` (string format) → `payload.customerPhone` (string fallback from Kafka).

#### Test C: `order.items_summary` — DB lookup fallback

1. Create an order in the `orders` collection with items:
   ```javascript
   db.orders.insertOne({
     restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
     orderNumber: "ORD-ITEMS-TEST",
     customerId: ObjectId("YOUR_CUSTOMER_ID"),
     customerName: "Test User",
     customerEmail: "test@example.com",
     customerPhone: "+15551234567",
     items: [
       { name: "Margherita Pizza", quantity: 2, price: 15.99, options: [] },
       { name: "Caesar Salad", quantity: 1, price: 9.99, options: [] }
     ],
     orderType: "delivery",
     status: "completed",
     paymentStatus: "paid",
     paymentMethod: "card",
     subtotal: 41.97, tax: 3.36, tip: 5, driverTip: 0, deliveryFee: 3.99, platformFee: 0, processingFee: 0, total: 54.32,
   })
   ```

2. Send a Kafka event for this order **without** `items` in the payload (this is the normal case — Kafka events don't include items).

3. The flow's send_email action should use `{{order.items_summary}}` in the body.

**Expected result**: `buildContext()` detects missing items, performs `Order.findById(orderId)`, and resolves `items_summary` to `"2x Margherita Pizza, 1x Caesar Salad"`.

**Verify:**
```javascript
db.crm_communication_logs.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID")
}).sort({ sentAt: -1 }).limit(1).pretty()
// The interpolated body should contain the items summary from the DB lookup
```

---

### 10.7 Abandoned Cart Delayed Triggers

The `abandoned_cart` trigger uses BullMQ delayed jobs. When a `cart.abandoned` event arrives, CartEventConsumer schedules a delayed job (1–90 days). The AbandonedCartProcessor picks up the job when the delay expires, checks if the order is still pending, and fires the trigger only if the cart is genuinely abandoned.

#### Setup: Create and activate a flow with abandoned_cart trigger

```bash
curl -s -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Abandoned Cart Flow",
    "nodes": [
      { "id": "t1", "type": "trigger", "subType": "abandoned_cart", "label": "Abandoned Cart",
        "config": { "delayDays": 1 }, "position": {"x":0,"y":0} },
      { "id": "a1", "type": "action", "subType": "send_email", "label": "Cart Reminder",
        "config": { "recipients": [{"type":"customer"}], "subject": "You left items in your cart!", "body": "Hi {{customer.first_name}}, come back and complete your order." },
        "position": {"x":0,"y":150} }
    ],
    "edges": [{ "id": "e1", "sourceNodeId": "t1", "targetNodeId": "a1" }]
  }'

# Activate the flow
curl -s -X POST http://localhost:3001/api/v1/flows/FLOW_ID/activate \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Restaurant-Id: YOUR_RESTAURANT_ID"
```

#### Test A: Cart abandoned → delay expires → order still pending → flow triggers

1. Send a `cart.abandoned` Kafka event:
```bash
echo '{"eventType":"cart.abandoned","restaurantId":"YOUR_RESTAURANT_ID","payload":{"customerId":"YOUR_CUSTOMER_ID","orderId":"ORDER_ID","customerEmail":"test@example.com","customerName":"Test User","total":32.50,"items":["Pizza","Coke"]}}' | kcat -b localhost:9092 -t orderchop.carts -P
```

2. Verify a BullMQ delayed job was scheduled:
```bash
redis-cli ZRANGE bull:abandoned-cart-triggers:delayed 0 -1 WITHSCORES
# Expected: job with key "abandoned-cart-ORDER_ID-FLOW_ID" with future timestamp
```

3. For testing, set `delayDays: 0` or use short delay. When the job fires:

**Expected server logs:**
```
[AbandonedCartProcessor] Abandoned cart job received {"orderId":"ORDER_ID","flowId":"FLOW_ID"}
[AbandonedCartProcessor] Order still pending — triggering abandoned cart flow {"orderId":"ORDER_ID","orderStatus":"pending"}
[TriggerService] Matched N active flows for trigger "abandoned_cart"
```

**Verify — flow execution created:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "ORDER_ID"
}).pretty()
// Expected: 1 document with status "active" or "completed"
```

#### Test B: Cart abandoned → order completed before delay expires → flow skipped

1. Send `cart.abandoned` event (same as Test A)
2. Before the delay expires, complete the order (send order.completed or payment.succeeded event)
3. When the job fires (or manually check):

**Expected server logs:**
```
[AbandonedCartProcessor] Order already completed — skipping abandoned cart flow {"orderId":"ORDER_ID","orderStatus":"paid"}
```

**Verify — no flow execution:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "ORDER_ID"
}).count()
// Expected: 0 (for abandoned_cart flows)
```

#### Test C: Cart abandoned → order completed before delay → job cancelled from queue

This tests the proactive cancellation in `OrderEventConsumer.cancelAbandonedCartJobs()` (as opposed to Test B which tests the processor's defense-in-depth order status check).

1. Send `cart.abandoned` event (same as Test A)
2. Verify delayed job exists in Redis:
```bash
redis-cli ZRANGE bull:abandoned-cart-triggers:delayed 0 -1 WITHSCORES
# Expected: job "abandoned-cart-ORDER_ID-FLOW_ID" present
```

3. Complete the order by sending a `payment.succeeded` or `order.completed` event:
```bash
echo '{"eventType":"payment.succeeded","restaurantId":"YOUR_RESTAURANT_ID","payload":{"customerId":"YOUR_CUSTOMER_ID","orderId":"ORDER_ID","customerEmail":"test@example.com","customerName":"Test User","orderTotal":32.50}}' | kcat -b localhost:9092 -t orderchop.payments -P
```

4. Verify the job was removed from Redis:
```bash
redis-cli ZRANGE bull:abandoned-cart-triggers:delayed 0 -1 WITHSCORES
# Expected: job "abandoned-cart-ORDER_ID-FLOW_ID" no longer present
```

**Expected server logs:**
```
[OrderEventConsumer] Cancelled abandoned cart job for orderId=ORDER_ID, flowId=FLOW_ID
```

5. Wait for the original delay to expire — no flow should fire (job was already removed).

#### BullMQ Queue Inspection

```bash
# Check delayed jobs (pending)
redis-cli ZRANGE bull:abandoned-cart-triggers:delayed 0 -1 WITHSCORES

# Check completed jobs
redis-cli LRANGE bull:abandoned-cart-triggers:completed 0 -1

# Check failed jobs
redis-cli LRANGE bull:abandoned-cart-triggers:failed 0 -1
```

---

## 11. Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| `401 Missing Authorization header` | No Bearer token | Add `Authorization: Bearer <token>` header |
| `401 Invalid token` | Wrong `AUTH_SECRET` | Ensure `.env AUTH_SECRET` matches NextAuth |
| `400 Missing X-Restaurant-Id` | No restaurant header | Add `X-Restaurant-Id: <id>` header |
| `Cannot update an active flow` | Flow is active | Pause the flow first, then update |
| `System flows cannot be deleted` | Trying to delete system flow | System flows are protected |
| MongoDB connection error | Wrong URI or MongoDB not running | Check `MONGODB_URI` and that mongod is running |
| Kafka connection timeout | Kafka broker not running | Start Kafka or set `ENABLE_KAFKA=false` |
| Redis connection error | Redis not running | Start Redis or check `REDIS_URL` |
| Flow not executing | Flow not activated | Activate the flow: `POST /flows/:id/activate` |
| Flow not executing | No matching trigger | Ensure the flow has a trigger matching the event type |
| Timer jobs not firing | Schedulers disabled | Set `ENABLE_SCHEDULERS=true` |

### Useful MongoDB Queries

```javascript
// Check CRM contacts
db.crm_contacts.find({ restaurantId: ObjectId("...") }).limit(5).pretty()

// Check flow executions
db.crm_flow_executions.find({ flowId: ObjectId("...") }).sort({createdAt: -1}).limit(5).pretty()

// Check execution logs (timeline entries)
db.crm_flow_execution_logs.find({ contactId: ObjectId("...") }).sort({executedAt: -1}).limit(10).pretty()

// Check communication logs
db.crm_communication_logs.find({ restaurantId: ObjectId("...") }).sort({sentAt: -1}).limit(10).pretty()

// Check active flows
db.crm_flows.find({ restaurantId: ObjectId("..."), status: "active" }).pretty()

// Check tags
db.crm_tags.find({ restaurantId: ObjectId("...") }).pretty()
```

### Testing no_order_in_x_days Cron

The `InactivityChecker` runs daily at 08:00 server time (`0 8 * * *`). To test it manually:

```bash
# Trigger the inactivity checker directly (ENABLE_SCHEDULERS=true required)
# In development, temporarily lower the cron schedule to test immediately.
# Or: insert a contact with lastOrderAt = 31+ days ago, then call the checker:

mongosh orderchop --eval "
  db.crm_contacts.insertOne({
    restaurantId: ObjectId('YOUR_RESTAURANT_ID'),
    customerId: ObjectId('SOME_CUSTOMER_ID'),
    lastOrderAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
    totalOrders: 3,
    lifecycleStatus: 'returning',
  })
"
```

Then restart with `ENABLE_SCHEDULERS=true` and watch for:
```
[InactivityChecker] Found N inactive contacts for flow "no-order-30-days"
[TriggerService] Enrolling contact ... into flow ...
```

### Graph Validation Examples

Test the 11 validation rules via the REST API:

**R-1: Exactly one trigger node required**
```bash
curl -X PUT http://localhost:3001/api/v1/flows/FLOW_ID \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"n1","type":"trigger","subType":"order_completed"},{"id":"n2","type":"trigger","subType":"first_order"}],"edges":[]}'
# → 422 { "error": "INVALID_GRAPH", "rule": "R-1", "message": "Exactly one trigger node required..." }
```

**R-4: Action nodes MAY have outgoing edges (action chaining and fan-out)**
```bash
# This is now VALID in v3 — action→action chaining is supported
curl -X PUT http://localhost:3001/api/v1/flows/FLOW_ID \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"t1","type":"trigger","subType":"order_completed"},{"id":"a1","type":"action","subType":"send_email"},{"id":"a2","type":"action","subType":"send_sms"}],"edges":[{"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"},{"id":"e2","sourceNodeId":"a1","targetNodeId":"a2"}]}'
# → 200 OK (action chaining is valid in v3)
```

**R-5: No cycles allowed**
A flow where node A → node B → node A would return 422 R-5.

**R-11: Fan-out constraint — max 10 outgoing edges per node**
```bash
# A node with 11+ outgoing edges is rejected
curl -X PUT http://localhost:3001/api/v1/flows/FLOW_ID \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"t1","type":"trigger","subType":"order_completed"},{"id":"a1","type":"action","subType":"send_email"},{"id":"a2","type":"action","subType":"send_email"},{"id":"a3","type":"action","subType":"send_email"},{"id":"a4","type":"action","subType":"send_email"},{"id":"a5","type":"action","subType":"send_email"},{"id":"a6","type":"action","subType":"send_email"},{"id":"a7","type":"action","subType":"send_email"},{"id":"a8","type":"action","subType":"send_email"},{"id":"a9","type":"action","subType":"send_email"},{"id":"a10","type":"action","subType":"send_email"},{"id":"a11","type":"action","subType":"send_email"}],"edges":[{"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"},{"id":"e2","sourceNodeId":"t1","targetNodeId":"a2"},{"id":"e3","sourceNodeId":"t1","targetNodeId":"a3"},{"id":"e4","sourceNodeId":"t1","targetNodeId":"a4"},{"id":"e5","sourceNodeId":"t1","targetNodeId":"a5"},{"id":"e6","sourceNodeId":"t1","targetNodeId":"a6"},{"id":"e7","sourceNodeId":"t1","targetNodeId":"a7"},{"id":"e8","sourceNodeId":"t1","targetNodeId":"a8"},{"id":"e9","sourceNodeId":"t1","targetNodeId":"a9"},{"id":"e10","sourceNodeId":"t1","targetNodeId":"a10"},{"id":"e11","sourceNodeId":"t1","targetNodeId":"a11"}]}'
# → 422 { "error": "INVALID_GRAPH", "rule": "R-11", "message": "Node t1 has 11 outgoing edges (max 10)" }
```

### 10.8 Action Chaining and Fan-Out

Test scenarios for v3 action chaining and parallel fan-out execution.

#### Action Chaining (email → sms)

**Step 1: Create a flow with chained actions**
```bash
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Action Chain Test",
    "description": "Test email → sms chain",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"order_completed","label":"Order Completed","config":{},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Thank You Email","config":{"recipients":[{"type":"customer"}],"subject":"Thanks {{customer.first_name}}!","body":"Your order #{{order.number}} is complete."},"position":{"x":100,"y":250}},
      {"id":"a2","type":"action","subType":"send_sms","label":"Follow-up SMS","config":{"recipient":{"type":"customer"},"body":"Thanks for ordering! -{{restaurant.name}}"},"position":{"x":100,"y":400}}
    ],
    "edges": [
      {"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"},
      {"id":"e2","sourceNodeId":"a1","targetNodeId":"a2"}
    ]
  }'
```

**Step 2: Activate the flow and trigger with an order.completed event**

**Step 3: Verify both actions executed in sequence**
```javascript
// Check execution logs — should show email first, then sms
db.crm_flow_execution_logs.find({ executionId: '<EXEC_ID>' }).sort({ executedAt: 1 })
// Expected: [{ nodeType: 'trigger', ... }, { nodeType: 'action', action: 'send_email', ... }, { nodeType: 'action', action: 'send_sms', ... }]
```

**Step 4: Verify execution completed**
```javascript
db.crm_flow_executions.findOne({ _id: ObjectId('<EXEC_ID>') })
// Expected: status='completed', completedNodes includes all 3 node IDs, pendingNodes=[]
```

#### Fan-Out (trigger → 3 parallel actions)

**Step 1: Create a flow with fan-out**
```bash
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fan-Out Test",
    "description": "Test trigger → 3 parallel actions",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"order_completed","label":"Order Completed","config":{},"position":{"x":250,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Customer Email","config":{"recipients":[{"type":"customer"}],"subject":"Order complete","body":"Thanks!"},"position":{"x":100,"y":300}},
      {"id":"a2","type":"action","subType":"send_email","label":"Restaurant Email","config":{"recipients":[{"type":"restaurant"}],"subject":"Order fulfilled","body":"Order complete."},"position":{"x":250,"y":300}},
      {"id":"a3","type":"action","subType":"send_sms","label":"Customer SMS","config":{"recipient":{"type":"customer"},"body":"Your order is ready!"},"position":{"x":400,"y":300}}
    ],
    "edges": [
      {"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"},
      {"id":"e2","sourceNodeId":"t1","targetNodeId":"a2"},
      {"id":"e3","sourceNodeId":"t1","targetNodeId":"a3"}
    ]
  }'
```

**Step 2: Activate and trigger — all 3 actions should execute via parallel Kafka events**

**Step 3: Verify parallel execution**
```javascript
// All 3 actions should appear in execution logs
db.crm_flow_execution_logs.find({ executionId: '<EXEC_ID>', nodeType: 'action' }).count()
// Expected: 3

// Execution should be completed with all nodes done
db.crm_flow_executions.findOne({ _id: ObjectId('<EXEC_ID>') })
// Expected: status='completed', completedNodes.length=4 (trigger + 3 actions), pendingNodes=[], erroredNodes=[]
```

#### Error Isolation in Fan-Out

If one parallel branch fails (e.g., invalid email config), sibling branches should still complete:

```javascript
// After triggering a fan-out where one action has bad config:
db.crm_flow_executions.findOne({ _id: ObjectId('<EXEC_ID>') })
// Expected: status='completed' (not 'error'), erroredNodes=['<failed_node_id>'], completedNodes includes the successful nodes
```

### 10.9 Item-Based Trigger Testing

#### item_ordered — Item Match + Modifier Match

**Step 1: Create a flow with item_ordered trigger**
```bash
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Item Ordered Test",
    "description": "Fires when customer orders a specific item",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"item_ordered","label":"Item Ordered","config":{"items":[{"menuItemId":"MENU_ITEM_ID","menuItemName":"Margherita Pizza","modifiers":[]}],"matchMode":"any"},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Item Promo Email","config":{"recipients":[{"type":"customer"}],"subject":"You ordered {{matched_item.name}}!","body":"We noticed you ordered {{matched_item.name}}. Here is a special offer!"},"position":{"x":100,"y":300}}
    ],
    "edges": [
      {"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"}
    ]
  }'
```

**Step 2: Activate the flow**

**Step 3: Simulate an order.completed event for an order that contains the configured menu item**

**Step 4: Verify trigger fired**
```javascript
// Flow execution should exist for this order
db.crm_flow_executions.findOne({ flowId: ObjectId('<FLOW_ID>'), 'context.orderId': '<ORDER_ID>' })
// Expected: status='completed'
```

**Step 5: Test with modifier matching**

Create a flow where the trigger config includes modifiers:
```json
{
  "items": [{
    "menuItemId": "MENU_ITEM_ID",
    "menuItemName": "Burger",
    "modifiers": [{
      "optionName": "Size",
      "choiceNames": ["Large"]
    }]
  }],
  "matchMode": "any"
}
```

- An order with the Burger item + Size=Large → trigger fires ✅
- An order with the Burger item + Size=Small → trigger does NOT fire ✗
- An order with the Burger item + no Size option → trigger does NOT fire ✗ (modifiers specified means they must match)

**Step 6: Test matchMode 'all'**

Create a config with 2 items and `matchMode: 'all'`:
- An order containing BOTH items → trigger fires ✅
- An order containing only one item → trigger does NOT fire ✗

#### item_ordered_x_times — Cumulative Count Threshold

**Step 1: Create a flow with item_ordered_x_times trigger (once mode — default)**
```bash
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Loyalty Item Test (Once)",
    "description": "Fires once on 3rd order of a specific item",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"item_ordered_x_times","label":"Item Ordered 3 Times","config":{"items":[{"menuItemId":"MENU_ITEM_ID","menuItemName":"Margherita Pizza","modifiers":[]}],"matchMode":"any","threshold":3},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Loyalty Reward","config":{"recipients":[{"type":"customer"}],"subject":"Loyalty reward!","body":"You have ordered Margherita Pizza 3 times! Here is a discount."},"position":{"x":100,"y":300}}
    ],
    "edges": [
      {"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"}
    ]
  }'
```

**Step 2: Activate the flow** (sets `activatedAt` — counting starts from now)

**Step 3: Simulate 3 completed orders for the same customer containing the configured menu item**

**Step 4: Verify the trigger fires on the 3rd order (at-least threshold)**
```javascript
// Should have exactly 1 execution
db.crm_flow_executions.find({ flowId: ObjectId('<FLOW_ID>'), 'context.customerId': '<CUSTOMER_ID>' }).count()
// Expected: 1

// Achievement record should exist
db.crm_trigger_achievements.findOne({ flowId: ObjectId('<FLOW_ID>'), contactId: ObjectId('<CONTACT_ID>') })
// Expected: { count: 3, threshold: 3, resetCount: 0 }
```

**Step 5: Verify the 4th order does NOT re-fire** (once mode — achievement exists)
```javascript
// After a 4th order with the same item:
db.crm_flow_executions.find({ flowId: ObjectId('<FLOW_ID>'), 'context.customerId': '<CUSTOMER_ID>' }).count()
// Expected: still 1 (not 2)
```

#### item_ordered_x_times — Reset Mode

**Step 1: Create a flow with resetOnThreshold = true**
```bash
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Loyalty Item Test (Reset)",
    "description": "Fires every 3rd order of a specific item",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"item_ordered_x_times","label":"Every 3rd Pizza","config":{"items":[{"menuItemId":"MENU_ITEM_ID","menuItemName":"Margherita Pizza","modifiers":[]}],"matchMode":"any","threshold":3,"resetOnThreshold":true},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Repeat Reward","config":{"recipients":[{"type":"customer"}],"subject":"Another reward!","body":"You have ordered Margherita Pizza again! Here is a discount."},"position":{"x":100,"y":300}}
    ],
    "edges": [
      {"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"}
    ]
  }'
```

**Step 2: Activate the flow**

**Step 3: Simulate 3 orders → trigger fires**

**Step 4: Simulate 3 more orders → trigger fires again (counter reset)**
```javascript
// After 6 total orders:
db.crm_flow_executions.find({ flowId: ObjectId('<FLOW_ID>'), 'context.customerId': '<CUSTOMER_ID>' }).count()
// Expected: 2 (fired at 3rd and 6th)

// Achievement record should show resetCount
db.crm_trigger_achievements.find({ flowId: ObjectId('<FLOW_ID>'), contactId: ObjectId('<CONTACT_ID>') })
// Expected: 2 records — first with resetCount: 1, second with resetCount: 0
```

**Step 5: Verify counting query uses sinceDate**
```javascript
// The aggregation counts from flow.activatedAt (or last achievement for reset mode)
db.orders.aggregate([
  { $match: { restaurantId: ObjectId('REST_ID'), customerId: ObjectId('CUSTOMER_ID'), paymentStatus: 'paid', createdAt: { $gte: ISODate('ACTIVATED_AT') } } },
  { $unwind: '$items' },
  { $match: { 'items.menuItemId': ObjectId('MENU_ITEM_ID') } },
  { $count: 'total' }
])
```

### 10.10 Item Ordered with targetStatuses — Multi-Select Status Filtering

The `item_ordered` and `item_ordered_x_times` triggers support an optional `config.targetStatuses: string[]` array that restricts which order statuses the trigger fires on.

#### Setup: Create a flow with item_ordered + targetStatuses = ['delivered', 'completed']

```bash
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Item Ordered — Delivered/Completed Only",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"item_ordered","label":"Item Ordered","config":{"items":[{"menuItemId":"MENU_ITEM_ID","menuItemName":"Margherita Pizza","modifiers":[]}],"matchMode":"any","targetStatuses":["delivered","completed"]},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Item Promo","config":{"recipients":[{"type":"customer"}],"subject":"Thanks for the pizza!","body":"Enjoy your {{matched_item.name}}."},"position":{"x":100,"y":300}}
    ],
    "edges": [{"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"}]
  }'

# Activate the flow
curl -s -X POST http://localhost:3001/api/v1/flows/FLOW_ID/activate \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID"
```

#### Test A: Order status = 'ready' — trigger does NOT fire (not in targetStatuses)

Send an order.status_changed event with status `ready` for an order containing the configured menu item.

**Expected server logs:**
```
[TriggerService] targetStatuses mismatch {"configuredStatuses":["delivered","completed"],"actualStatus":"ready","reason":"targetStatuses mismatch"}
```

**Verify — no execution:**
```javascript
db.crm_flow_executions.find({ flowId: ObjectId('FLOW_ID'), 'context.orderId': 'ORDER_ID' }).count()
// Expected: 0
```

#### Test B: Order status = 'delivered' — trigger SHOULD fire

Send an order.status_changed event with status `delivered` for the same order.

**Expected:** Flow fires because `delivered` is in `targetStatuses`. The order is fetched from DB to verify items match, then the contact is enrolled.

**Verify — execution created:**
```javascript
db.crm_flow_executions.find({ flowId: ObjectId('FLOW_ID'), 'context.orderId': 'ORDER_ID' }).count()
// Expected: 1
```

#### Test C: Order status = 'completed' — trigger does NOT fire again (dedup)

Send an order.status_changed event with status `completed` for the same order.

**Expected:** Even though `completed` is in `targetStatuses`, `hasOrderBeenProcessedForFlow` blocks re-enrollment because the order was already enrolled in Test B.

**Verify — still exactly one execution:**
```javascript
db.crm_flow_executions.find({ flowId: ObjectId('FLOW_ID'), 'context.orderId': 'ORDER_ID' }).count()
// Expected: 1 (no duplicate)
```

#### Test D: Item Ordered with no targetStatuses — fires on first qualifying status

Create a flow with `"config": { "items": [...], "matchMode": "any" }` (no `targetStatuses`). The trigger fires on the first qualifying fulfillment status (ready, out_for_delivery, delivered, completed) via `processOrderAsCompleted`.

---

### 10.11 Order Status Changed — runOnce Toggle

The `order_status_changed` trigger supports `config.runOnce: boolean`. When true, the flow fires only the first time an order matches a selected status — subsequent matching status changes for the same order are blocked via `hasOrderBeenProcessedForFlow`.

#### Setup: Create two flows — one with runOnce=true, one with runOnce=false

```bash
# Flow A: runOnce=true — fires only once per order
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Status Changed — RunOnce ON",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"order_status_changed","label":"Status Changed","config":{"targetStatuses":["confirmed","ready"],"runOnce":true},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Status Email","config":{"recipients":[{"type":"customer"}],"subject":"Order update!","body":"Your order status changed."},"position":{"x":100,"y":300}}
    ],
    "edges": [{"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"}]
  }'

# Flow B: runOnce=false (or omitted) — fires on every matching status change
curl -X POST http://localhost:3001/api/v1/flows \
  -H "Authorization: Bearer TOKEN" -H "X-Restaurant-Id: REST_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Status Changed — RunOnce OFF",
    "nodes": [
      {"id":"t1","type":"trigger","subType":"order_status_changed","label":"Status Changed","config":{"targetStatuses":["confirmed","ready"],"runOnce":false},"position":{"x":100,"y":100}},
      {"id":"a1","type":"action","subType":"send_email","label":"Status Email","config":{"recipients":[{"type":"customer"}],"subject":"Order update!","body":"Your order status changed."},"position":{"x":100,"y":300}}
    ],
    "edges": [{"id":"e1","sourceNodeId":"t1","targetNodeId":"a1"}]
  }'

# Activate both flows
```

#### Test A: runOnce=true — fires on 'confirmed', does NOT fire again on 'ready'

```bash
# Status change to 'confirmed'
echo '{"eventType":"order.status_changed","restaurantId":"REST_ID","payload":{"orderId":"order-runonce-001","orderNumber":"ORD-RO1","customerId":"CUST_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":30.00,"paymentStatus":"paid","newStatus":"confirmed","previousStatus":"pending","status":"confirmed"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected:** Flow A fires — contact enrolled.

```bash
# Same order, status change to 'ready'
echo '{"eventType":"order.status_changed","restaurantId":"REST_ID","payload":{"orderId":"order-runonce-001","orderNumber":"ORD-RO1","customerId":"CUST_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":30.00,"paymentStatus":"paid","newStatus":"ready","previousStatus":"confirmed","status":"ready"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected server logs:**
```
[TriggerService] order_status_changed runOnce: order already processed {"flowId":"FLOW_A_ID","orderId":"order-runonce-001"}
```

**Verify — Flow A has exactly 1 execution for this order:**
```javascript
db.crm_flow_executions.find({ flowId: ObjectId('FLOW_A_ID'), 'context.orderId': 'order-runonce-001' }).count()
// Expected: 1
```

#### Test B: runOnce=false — fires on 'confirmed', fires AGAIN on 'ready'

Use a different orderId for Flow B testing. Send two status changes (confirmed, then ready).

**Verify — Flow B has 2 executions (one per matching status change):**
```javascript
db.crm_flow_executions.find({ flowId: ObjectId('FLOW_B_ID'), 'context.orderId': 'order-runonce-002' }).count()
// Expected: 2 (fires on each matching status change, assuming previous execution completed before the next)
```

**Note:** The `isContactEnrolled` anti-spam check may block the second enrollment if the first execution is still actively running. Wait for the first execution to complete before sending the second status change.

---

### 10.12 Payment Status Enforcement — Universal Guard

All order-related triggers require `paymentStatus` to be `'paid'` or `'succeeded'` in the event payload. This is a universal guard at the top of `TriggerService.checkTriggerConditions()`.

#### Test A: Unpaid order — no order-related triggers fire

```bash
# Order completed event with paymentStatus='pending' (NOT paid)
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-unpaid-001","orderNumber":"ORD-UNPAID","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":30.00,"paymentStatus":"pending","newStatus":"confirmed","previousStatus":"pending","status":"confirmed"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected server logs:**
```
[TriggerService] Skipping trigger: payment not confirmed (paymentStatus=pending)
```

**Verify — no executions created for any order-related flow:**
```javascript
db.crm_flow_executions.find({
  restaurantId: ObjectId("YOUR_RESTAURANT_ID"),
  "context.orderId": "order-unpaid-001"
}).count()
// Expected: 0
```

#### Test B: Paid order — triggers fire normally

```bash
# Same order, now with paymentStatus='paid'
echo '{"eventType":"order.status_changed","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-paid-001","orderNumber":"ORD-PAID","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","customerPhone":"+15551234567","orderType":"delivery","orderTotal":30.00,"paymentStatus":"paid","newStatus":"confirmed","previousStatus":"pending","status":"confirmed"}}' | kcat -b localhost:9092 -t orderchop.orders -P
```

**Expected:** The payment guard passes, and any matching active flows evaluate their trigger conditions normally.

#### Test C: Stripe 'succeeded' status — accepted as paid

```bash
# Payment event with paymentStatus='succeeded' (Stripe format)
echo '{"eventType":"payment.succeeded","restaurantId":"YOUR_RESTAURANT_ID","payload":{"orderId":"order-stripe-001","orderNumber":"ORD-STRIPE","customerId":"YOUR_CUSTOMER_ID","customerEmail":"test@example.com","customerName":"Test User","orderTotal":30.00,"paymentStatus":"succeeded","paymentMethod":"card"}}' | kcat -b localhost:9092 -t orderchop.payments -P
```

**Expected:** The payment guard accepts `'succeeded'` — any matching `new_order` flows evaluate normally.

#### Test D: Abandoned cart — exempt from payment guard

The `abandoned_cart` trigger is exempt from the payment guard (it inherently targets unpaid orders). See section 10.7 for abandoned cart testing — the `paymentStatus` field is not checked for this trigger type.

#### Test E: no_order_in_x_days — exempt from payment guard

The `no_order_in_x_days` trigger is cron-based and has no order context in its payload. It is exempt from the payment guard. See the "Testing no_order_in_x_days Cron" troubleshooting section for testing instructions.

---

### Running Unit Tests

```bash
# Run all tests
npx vitest run

# Run specific test file
npx vitest run tests/unit/api/validators.test.ts

# Run tests in watch mode
npx vitest
```
