# OrderChop CRM Automation Engine — Node.js Microservice

## Project Identity
- **Name**: `oc-crm-engine`
- **Role**: Event-driven CRM automation engine for the OrderChop restaurant SaaS platform
- **Architecture**: Node.js microservice that processes events from a Kafka message broker, executes automation flows, manages customer lifecycle, and handles scheduled/time-based triggers
- **AI-Assisted Development**: This project is built with AI-assisted development in mind. All files, folders, types, and interfaces must be thoroughly documented with JSDoc. Code must be self-explanatory. Prefer explicit types over inference. Each module should have a README.md explaining its purpose, inputs, outputs, and integration points.

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Runtime | Node.js | 20+ LTS |
| Language | TypeScript | 5.x (strict mode) |
| Message Broker | Apache Kafka (KafkaJS) | Latest |
| Database | MongoDB (Mongoose) | Match existing OrderChop DB |
| Scheduler | node-cron + Bull/BullMQ (Redis-backed) | Latest |
| HTTP Framework | Fastify | Latest |
| Validation | Zod | Latest |
| Logging | Pino | Latest |
| Testing | Vitest | Latest |

---

## Architecture: Service + Repository Pattern

```
oc-crm-engine/
├── src/
│   ├── index.ts                          # Application entry point
│   ├── config/
│   │   ├── env.ts                        # Environment variable schema (Zod-validated)
│   │   ├── kafka.ts                      # Kafka client configuration
│   │   ├── database.ts                   # MongoDB/Mongoose connection
│   │   ├── redis.ts                      # Redis connection for BullMQ
│   │   └── logger.ts                     # Pino logger configuration
│   │
│   ├── domain/                           # Domain models & types
│   │   ├── models/
│   │   │   ├── Contact.ts                # Contact (Customer) domain model
│   │   │   ├── Flow.ts                   # Automation flow model
│   │   │   ├── FlowNode.ts              # Individual flow step/node
│   │   │   ├── FlowExecution.ts         # Flow enrollment & execution state
│   │   │   ├── FlowExecutionLog.ts      # Step-level execution logs
│   │   │   ├── CommunicationTemplate.ts # Email/SMS templates
│   │   │   ├── CommunicationLog.ts      # Send logs (delivery, clicks, etc.)
│   │   │   ├── Tag.ts                   # Tag definitions per restaurant
│   │   │   ├── CustomField.ts           # Custom field definitions
│   │   │   ├── Campaign.ts             # Campaign tracking & attribution
│   │   │   └── ReviewRequest.ts        # Review request tracking
│   │   │
│   │   ├── enums/
│   │   │   ├── LifecycleStatus.ts       # lead, first_time, returning, lost, recovered, VIP
│   │   │   ├── FlowStatus.ts           # draft, active, paused, archived
│   │   │   ├── NodeType.ts             # trigger, action, condition, timer, logic
│   │   │   ├── TriggerType.ts          # order_completed, payment_failed, abandoned_cart, tag_applied, etc.
│   │   │   ├── ActionType.ts           # send_email, send_sms, apply_tag, update_field, webhook, meta_capi
│   │   │   ├── LogicType.ts            # yes_no, multi_branch, ab_split, loop, stop, until_condition
│   │   │   └── CommunicationChannel.ts # email, sms, push
│   │   │
│   │   └── interfaces/
│   │       ├── IEvent.ts                # Base event interface for Kafka messages
│   │       ├── IFlowEngine.ts           # Flow execution engine interface
│   │       ├── ICommunicationProvider.ts # Email/SMS provider interface (mirrors OrderChop's IEmailProvider)
│   │       └── IRepository.ts           # Generic repository interface
│   │
│   ├── repositories/                     # Data access layer
│   │   ├── base/
│   │   │   └── BaseRepository.ts        # Generic CRUD with Mongoose
│   │   ├── ContactRepository.ts
│   │   ├── FlowRepository.ts
│   │   ├── FlowExecutionRepository.ts
│   │   ├── TemplateRepository.ts
│   │   ├── CommunicationLogRepository.ts
│   │   ├── TagRepository.ts
│   │   └── CustomFieldRepository.ts
│   │
│   ├── services/                         # Business logic layer
│   │   ├── FlowEngineService.ts         # Core: executes flow nodes in sequence
│   │   ├── ContactService.ts            # Contact CRUD, lifecycle management, segmentation
│   │   ├── FlowService.ts              # Flow CRUD, activation, versioning
│   │   ├── TriggerService.ts           # Evaluates if a contact should enter a flow
│   │   ├── ConditionService.ts         # Evaluates yes/no, multi-branch, A/B conditions
│   │   ├── ActionService.ts            # Executes actions (send email, apply tag, etc.)
│   │   ├── TimerService.ts            # Manages delays, date timers, field-based timers
│   │   ├── SegmentationService.ts     # Auto-segmentation rules (VIP, at-risk, lost, etc.)
│   │   ├── TemplateService.ts         # Template CRUD, variable interpolation
│   │   ├── CommunicationService.ts    # Send emails/SMS via provider factories
│   │   ├── ReviewRequestService.ts    # System-owned review request automation
│   │   ├── CampaignService.ts         # Campaign tracking & revenue attribution
│   │   ├── AnalyticsService.ts        # Flow analytics, messaging stats, customer metrics
│   │   └── WebhookService.ts          # Outgoing webhooks (POST to external)
│   │
│   ├── factories/                        # Provider factories (mirrors OrderChop pattern)
│   │   ├── EmailProviderFactory.ts      # Singleton factory → Mailgun, SendGrid, etc.
│   │   ├── SMSProviderFactory.ts        # Singleton factory → Twilio, MessageBird, etc.
│   │   └── MetaProviderFactory.ts       # Meta Pixel / CAPI event sender
│   │
│   ├── providers/                        # Concrete provider implementations
│   │   ├── email/
│   │   │   ├── MailgunProvider.ts
│   │   │   └── SendGridProvider.ts
│   │   ├── sms/
│   │   │   ├── TwilioProvider.ts
│   │   │   └── MessageBirdProvider.ts
│   │   └── meta/
│   │       └── MetaCAPIProvider.ts
│   │
│   ├── kafka/                            # Kafka consumers & producers
│   │   ├── KafkaClient.ts              # Shared Kafka client singleton
│   │   ├── producers/
│   │   │   ├── CRMEventProducer.ts     # Produces events FROM the CRM (email sent, tag applied)
│   │   │   └── FlowEventProducer.ts    # Produces flow execution events
│   │   ├── consumers/
│   │   │   ├── OrderEventConsumer.ts   # Consumes: order.completed, order.status_changed, payment.failed
│   │   │   ├── CustomerEventConsumer.ts # Consumes: customer.created, customer.updated
│   │   │   ├── CartEventConsumer.ts    # Consumes: cart.abandoned
│   │   │   └── CRMEventConsumer.ts     # Consumes: tag.applied, field.changed, link.clicked
│   │   └── topics.ts                   # All Kafka topic name constants
│   │
│   ├── schedulers/                       # Time-based job processing
│   │   ├── FlowTimerProcessor.ts       # BullMQ worker: processes delayed flow steps
│   │   ├── InactivityChecker.ts        # Cron: checks "no order in X days" conditions
│   │   ├── LifecycleUpdater.ts         # Cron: updates contact lifecycle status
│   │   ├── ReviewRequestScheduler.ts   # Cron: fires scheduled review requests
│   │   └── DateFieldTrigger.ts         # Cron: checks date field conditions (birthday, anniversary)
│   │
│   ├── api/                              # Fastify HTTP routes (called by Next.js frontend)
│   │   ├── routes/
│   │   │   ├── flows.routes.ts         # CRUD for flows, activate/pause, enrollment stats
│   │   │   ├── contacts.routes.ts      # Contact management, timeline, segmentation
│   │   │   ├── templates.routes.ts     # Email/SMS template CRUD
│   │   │   ├── tags.routes.ts          # Tag CRUD
│   │   │   ├── custom-fields.routes.ts # Custom field management
│   │   │   ├── analytics.routes.ts     # Flow analytics, messaging stats
│   │   │   ├── campaigns.routes.ts     # Campaign tracking
│   │   │   └── system.routes.ts        # Health check, Kafka status
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts      # Validates JWT from OrderChop (shared secret)
│   │   │   └── tenancy.middleware.ts   # Extracts restaurantId, enforces isolation
│   │   └── validators/
│   │       ├── flow.validators.ts      # Zod schemas for flow API
│   │       ├── contact.validators.ts   # Zod schemas for contact API
│   │       └── template.validators.ts  # Zod schemas for template API
│   │
│   └── utils/
│       ├── variableInterpolator.ts     # Replaces {{first_name}}, {{restaurant_name}}, etc.
│       ├── timezoneHelper.ts           # Timezone-aware scheduling (uses restaurant timezone)
│       ├── idempotency.ts             # Idempotent event processing guards
│       ├── antiSpam.ts                # Cooldown rules for review requests, messaging limits
│       └── retryHelper.ts            # Exponential backoff for failed actions
│
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   ├── repositories/
│   │   └── utils/
│   ├── integration/
│   │   ├── kafka/
│   │   └── api/
│   └── fixtures/
│       ├── flows.fixture.ts
│       └── contacts.fixture.ts
│
├── docker-compose.yml                    # Kafka + Zookeeper + Redis + MongoDB (dev)
├── Dockerfile
├── .env.example
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── README.md
```

---

## Shared Database (MongoDB) — Same instance as OrderChop

This microservice connects to the SAME MongoDB database as the OrderChop Next.js app. It reads existing collections (restaurants, orders, customers) and writes to new CRM-specific collections.

### Existing Collections the CRM Engine READS (owned by OrderChop Next.js)

The OrderChop app uses Prisma with MongoDB. The CRM engine reads these collections via Mongoose (read-only access):

**Restaurant** — identity, branding, timezone, review URL
- Key fields: `name`, `phone`, `email`, `logo`, `primaryColor`, `secondaryColor`, `accentColor`, address fields, `isOpen`, `isPublished`
- The CRM needs: name (for templates), timezone (for scheduling), branding (for emails)

**Customer** — basic customer data, scoped per restaurant
- Key fields: `restaurantId`, `name`, `email`, `phone` (Json: `{countryCode, number}`), `address` (Json), `tags[]`, `notes`
- Unique constraint: `[restaurantId, email]`
- The CRM syncs FROM this into `crm_contacts`

**Order** — order history and revenue data
- Key fields: `restaurantId`, `customerId`, `orderNumber`, `customerName`, `customerEmail`, `customerPhone`, `orderType` (pickup/delivery/dine_in), `status`, `paymentStatus`, `subtotal`, `tax`, `tip`, `deliveryFee`, `total`, `createdAt`
- Payment statuses: pending, paid, failed, refunded, partially_refunded
- Order statuses: pending, confirmed, preparing, ready, out_for_delivery, delivered, completed, cancelled

**StoreHours** — restaurant timezone for scheduling
- Key field: `timezone` (e.g., "America/New_York")

**FinancialSettings** — currency for formatting
- Key field: `currency` (e.g., "USD", "BRL")

### New Collections (CRM Engine owns these)

#### `crm_contacts` (extends the existing Customer model with CRM-specific fields)

This collection mirrors and extends the existing Customer model. On every `customer.created` or `order.completed` event, the CRM engine syncs data from the main Customer + Order collections into `crm_contacts`. The existing Customer model in the Next.js app remains the source of truth for basic customer data. The CRM contact is an enriched view.

```
- _id: ObjectId
- restaurantId: ObjectId (ref → Restaurant)
- customerId: ObjectId (ref → existing Customer collection)
- email: string
- phone: { countryCode: string, number: string }
- firstName: string
- lastName: string
- emailOptIn: boolean
- emailOptInAt: Date | null
- smsOptIn: boolean
- smsOptInAt: Date | null
- lifecycleStatus: enum (lead | first_time | returning | lost | recovered | VIP)
- tags: ObjectId[] (ref → crm_tags)
- customFields: Record<string, any> (flexible key-value per restaurant's custom field schema)
- lastOrderAt: Date | null
- totalOrders: number (denormalized, updated on order events)
- lifetimeValue: number (denormalized)
- averageOrderValue: number (denormalized)
- lastReviewRequestAt: Date | null
- source: string | null (QR, campaign, direct, etc.)
- createdAt: Date
- updatedAt: Date
- Indexes: [restaurantId, email] unique, [restaurantId, lifecycleStatus], [restaurantId, lastOrderAt], [restaurantId, tags]
```

#### `crm_tags`
```
- _id: ObjectId
- restaurantId: ObjectId
- name: string
- description: string | null
- color: string | null
- isSystem: boolean (true for auto-generated tags like "VIP", "lost")
- contactCount: number (denormalized)
- createdAt: Date
- Indexes: [restaurantId, name] unique
```

#### `crm_custom_fields`
```
- _id: ObjectId
- restaurantId: ObjectId
- name: string
- key: string (slug)
- fieldType: enum (text | number | date | dropdown | checkbox)
- options: string[] (for dropdown type)
- isRequired: boolean
- order: number
- createdAt: Date
- Indexes: [restaurantId, key] unique
```

#### `crm_flows`
```
- _id: ObjectId
- restaurantId: ObjectId
- name: string
- description: string | null
- status: enum (draft | active | paused | archived)
- isSystem: boolean (true for review request flow — cannot be deleted)
- version: number
- nodes: FlowNode[] (embedded array — the flow definition)
- edges: FlowEdge[] (embedded array — connections between nodes)
- stats: { enrollments: number, completions: number, activeEnrollments: number }
- createdAt: Date
- updatedAt: Date
- Indexes: [restaurantId, status], [restaurantId, isSystem]
```

#### FlowNode (embedded in crm_flows.nodes)
```
- id: string (uuid — unique within the flow)
- type: enum (trigger | action | condition | timer | logic)
- subType: string (e.g., "order_completed", "send_email", "yes_no_branch", "delay")
- label: string
- position: { x: number, y: number } (canvas coordinates for the UI)
- config: Record<string, any> (type-specific configuration)
  Examples:
  trigger.order_completed: { orderTypes: ["delivery", "pickup"] }
  action.send_email: { templateId: ObjectId, subject: string }
  action.send_sms: { templateId: ObjectId }
  action.apply_tag: { tagId: ObjectId }
  action.update_field: { fieldKey: string, value: any }
  action.outgoing_webhook: { url: string, method: "POST", headers: {}, body: {} }
  condition.yes_no: { field: string, operator: "eq"|"gt"|"lt"|"contains"|"exists", value: any }
  condition.ab_split: { distribution: [50, 50] }
  timer.delay: { duration: number, unit: "minutes"|"hours"|"days" }
  timer.date: { dateField: string, offsetDays: number }
  timer.advanced: { delay: number, unit: string, weekdays: number[], time: string, timezone: string }
  logic.stop: {}
  logic.loop: { maxIterations: number }
```

#### FlowEdge (embedded in crm_flows.edges)
```
- id: string (uuid)
- sourceNodeId: string (ref → FlowNode.id)
- targetNodeId: string (ref → FlowNode.id)
- sourceHandle: string | null (e.g., "yes", "no", "branch_0", "default")
- label: string | null
```

#### `crm_flow_executions` (enrollment records)
```
- _id: ObjectId
- flowId: ObjectId (ref → crm_flows)
- restaurantId: ObjectId
- contactId: ObjectId (ref → crm_contacts)
- status: enum (active | completed | stopped | error)
- currentNodeId: string | null (which node the contact is currently at)
- startedAt: Date
- completedAt: Date | null
- nextExecutionAt: Date | null (for timer steps — when to resume)
- context: Record<string, any> (runtime variables: order data, branch results, etc.)
- Indexes: [flowId, status], [contactId, flowId], [nextExecutionAt] (for timer processing)
```

#### `crm_flow_execution_logs` (step-level audit trail)
```
- _id: ObjectId
- executionId: ObjectId (ref → crm_flow_executions)
- flowId: ObjectId
- restaurantId: ObjectId
- contactId: ObjectId
- nodeId: string
- nodeType: string
- action: string (what happened)
- result: enum (success | failure | skipped)
- error: string | null
- metadata: Record<string, any>
- executedAt: Date
- Indexes: [executionId], [flowId, nodeId] (for step-level analytics)
```

#### `crm_communication_templates`
```
- _id: ObjectId
- restaurantId: ObjectId
- channel: enum (email | sms)
- name: string
- subject: string | null (email only)
- body: string (HTML for email, plain text for SMS — supports {{variable}} interpolation)
- isSystem: boolean
- variables: string[] (list of available variables: first_name, restaurant_name, order_total, review_link, promo_code, etc.)
- createdAt: Date
- updatedAt: Date
- Indexes: [restaurantId, channel]
```

#### `crm_communication_logs`
```
- _id: ObjectId
- restaurantId: ObjectId
- contactId: ObjectId
- channel: enum (email | sms)
- templateId: ObjectId | null
- flowId: ObjectId | null
- executionId: ObjectId | null
- to: string
- subject: string | null
- status: enum (queued | sent | delivered | opened | clicked | bounced | failed | unsubscribed)
- providerMessageId: string | null
- metadata: Record<string, any>
- sentAt: Date
- deliveredAt: Date | null
- openedAt: Date | null
- clickedAt: Date | null
- Indexes: [contactId], [flowId], [restaurantId, status], [restaurantId, sentAt]
```

#### `crm_link_tracking`
```
- _id: ObjectId
- communicationLogId: ObjectId
- originalUrl: string
- trackingUrl: string (generated short URL)
- clickCount: number
- lastClickedAt: Date | null
- contactId: ObjectId
- Indexes: [trackingUrl] unique
```

#### `crm_review_requests` (tracking the mandatory review request system)
```
- _id: ObjectId
- restaurantId: ObjectId
- contactId: ObjectId
- orderId: ObjectId (ref → existing Order collection)
- channel: enum (email | sms)
- status: enum (scheduled | sent | clicked | expired)
- scheduledAt: Date
- sentAt: Date | null
- clickedAt: Date | null
- reviewUrl: string
- Indexes: [restaurantId, contactId, orderId] unique (one per order), [restaurantId, status]
```

---

## Kafka Topics

Events flow in two directions:

### Incoming (produced by OrderChop Next.js → consumed by CRM Engine)

| Topic | Events | Producer Location in OrderChop |
|-------|--------|-------------------------------|
| `orderchop.orders` | `order.created`, `order.confirmed`, `order.completed`, `order.cancelled`, `order.status_changed` | Stripe webhook handler (`app/api/webhooks/stripe/route.ts`), kitchen actions (`lib/serverActions/kitchen.actions.ts`) |
| `orderchop.payments` | `payment.succeeded`, `payment.failed`, `payment.refunded` | Stripe webhook handler |
| `orderchop.customers` | `customer.created`, `customer.updated` | `lib/serverActions/customer.actions.ts` |
| `orderchop.carts` | `cart.abandoned` | Store/checkout (new — needs client-side implementation in Next.js) |

### Internal (produced & consumed within CRM Engine)

| Topic | Events | Purpose |
|-------|--------|---------|
| `crm.flow.execute` | `flow.step.ready` | Trigger next step in a flow |
| `crm.flow.timer` | `flow.timer.expired` | Timer step completed, resume flow |
| `crm.communications` | `email.send`, `sms.send`, `email.delivered`, `sms.delivered`, `link.clicked` | Communication processing |
| `crm.contacts` | `contact.tag_applied`, `contact.tag_removed`, `contact.field_changed`, `contact.lifecycle_changed` | CRM-internal events that can trigger other flows |

### Outgoing (produced by CRM Engine → consumed by OrderChop Next.js)

| Topic | Events | Consumer Location |
|-------|--------|-------------------|
| `crm.notifications` | `crm.review_sent`, `crm.email_sent`, `crm.flow.completed` | Next.js API route or webhook |

---

## Flow Engine — Core Processing Logic

The flow engine is the heart of the system. It processes a flow as a directed acyclic graph (DAG) where nodes are connected by edges.

### Flow Execution Algorithm

```
1. EVENT arrives (e.g., order.completed)

2. TRIGGER EVALUATION:
   - Find all ACTIVE flows with trigger nodes matching this event type
   - For each flow, check if the contact matches the trigger's conditions
   - Check anti-spam: is the contact already enrolled in this flow?
   - If all checks pass → CREATE FlowExecution record (status: active)

3. NODE PROCESSING (recursive):
   - Get current node from execution record
   - Based on node type:

     TRIGGER: Log trigger fired → advance to next node

     ACTION:
       - send_email → interpolate template → enqueue via CommunicationService
       - send_sms → interpolate template → enqueue via CommunicationService
       - apply_tag → update contact tags → emit contact.tag_applied event
       - remove_tag → update contact tags → emit contact.tag_removed event
       - update_field → update contact custom field → emit contact.field_changed
       - add_note → add note to contact timeline
       - create_task → create task record
       - outgoing_webhook → POST to configured URL with contact/order context
       - meta_capi → send conversion event to Meta
       - admin_notification → send email/SMS to restaurant owner/manager
       → Log execution → advance to next node

     CONDITION (yes/no):
       - Evaluate condition against contact data
       - Follow "yes" or "no" edge based on result
       → Log evaluation result → advance to appropriate node

     CONDITION (multi-branch):
       - Evaluate multiple conditions
       - Follow the first matching branch (or default)
       → Log → advance

     CONDITION (A/B split):
       - Random distribution based on configured percentages
       → Log split assignment → advance

     TIMER (delay):
       - Calculate target datetime (now + delay)
       - Update execution: nextExecutionAt = target, currentNodeId stays
       - Schedule BullMQ delayed job
       - STOP processing (will resume when job fires)

     TIMER (date):
       - Calculate target from contact's date field + offset
       - Same as delay but date-based

     TIMER (advanced):
       - Calculate next valid datetime considering weekdays + time + timezone
       - Schedule accordingly

     LOGIC (stop): Mark execution as completed
     LOGIC (loop): Re-enter the loop body (with iteration counter)
     LOGIC (until_condition): Check condition, if met → advance, else → loop back

4. ADVANCE TO NEXT NODE:
   - Find outgoing edge from current node (filtered by handle if branching)
   - If no outgoing edge → mark execution as completed
   - If next node exists → update currentNodeId → produce `flow.step.ready` to Kafka
   - Kafka consumer picks up → go to step 3
```

### Timer Processing (BullMQ)
```
- FlowTimerProcessor is a BullMQ worker
- When a timer job fires:
  1. Load the FlowExecution
  2. Verify it's still "active" (not stopped/completed)
  3. Advance to the next node after the timer
  4. Produce `flow.step.ready` event
```

### Scheduled Jobs (node-cron)
```
- InactivityChecker: every hour
  - For each active flow with "no_order_in_x_days" trigger:
    - Query contacts where lastOrderAt < (now - X days)
    - Enroll matching contacts who aren't already in the flow

- LifecycleUpdater: every 6 hours
  - Recalculate lifecycle_status for all contacts based on rules:
    - No orders → "lead"
    - 1 order → "first_time"
    - 2+ orders in last 90 days → "returning"
    - No order in 60+ days (was returning) → "lost"
    - Was "lost", ordered again → "recovered"
    - Lifetime value > threshold OR orders > threshold → "VIP"

- DateFieldTrigger: daily at midnight (per restaurant timezone)
  - Check contacts with date fields matching today (birthday, anniversary)
  - Enroll in matching flows

- ReviewRequestScheduler: every 5 minutes
  - Check for review requests with scheduledAt <= now AND status = "scheduled"
  - Process and send
```

---

## System-Owned Review Request Flow

This flow is mandatory, non-deletable, and enabled by default for every restaurant.

"Every completed order must trigger a default, opt-in-aware review request via SMS or email. This automation is system-owned, enabled by default, and cannot be deleted."

### Default Configuration
```json
{
  "isSystem": true,
  "name": "Post-Order Review Request",
  "nodes": [
    {
      "id": "trigger_1",
      "type": "trigger",
      "subType": "order_completed",
      "config": { "orderTypes": ["delivery", "pickup", "dine_in"] }
    },
    {
      "id": "timer_1",
      "type": "timer",
      "subType": "delay",
      "config": { "duration": 45, "unit": "minutes" }
    },
    {
      "id": "condition_1",
      "type": "condition",
      "subType": "yes_no",
      "config": {
        "field": "smsOptIn",
        "operator": "eq",
        "value": true
      }
    },
    {
      "id": "action_sms",
      "type": "action",
      "subType": "send_sms",
      "config": {
        "templateId": "system_review_sms",
        "body": "Hey {{first_name}} 👋 Thanks for ordering from {{restaurant_name}}! If you enjoyed your meal, we'd really appreciate a quick review: {{review_link}}"
      }
    },
    {
      "id": "condition_2",
      "type": "condition",
      "subType": "yes_no",
      "config": {
        "field": "emailOptIn",
        "operator": "eq",
        "value": true
      }
    },
    {
      "id": "action_email",
      "type": "action",
      "subType": "send_email",
      "config": {
        "templateId": "system_review_email",
        "subject": "How was your order from {{restaurant_name}}?"
      }
    },
    {
      "id": "stop_1",
      "type": "logic",
      "subType": "stop",
      "config": {}
    }
  ],
  "edges": [
    { "sourceNodeId": "trigger_1", "targetNodeId": "timer_1" },
    { "sourceNodeId": "timer_1", "targetNodeId": "condition_1" },
    { "sourceNodeId": "condition_1", "targetNodeId": "action_sms", "sourceHandle": "yes" },
    { "sourceNodeId": "condition_1", "targetNodeId": "condition_2", "sourceHandle": "no" },
    { "sourceNodeId": "action_sms", "targetNodeId": "stop_1" },
    { "sourceNodeId": "condition_2", "targetNodeId": "action_email", "sourceHandle": "yes" },
    { "sourceNodeId": "condition_2", "targetNodeId": "stop_1", "sourceHandle": "no" },
    { "sourceNodeId": "action_email", "targetNodeId": "stop_1" }
  ]
}
```

### Anti-Spam Rules (configurable per restaurant)
- One review request per order (enforced by unique index on `[restaurantId, contactId, orderId]`)
- Cooldown: do not send if review request sent in last X days (default: 7)
- Optional minimum order value filter
- Optional first-time-only or every-order toggle

---

## Default Flow Templates

Ship these as pre-built templates restaurants can activate with one click:

1. **Post-Order Nurture**: Order completed → delay 24h → email thank-you → delay 7d → email "order again" promo
2. **Abandoned Cart Recovery**: Cart abandoned → delay 1h → email reminder → condition: ordered? → yes: stop → no: delay 24h → email with promo code
3. **45-Day Reactivation**: No order in 45 days → email "we miss you" + offer → delay 7d → condition: ordered? → yes: tag "recovered" → no: tag "lost"
4. **Lost Customer Tagging**: No order in 60 days → apply tag "lost" → update lifecycle to "lost"
5. **Recovered Customer Flow**: Tag "recovered" applied → email welcome back → remove tag "lost"
6. **VIP Milestone**: Total orders = 10 → apply tag "VIP" → email VIP welcome → update lifecycle to "VIP"
7. **Birthday Offer**: Birthday date field = today → email birthday offer
8. **Review Request**: (system-owned — see above)

---

## API Endpoints (Fastify)

All endpoints require `Authorization: Bearer <jwt>` and `X-Restaurant-Id: <restaurantId>`.

### Flows
```
GET    /api/v1/flows                    → List flows (with stats)
GET    /api/v1/flows/:id                → Get flow detail (nodes, edges, stats)
POST   /api/v1/flows                    → Create flow
PUT    /api/v1/flows/:id                → Update flow (nodes, edges, name)
DELETE /api/v1/flows/:id                → Delete flow (not system flows)
POST   /api/v1/flows/:id/activate       → Activate flow
POST   /api/v1/flows/:id/pause          → Pause flow
GET    /api/v1/flows/:id/executions     → List enrollments for a flow
GET    /api/v1/flows/:id/analytics      → Step-level conversion rates, timing stats
POST   /api/v1/flows/templates          → Create flow from template
GET    /api/v1/flows/templates/list      → List available templates
```

### Contacts
```
GET    /api/v1/contacts                 → List contacts (filterable, paginated)
GET    /api/v1/contacts/:id             → Contact detail (with timeline)
PUT    /api/v1/contacts/:id             → Update contact
GET    /api/v1/contacts/:id/timeline    → Activity timeline
POST   /api/v1/contacts/:id/tags        → Apply tags
DELETE /api/v1/contacts/:id/tags/:tagId → Remove tag
POST   /api/v1/contacts/:id/notes       → Add note
GET    /api/v1/contacts/segments        → Get segment counts
```

### Templates
```
GET    /api/v1/templates                → List templates
POST   /api/v1/templates                → Create template
PUT    /api/v1/templates/:id            → Update template
DELETE /api/v1/templates/:id            → Delete template
POST   /api/v1/templates/:id/preview    → Preview with sample data
```

### Tags
```
GET    /api/v1/tags                     → List tags with counts
POST   /api/v1/tags                     → Create tag
PUT    /api/v1/tags/:id                 → Update tag
DELETE /api/v1/tags/:id                 → Delete tag (not system tags)
```

### Custom Fields
```
GET    /api/v1/custom-fields            → List custom fields
POST   /api/v1/custom-fields            → Create custom field
PUT    /api/v1/custom-fields/:id        → Update custom field
DELETE /api/v1/custom-fields/:id        → Delete custom field
```

### Analytics
```
GET    /api/v1/analytics/overview       → Dashboard: new vs returning, lost vs recovered, review stats
GET    /api/v1/analytics/flows/:id      → Per-flow analytics
GET    /api/v1/analytics/messaging      → Email/SMS delivery, open, click rates
GET    /api/v1/analytics/campaigns      → Revenue attribution per campaign
```

### System
```
GET    /api/v1/health                   → Health check
GET    /api/v1/system/kafka-status      → Kafka connection status
POST   /api/v1/system/sync-contacts     → Force sync contacts from OrderChop Customer collection
```

---

## Integration with OrderChop Next.js App

### Event Publishing (Next.js → Kafka)

The OrderChop app needs minimal changes to publish events. Add a Kafka producer utility and call it from existing code:

1. **In Stripe webhook handler** (`app/api/webhooks/stripe/route.ts`):
   After `handlePaymentIntentSucceeded()` succeeds → produce `order.confirmed` and `payment.succeeded` events to Kafka

2. **In order.actions.ts** (`createOrder()`):
   After order creation → produce `order.created` event

3. **In customer.actions.ts** (`findOrCreateCustomer()`):
   When a NEW customer is created (not found via upsert) → produce `customer.created` event

4. **In kitchen.actions.ts** (order status updates):
   After status change → produce `order.status_changed` with old/new status
   When status changes to `completed` → also produce `order.completed`

### Authentication Between Services
- CRM engine validates JWTs issued by NextAuth
- Shared `AUTH_SECRET` between both apps
- `X-Restaurant-Id` header ensures tenant isolation
- All repository queries MUST include restaurantId filter

### Kafka Event Message Format
```typescript
interface CRMEvent {
  eventId: string;        // UUID for idempotency
  eventType: string;      // e.g., "order.completed"
  restaurantId: string;   // MongoDB ObjectId as string
  timestamp: string;      // ISO 8601
  payload: {
    orderId?: string;
    customerId?: string;
    customerEmail?: string;
    orderTotal?: number;
    orderType?: string;
    paymentStatus?: string;
    oldStatus?: string;
    newStatus?: string;
    [key: string]: unknown;
  };
}
```

---

## Non-Functional Requirements

1. **Multi-tenant isolation**: Every query MUST include `restaurantId` filter. Repository base class enforces this.
2. **Idempotent event processing**: Use event ID + consumer group offset tracking. Deduplicate using `crm_processed_events` collection.
3. **Queue-based execution**: All flow steps processed via Kafka (not synchronously). Enables retry, scaling, and monitoring.
4. **Full audit logs**: Every flow step execution logged in `crm_flow_execution_logs`.
5. **Timezone-correct scheduling**: All timer steps use restaurant's timezone (from `StoreHours.timezone`).
6. **Role-based permissions**: Inherited from OrderChop's `RolePermissions` — `marketing` permission controls CRM access.
7. **Graceful degradation**: If Kafka is down, events are buffered in MongoDB and retried. If email/SMS fails, retried with exponential backoff (max 3 attempts).
8. **Horizontal scaling**: Kafka consumer groups allow multiple CRM engine instances.

---

## Environment Variables (.env)

```
# Database (same as OrderChop)
MONGODB_URI=mongodb+srv://...

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=oc-crm-engine
KAFKA_CONSUMER_GROUP=crm-engine-group

# Redis (for BullMQ)
REDIS_URL=redis://localhost:6379

# Auth (shared with OrderChop)
AUTH_SECRET=same-as-orderchop-auth-secret

# Email (same provider as OrderChop or independent)
EMAIL_PROVIDER=mailgun
EMAIL_DOMAIN=go.orderchop.co
EMAIL_API_KEY=...

# SMS
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...

# Meta
META_PIXEL_ID=...
META_ACCESS_TOKEN=...

# Server
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
```

---

## AI-Assisted Development Setup

This project is designed for maximum AI productivity:

1. **Every file has JSDoc** at the top explaining purpose, dependencies, and integration points
2. **Every function has JSDoc** with @param, @returns, @throws, @example
3. **Every interface is thoroughly documented** with descriptions for each field
4. **README.md in every directory** explaining the module's role
5. **Zod schemas serve as living documentation** of API contracts
6. **Type-driven development**: Define types first, implement second
7. **Test fixtures** provide realistic sample data for AI to reference
8. **ARCHITECTURE.md** at root with system diagram and data flow
9. **CONVENTIONS.md** documenting all patterns, naming conventions, error handling
10. **INTEGRATION.md** documenting all touch points with OrderChop Next.js app

### Implementation Order (files to create first, in sequence):
1. `tsconfig.json` + `package.json` — project setup
2. `src/domain/` — all types, enums, interfaces
3. `src/config/` — environment and connections
4. `src/repositories/` — data access
5. `src/services/` — business logic
6. `src/kafka/` — event consumers/producers
7. `src/schedulers/` — cron and timer jobs
8. `src/api/` — HTTP routes
9. `tests/` — unit and integration tests
10. `docker-compose.yml` — local development environment
