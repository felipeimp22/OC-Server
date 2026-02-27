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
10. [Troubleshooting](#10-troubleshooting)

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
| `orderchop.orders`    | Incoming  | `order.completed`, `order.cancelled`, `order.status_changed` |
| `orderchop.payments`  | Incoming  | `payment.completed`, `payment.failed` |
| `orderchop.customers` | Incoming  | `customer.created`, `customer.updated` |
| `orderchop.carts`     | Incoming  | `cart.abandoned` |
| `crm.flow.execute`    | Internal  | `flow.step.execute`, `flow.enrollment.start` |
| `crm.flow.timer`      | Internal  | `flow.timer.fire` |
| `crm.contacts`        | Internal  | `contact.tag_applied`, `contact.field_changed` |
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

3. **Create a simple flow** (order completed → apply tag → stop):
   ```
   POST /api/v1/flows
   {
     "name": "Test Pipeline Flow",
     "nodes": [
       { "id": "t1", "type": "trigger", "subType": "order_completed", "label": "Order", "config": {}, "position": {"x":0,"y":0} },
       { "id": "a1", "type": "action", "subType": "apply_tag", "label": "Tag", "config": { "tagId": "YOUR_TAG_ID" }, "position": {"x":0,"y":150} },
       { "id": "s1", "type": "logic", "subType": "stop", "label": "End", "config": {}, "position": {"x":0,"y":300} }
     ],
     "edges": [
       { "id": "e1", "sourceNodeId": "t1", "targetNodeId": "a1" },
       { "id": "e2", "sourceNodeId": "a1", "targetNodeId": "s1" }
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

## 10. Troubleshooting

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

### Running Unit Tests

```bash
# Run all tests
npx vitest run

# Run specific test file
npx vitest run tests/unit/api/validators.test.ts

# Run tests in watch mode
npx vitest
```
