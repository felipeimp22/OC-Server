# OrderChop CRM — Frontend Module (Next.js App Router)

> **v2 — Corrected to match the actual `oc-crm-engine` backend API**
>
> Changes from v1:
> - API base path corrected: `/api/v1/` (not `/api/`)
> - HTTP methods corrected: `PUT` for all updates (not `PATCH`)
> - Response shapes documented to match actual backend pagination wrapper `{ data, total, page, limit, totalPages, hasMore }`
> - `_id` field handling documented (Mongoose returns `_id`, frontend expects `id`)
> - Analytics overview response shape corrected to match `DashboardOverview`
> - Custom field types corrected: `'text' | 'number' | 'date' | 'dropdown' | 'checkbox'`
> - Added 4 missing triggers to NODE_PANEL_ITEMS (`task_completed`, `page_visited`, `sms_reply`, `form_submission`)
> - Added flow template endpoints (`GET /templates`, `POST /from-template`)
> - Removed `addContactNote()` (not a backend endpoint — notes are created by flow engine actions)

---

## Project Identity

- **Name**: `oc-restaurant-manager` (existing Next.js app)
- **Module**: CRM / Marketing tab within the restaurant dashboard
- **Route prefix**: `/[locale]/app/restaurant/[restaurantId]/crm/...`
- **Backend**: `oc-crm-engine` microservice running at `http://localhost:3001`
- **Stack**: Next.js 15 App Router, TypeScript strict, Tailwind CSS, Zustand, React Query, @dnd-kit/core, next-intl

---

## CRM Engine Backend API Reference

### Authentication

Every request to the CRM engine must include:

```
Authorization: Bearer <nextauth-jwt-token>
X-Restaurant-Id: <restaurantId>
```

The token is the same JWT issued by NextAuth in the main app. The CRM engine verifies it using the shared `AUTH_SECRET`.

### Base URL

```
CRM_ENGINE_URL=http://localhost:3001
```

All API routes are prefixed with `/api/v1/`.

### Standard Paginated Response Shape

All list endpoints return this standardized shape:

```typescript
interface PaginatedResponse<T> {
  data: T[];          // Array of items
  total: number;      // Total matching documents
  page: number;       // Current page (1-based)
  limit: number;      // Items per page
  totalPages: number; // Total pages
  hasMore: boolean;   // Whether more pages exist
}
```

**Query parameters** for pagination:

| Param  | Type   | Default | Description                    |
|--------|--------|---------|--------------------------------|
| page   | number | 1       | Page number (1-based)          |
| limit  | number | 20      | Items per page (max 100)       |
| sort   | string | —       | Field to sort by               |
| order  | string | desc    | Sort direction: `asc` or `desc` |

### `_id` → `id` Mapping

Mongoose returns `_id` (ObjectId). Your server actions must map `_id` → `id` when transforming responses for the frontend:

```typescript
function mapId<T extends { _id: string }>(doc: T): Omit<T, '_id'> & { id: string } {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}
```

---

## API Endpoints

### Flows — `/api/v1/flows`

| Method | Path                              | Description                          |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/api/v1/flows`                   | List flows (paginated)               |
| GET    | `/api/v1/flows/templates`         | List flow templates (static catalog) |
| POST   | `/api/v1/flows/from-template`     | Create flow from a template          |
| GET    | `/api/v1/flows/:id`               | Get flow by ID                       |
| POST   | `/api/v1/flows`                   | Create flow                          |
| PUT    | `/api/v1/flows/:id`               | Update flow (name, nodes, edges)     |
| DELETE | `/api/v1/flows/:id`               | Delete flow                          |
| POST   | `/api/v1/flows/:id/activate`      | Activate flow                        |
| POST   | `/api/v1/flows/:id/pause`         | Pause flow                           |
| GET    | `/api/v1/flows/:id/executions`    | List flow enrollments (paginated)    |
| GET    | `/api/v1/flows/:id/analytics`     | Per-node analytics for flow          |

**Create flow body:**
```json
{
  "name": "My Flow",
  "description": "Optional description",
  "nodes": [
    {
      "id": "uuid-string",
      "type": "trigger",
      "subType": "order_completed",
      "label": "Order Completed",
      "config": { "orderTypes": ["delivery", "pickup"] },
      "position": { "x": 100, "y": 200 }
    }
  ],
  "edges": [
    {
      "id": "uuid-string",
      "sourceNodeId": "node-1",
      "targetNodeId": "node-2",
      "sourceHandle": "yes"
    }
  ]
}
```

**Create from template body:**
```json
{
  "templateKey": "template_0",
  "name": "Optional custom name"
}
```

**Flow template response item:**
```json
{
  "key": "template_0",
  "name": "Post-Order Nurture",
  "description": "Thank customers after an order...",
  "nodeCount": 6,
  "edgeCount": 5
}
```

### Contacts — `/api/v1/contacts`

| Method | Path                                    | Description                          |
|--------|-----------------------------------------|--------------------------------------|
| GET    | `/api/v1/contacts`                      | List contacts (paginated)            |
| GET    | `/api/v1/contacts/segments`             | Get segment counts by lifecycle      |
| GET    | `/api/v1/contacts/:id`                  | Get contact by ID                    |
| PUT    | `/api/v1/contacts/:id`                  | Update contact fields                |
| GET    | `/api/v1/contacts/:id/timeline`         | Get contact activity timeline        |
| POST   | `/api/v1/contacts/:id/tags`             | Apply tags to contact                |
| DELETE | `/api/v1/contacts/:id/tags/:tagId`      | Remove tag from contact              |

**Filter query parameters** (in addition to pagination):

| Param     | Description                      |
|-----------|----------------------------------|
| lifecycle | Filter by lifecycle status        |
| tag       | Filter by tag ID                  |
| search    | Search by firstName, lastName, email |

**Update contact body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": { "countryCode": "+1", "number": "5551234" },
  "lifecycleStatus": "returning",
  "customFields": { "favorite_dish": "Pizza" },
  "smsOptIn": true,
  "emailOptIn": true
}
```

**Apply tags body:**
```json
{
  "tagIds": ["tag-id-1", "tag-id-2"]
}
```

**Segments response:**
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

### Templates — `/api/v1/templates`

| Method | Path                              | Description              |
|--------|-----------------------------------|--------------------------|
| GET    | `/api/v1/templates`               | List templates (paginated) |
| POST   | `/api/v1/templates`               | Create template          |
| PUT    | `/api/v1/templates/:id`           | Update template          |
| DELETE | `/api/v1/templates/:id`           | Delete template          |
| POST   | `/api/v1/templates/:id/preview`   | Preview template with sample data |

**Filter query parameters:**

| Param   | Description                |
|---------|----------------------------|
| channel | Filter by `email` or `sms` |

**Create template body:**
```json
{
  "channel": "email",
  "name": "Welcome Email",
  "subject": "Welcome, {{first_name}}!",
  "body": "<p>Hi {{first_name}}, welcome to {{restaurant_name}}!</p>"
}
```

**Preview body:**
```json
{
  "sampleData": {
    "first_name": "John",
    "restaurant_name": "Pizza Palace"
  }
}
```

### Tags — `/api/v1/tags`

| Method | Path                  | Description         |
|--------|-----------------------|---------------------|
| GET    | `/api/v1/tags`        | List tags (paginated) |
| POST   | `/api/v1/tags`        | Create tag          |
| PUT    | `/api/v1/tags/:id`    | Update tag          |
| DELETE | `/api/v1/tags/:id`    | Delete tag (not system tags) |

**Create tag body:**
```json
{
  "name": "VIP",
  "description": "High-value customers",
  "color": "#FFD700"
}
```

### Custom Fields — `/api/v1/custom-fields`

| Method | Path                         | Description              |
|--------|------------------------------|--------------------------|
| GET    | `/api/v1/custom-fields`      | List all custom fields   |
| POST   | `/api/v1/custom-fields`      | Create custom field      |
| PUT    | `/api/v1/custom-fields/:id`  | Update custom field      |
| DELETE | `/api/v1/custom-fields/:id`  | Delete custom field      |

**Create custom field body:**
```json
{
  "key": "favorite_dish",
  "name": "Favorite Dish",
  "fieldType": "text",
  "options": [],
  "isRequired": false,
  "sortOrder": 0
}
```

Valid `fieldType` values: `'text' | 'number' | 'date' | 'dropdown' | 'checkbox'`

### Analytics — `/api/v1/analytics`

| Method | Path                          | Description                        |
|--------|-------------------------------|------------------------------------|
| GET    | `/api/v1/analytics/overview`  | Dashboard overview for restaurant  |
| GET    | `/api/v1/analytics/flows/:id` | Per-node analytics for a flow      |
| GET    | `/api/v1/analytics/messaging` | Messaging stats (optional `?since=ISO`) |
| GET    | `/api/v1/analytics/campaigns` | Campaign list with stats (paginated) |

**Overview response:**
```typescript
interface DashboardOverview {
  totalContacts: number;
  newContactsThisMonth: number;
  segments: Record<string, number>;  // e.g. { lead: 42, first_time: 18, ... }
  activeFlows: number;
  totalEnrollments: number;
  messagingStats: Array<{ channel: string; status: string; count: number }>;
}
```

### Campaigns — `/api/v1/campaigns`

| Method | Path                      | Description              |
|--------|---------------------------|--------------------------|
| GET    | `/api/v1/campaigns`       | List campaigns (paginated) |
| GET    | `/api/v1/campaigns/:id`   | Get campaign by ID       |
| POST   | `/api/v1/campaigns`       | Create campaign          |
| PUT    | `/api/v1/campaigns/:id`   | Update campaign          |

**Create campaign body:**
```json
{
  "name": "Summer Campaign",
  "description": "A summer promotion",
  "flowIds": ["flow-id-1"],
  "source": "summer2024"
}
```

### System — `/api/v1`

| Method | Path                             | Description              |
|--------|----------------------------------|--------------------------|
| GET    | `/api/v1/health`                 | Health check (no auth)   |
| GET    | `/api/v1/system/kafka-status`    | Kafka consumer status    |
| POST   | `/api/v1/system/sync-contacts`   | Force sync contacts from OrderChop |

### Tracking — `/t/:trackingId`

| Method | Path               | Description                |
|--------|---------------------|---------------------------|
| GET    | `/t/:trackingId`    | Redirect tracked link click (no auth) |

---

## TypeScript Types (Frontend)

```typescript
// ── Contact ──

interface CRMContact {
  id: string;  // mapped from backend _id
  restaurantId: string;
  customerId: string;
  email: string;
  phone: { countryCode: string; number: string } | null;
  firstName: string;
  lastName: string;
  emailOptIn: boolean;
  smsOptIn: boolean;
  lifecycleStatus: LifecycleStatus;
  tags: string[];  // ObjectId strings
  customFields: Record<string, unknown>;
  lastOrderAt: string | null;
  totalOrders: number;
  lifetimeValue: number;
  averageOrderValue: number;
  lastReviewRequestAt: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

type LifecycleStatus = 'lead' | 'first_time' | 'returning' | 'lost' | 'recovered' | 'VIP';

// ── Flow ──

interface Flow {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  isSystem: boolean;
  version: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  stats: {
    enrollments: number;
    completions: number;
    activeEnrollments: number;
  };
  createdAt: string;
  updatedAt: string;
}

type FlowStatus = 'draft' | 'active' | 'paused' | 'archived';

interface FlowNode {
  id: string;
  type: NodeType;
  subType: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

interface FlowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  label?: string;
}

type NodeType = 'trigger' | 'action' | 'condition' | 'timer' | 'logic';

// ── Flow Template ──

interface FlowTemplate {
  key: string;
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
}

// ── Tag ──

interface CRMTag {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Template ──

interface CommunicationTemplate {
  id: string;
  restaurantId: string;
  channel: 'email' | 'sms';
  name: string;
  subject: string | null;
  body: string;
  isSystem: boolean;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Custom Field ──

interface CustomField {
  id: string;
  restaurantId: string;
  key: string;
  name: string;
  fieldType: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
  options: string[];
  isRequired: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// ── Campaign ──

interface Campaign {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'completed' | 'archived';
  flowIds: string[];
  source: string | null;
  stats: {
    contactsReached: number;
    emailsSent: number;
    smsSent: number;
    revenueAttributed: number;
    ordersAttributed: number;
  };
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Dashboard Overview (from /analytics/overview) ──

interface DashboardOverview {
  totalContacts: number;
  newContactsThisMonth: number;
  segments: Record<string, number>;
  activeFlows: number;
  totalEnrollments: number;
  messagingStats: Array<{ channel: string; status: string; count: number }>;
}
```

---

## Node Types & Subtypes (Flow Builder)

These are all the node types and their subtypes that the backend supports. Use these for the flow builder drag-and-drop panel.

### Triggers (`type: 'trigger'`)

| SubType             | Label                | Category           |
|---------------------|----------------------|--------------------|
| order_completed     | Order Completed      | OrderChop Triggers |
| payment_failed      | Payment Failed       | OrderChop Triggers |
| order_status_changed| Order Status Changed | OrderChop Triggers |
| abandoned_cart      | Abandoned Cart       | OrderChop Triggers |
| first_order         | First Order          | OrderChop Triggers |
| nth_order           | Nth Order            | OrderChop Triggers |
| no_order_in_x_days  | No Order in X Days   | OrderChop Triggers |
| tag_applied         | Tag Applied          | CRM Triggers       |
| tag_removed         | Tag Removed          | CRM Triggers       |
| opt_in_changed      | Opt-In Changed       | CRM Triggers       |
| field_changed       | Field Changed        | CRM Triggers       |
| contact_birthday    | Contact Birthday     | CRM Triggers       |
| task_completed      | Task Completed       | CRM Triggers       |
| link_clicked        | Link Clicked         | Activity Triggers  |
| page_visited        | Page Visited         | Activity Triggers  |
| sms_reply           | SMS Reply            | Activity Triggers  |
| form_submission     | Form Submission      | Activity Triggers  |
| webhook_incoming    | Webhook Incoming     | Developer Triggers |

### Actions (`type: 'action'`)

| SubType            | Label              |
|--------------------|--------------------|
| send_email         | Send Email         |
| send_sms           | Send SMS           |
| admin_notification | Admin Notification |
| apply_tag          | Apply Tag          |
| remove_tag         | Remove Tag         |
| update_field       | Update Field       |
| add_note           | Add Note           |
| create_task        | Create Task        |
| assign_owner       | Assign Owner       |
| meta_capi_event    | Meta CAPI Event    |
| outgoing_webhook   | Outgoing Webhook   |

### Conditions (`type: 'condition'`)

| SubType             | Label               |
|---------------------|---------------------|
| yes_no              | Yes/No Branch       |
| multi_branch        | Multi Branch        |
| ab_split            | A/B Split           |
| random_distribution | Random Distribution |

### Timers (`type: 'timer'`)

| SubType              | Label                |
|----------------------|----------------------|
| delay                | Delay                |
| date_field           | Date Field Timer     |
| smart_date_sequence  | Smart Date Sequence  |

> **Note**: Timer `delay` config: `{ duration: number, unit: 'minutes' | 'hours' | 'days' }`
> Timer `date_field` config: `{ dateField: string }` (references a contact's date field)

### Logic (`type: 'logic'`)

| SubType         | Label           |
|-----------------|-----------------|
| loop            | Loop            |
| skip            | Skip            |
| stop            | Stop            |
| until_condition | Until Condition |

---

## Server Actions Pattern

Server actions in Next.js proxy requests to the CRM engine. They handle:
1. Getting the auth token from the session
2. Setting `Authorization` and `X-Restaurant-Id` headers
3. Making the HTTP request to CRM engine
4. Mapping `_id` → `id` in responses
5. Unwrapping paginated responses

```typescript
// lib/actions/crm.ts
'use server';

import { auth } from '@/auth';

const CRM_URL = process.env.CRM_ENGINE_URL || 'http://localhost:3001';

async function crmFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = await auth();
  if (!session?.accessToken) throw new Error('Not authenticated');

  const res = await fetch(`${CRM_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.accessToken}`,
      'X-Restaurant-Id': session.restaurantId,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `CRM API error: ${res.status}`);
  }

  return res.json();
}

// ── Utility: map _id to id ──
function mapId<T extends Record<string, unknown>>(doc: T): T & { id: string } {
  const { _id, ...rest } = doc as any;
  return { id: String(_id), ...rest } as any;
}

function mapPaginated<T extends Record<string, unknown>>(
  result: { data: T[]; total: number; page: number; limit: number; totalPages: number; hasMore: boolean },
) {
  return {
    ...result,
    data: result.data.map(mapId),
  };
}

// ── Flows ──

export async function getFlows(restaurantId: string, page = 1, limit = 20) {
  const result = await crmFetch<PaginatedResponse<Flow>>(
    `/api/v1/flows?page=${page}&limit=${limit}`,
  );
  return mapPaginated(result);
}

export async function getFlowById(restaurantId: string, flowId: string) {
  const flow = await crmFetch<Flow>(`/api/v1/flows/${flowId}`);
  return mapId(flow);
}

export async function createFlow(restaurantId: string, data: CreateFlowInput) {
  const flow = await crmFetch<Flow>('/api/v1/flows', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapId(flow);
}

export async function updateFlow(restaurantId: string, flowId: string, data: Partial<CreateFlowInput>) {
  const flow = await crmFetch<Flow>(`/api/v1/flows/${flowId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapId(flow);
}

export async function deleteFlow(restaurantId: string, flowId: string) {
  return crmFetch<{ success: boolean }>(`/api/v1/flows/${flowId}`, {
    method: 'DELETE',
  });
}

export async function activateFlow(restaurantId: string, flowId: string) {
  const flow = await crmFetch<Flow>(`/api/v1/flows/${flowId}/activate`, {
    method: 'POST',
  });
  return mapId(flow);
}

export async function pauseFlow(restaurantId: string, flowId: string) {
  const flow = await crmFetch<Flow>(`/api/v1/flows/${flowId}/pause`, {
    method: 'POST',
  });
  return mapId(flow);
}

export async function getFlowTemplates(restaurantId: string) {
  return crmFetch<FlowTemplate[]>('/api/v1/flows/templates');
}

export async function createFlowFromTemplate(restaurantId: string, templateKey: string, name?: string) {
  const flow = await crmFetch<Flow>('/api/v1/flows/from-template', {
    method: 'POST',
    body: JSON.stringify({ templateKey, name }),
  });
  return mapId(flow);
}

// ── Contacts ──

export async function getContacts(
  restaurantId: string,
  page = 1,
  limit = 20,
  filters?: { lifecycle?: string; tag?: string; search?: string },
) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters?.lifecycle) params.set('lifecycle', filters.lifecycle);
  if (filters?.tag) params.set('tag', filters.tag);
  if (filters?.search) params.set('search', filters.search);

  const result = await crmFetch<PaginatedResponse<CRMContact>>(
    `/api/v1/contacts?${params}`,
  );
  return mapPaginated(result);
}

export async function getContactById(restaurantId: string, contactId: string) {
  const contact = await crmFetch<CRMContact>(`/api/v1/contacts/${contactId}`);
  return mapId(contact);
}

export async function updateContact(restaurantId: string, contactId: string, data: UpdateContactInput) {
  const contact = await crmFetch<CRMContact>(`/api/v1/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapId(contact);
}

export async function getContactTimeline(restaurantId: string, contactId: string, limit = 50) {
  return crmFetch<TimelineEntry[]>(`/api/v1/contacts/${contactId}/timeline?limit=${limit}`);
}

export async function getSegmentCounts(restaurantId: string) {
  return crmFetch<Record<string, number>>('/api/v1/contacts/segments');
}

export async function applyTags(restaurantId: string, contactId: string, tagIds: string[]) {
  const contact = await crmFetch<CRMContact>(`/api/v1/contacts/${contactId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tagIds }),
  });
  return mapId(contact);
}

export async function removeTag(restaurantId: string, contactId: string, tagId: string) {
  const contact = await crmFetch<CRMContact>(`/api/v1/contacts/${contactId}/tags/${tagId}`, {
    method: 'DELETE',
  });
  return mapId(contact);
}

// ── Templates ──

export async function getTemplates(restaurantId: string, channel?: 'email' | 'sms') {
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  const result = await crmFetch<PaginatedResponse<CommunicationTemplate>>(
    `/api/v1/templates?${params}`,
  );
  return mapPaginated(result);
}

export async function createTemplate(restaurantId: string, data: CreateTemplateInput) {
  const template = await crmFetch<CommunicationTemplate>('/api/v1/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapId(template);
}

export async function updateTemplate(restaurantId: string, templateId: string, data: Partial<CreateTemplateInput>) {
  const template = await crmFetch<CommunicationTemplate>(`/api/v1/templates/${templateId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapId(template);
}

export async function deleteTemplate(restaurantId: string, templateId: string) {
  return crmFetch<{ success: boolean }>(`/api/v1/templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function previewTemplate(restaurantId: string, templateId: string, sampleData: Record<string, string>) {
  return crmFetch<{ subject?: string; body: string }>(`/api/v1/templates/${templateId}/preview`, {
    method: 'POST',
    body: JSON.stringify({ sampleData }),
  });
}

// ── Tags ──

export async function getTags(restaurantId: string) {
  const result = await crmFetch<PaginatedResponse<CRMTag>>('/api/v1/tags');
  return mapPaginated(result);
}

export async function createTag(restaurantId: string, data: CreateTagInput) {
  const tag = await crmFetch<CRMTag>('/api/v1/tags', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapId(tag);
}

export async function updateTag(restaurantId: string, tagId: string, data: Partial<CreateTagInput>) {
  const tag = await crmFetch<CRMTag>(`/api/v1/tags/${tagId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapId(tag);
}

export async function deleteTag(restaurantId: string, tagId: string) {
  return crmFetch<{ success: boolean }>(`/api/v1/tags/${tagId}`, {
    method: 'DELETE',
  });
}

// ── Custom Fields ──

export async function getCustomFields(restaurantId: string) {
  const fields = await crmFetch<CustomField[]>('/api/v1/custom-fields');
  return fields.map(mapId);
}

export async function createCustomField(restaurantId: string, data: CreateCustomFieldInput) {
  const field = await crmFetch<CustomField>('/api/v1/custom-fields', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapId(field);
}

export async function updateCustomField(restaurantId: string, fieldId: string, data: Partial<CreateCustomFieldInput>) {
  const field = await crmFetch<CustomField>(`/api/v1/custom-fields/${fieldId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapId(field);
}

export async function deleteCustomField(restaurantId: string, fieldId: string) {
  return crmFetch<{ success: boolean }>(`/api/v1/custom-fields/${fieldId}`, {
    method: 'DELETE',
  });
}

// ── Analytics ──

export async function getDashboardOverview(restaurantId: string) {
  return crmFetch<DashboardOverview>('/api/v1/analytics/overview');
}

export async function getFlowAnalytics(restaurantId: string, flowId: string) {
  return crmFetch<FlowNodeAnalytics[]>(`/api/v1/analytics/flows/${flowId}`);
}

export async function getMessagingStats(restaurantId: string, since?: string) {
  const params = since ? `?since=${since}` : '';
  return crmFetch<MessagingStat[]>(`/api/v1/analytics/messaging${params}`);
}

// ── Campaigns ──

export async function getCampaigns(restaurantId: string, page = 1, limit = 20) {
  const result = await crmFetch<PaginatedResponse<Campaign>>(
    `/api/v1/campaigns?page=${page}&limit=${limit}`,
  );
  return mapPaginated(result);
}

export async function getCampaignById(restaurantId: string, campaignId: string) {
  const campaign = await crmFetch<Campaign>(`/api/v1/campaigns/${campaignId}`);
  return mapId(campaign);
}

export async function createCampaign(restaurantId: string, data: CreateCampaignInput) {
  const campaign = await crmFetch<Campaign>('/api/v1/campaigns', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapId(campaign);
}

export async function updateCampaign(restaurantId: string, campaignId: string, data: Partial<CreateCampaignInput>) {
  const campaign = await crmFetch<Campaign>(`/api/v1/campaigns/${campaignId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapId(campaign);
}

// ── System ──

export async function syncContacts(restaurantId: string) {
  return crmFetch<{ synced: number; total: number }>('/api/v1/system/sync-contacts', {
    method: 'POST',
  });
}

export async function checkHealth() {
  const res = await fetch(`${CRM_URL}/api/v1/health`);
  return res.json();
}
```

---

## Input Types

```typescript
interface CreateFlowInput {
  name: string;
  description?: string;
  nodes?: FlowNode[];
  edges?: FlowEdge[];
}

interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: { countryCode: string; number: string } | null;
  lifecycleStatus?: string;
  customFields?: Record<string, unknown>;
  smsOptIn?: boolean;
  emailOptIn?: boolean;
}

interface CreateTemplateInput {
  channel: 'email' | 'sms';
  name: string;
  subject?: string;
  body: string;
}

interface CreateTagInput {
  name: string;
  description?: string;
  color?: string;  // hex format: #RRGGBB
}

interface CreateCustomFieldInput {
  key: string;       // lowercase_snake_case
  name: string;
  fieldType: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
  options?: string[];
  isRequired?: boolean;
  sortOrder?: number;
}

interface CreateCampaignInput {
  name: string;
  description?: string;
  flowIds?: string[];
  source?: string;
}
```

---

## Additional Response Types

```typescript
interface TimelineEntry {
  _id: string;
  executionId: string;
  flowId: string;
  restaurantId: string;
  contactId: string;
  nodeId: string;
  nodeType: string;
  action: string;        // Human-readable description
  result: 'success' | 'failure' | 'skipped';
  error: string | null;
  metadata: Record<string, unknown>;
  executedAt: string;
}

interface FlowNodeAnalytics {
  nodeId: string;
  nodeType: string;
  success: number;
  failure: number;
  skipped: number;
  total: number;
}

interface MessagingStat {
  channel: string;
  status: string;
  count: number;
}
```

---

## NODE_PANEL_ITEMS (Flow Builder Drag Panel)

All items available in the flow builder drag-and-drop sidebar. Group by category.

```typescript
const NODE_PANEL_ITEMS = [
  // ── Triggers ──
  { type: 'trigger', subType: 'order_completed',      label: 'Order Completed',      category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'payment_failed',       label: 'Payment Failed',       category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'order_status_changed', label: 'Order Status Changed', category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'abandoned_cart',       label: 'Abandoned Cart',       category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'first_order',          label: 'First Order',          category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'nth_order',            label: 'Nth Order',            category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'no_order_in_x_days',   label: 'No Order in X Days',   category: 'OrderChop Triggers' },
  { type: 'trigger', subType: 'tag_applied',          label: 'Tag Applied',          category: 'CRM Triggers' },
  { type: 'trigger', subType: 'tag_removed',          label: 'Tag Removed',          category: 'CRM Triggers' },
  { type: 'trigger', subType: 'opt_in_changed',       label: 'Opt-In Changed',       category: 'CRM Triggers' },
  { type: 'trigger', subType: 'field_changed',        label: 'Field Changed',        category: 'CRM Triggers' },
  { type: 'trigger', subType: 'contact_birthday',     label: 'Contact Birthday',     category: 'CRM Triggers' },
  { type: 'trigger', subType: 'task_completed',       label: 'Task Completed',       category: 'CRM Triggers' },
  { type: 'trigger', subType: 'link_clicked',         label: 'Link Clicked',         category: 'Activity Triggers' },
  { type: 'trigger', subType: 'page_visited',         label: 'Page Visited',         category: 'Activity Triggers' },
  { type: 'trigger', subType: 'sms_reply',            label: 'SMS Reply',            category: 'Activity Triggers' },
  { type: 'trigger', subType: 'form_submission',      label: 'Form Submission',      category: 'Activity Triggers' },
  { type: 'trigger', subType: 'webhook_incoming',     label: 'Webhook Incoming',     category: 'Developer Triggers' },

  // ── Actions ──
  { type: 'action', subType: 'send_email',         label: 'Send Email',         category: 'Communication' },
  { type: 'action', subType: 'send_sms',           label: 'Send SMS',           category: 'Communication' },
  { type: 'action', subType: 'admin_notification', label: 'Admin Notification', category: 'Communication' },
  { type: 'action', subType: 'apply_tag',          label: 'Apply Tag',          category: 'CRM Actions' },
  { type: 'action', subType: 'remove_tag',         label: 'Remove Tag',         category: 'CRM Actions' },
  { type: 'action', subType: 'update_field',       label: 'Update Field',       category: 'CRM Actions' },
  { type: 'action', subType: 'add_note',           label: 'Add Note',           category: 'CRM Actions' },
  { type: 'action', subType: 'create_task',        label: 'Create Task',        category: 'CRM Actions' },
  { type: 'action', subType: 'assign_owner',       label: 'Assign Owner',       category: 'CRM Actions' },
  { type: 'action', subType: 'meta_capi_event',    label: 'Meta CAPI Event',    category: 'Advertising' },
  { type: 'action', subType: 'outgoing_webhook',   label: 'Outgoing Webhook',   category: 'Developer' },

  // ── Conditions ──
  { type: 'condition', subType: 'yes_no',              label: 'Yes/No Branch',       category: 'Conditions' },
  { type: 'condition', subType: 'multi_branch',        label: 'Multi Branch',        category: 'Conditions' },
  { type: 'condition', subType: 'ab_split',            label: 'A/B Split',           category: 'Conditions' },
  { type: 'condition', subType: 'random_distribution', label: 'Random Distribution', category: 'Conditions' },

  // ── Timers ──
  { type: 'timer', subType: 'delay',               label: 'Delay',               category: 'Timers' },
  { type: 'timer', subType: 'date_field',          label: 'Date Field Timer',    category: 'Timers' },
  { type: 'timer', subType: 'smart_date_sequence', label: 'Smart Date Sequence', category: 'Timers' },

  // ── Logic ──
  { type: 'logic', subType: 'loop',            label: 'Loop',            category: 'Logic' },
  { type: 'logic', subType: 'skip',            label: 'Skip',            category: 'Logic' },
  { type: 'logic', subType: 'stop',            label: 'Stop',            category: 'Logic' },
  { type: 'logic', subType: 'until_condition', label: 'Until Condition', category: 'Logic' },
];
```

---

## File Structure (Frontend CRM Module)

```
app/[locale]/app/restaurant/[restaurantId]/crm/
├── layout.tsx                          # CRM layout with tab navigation
├── page.tsx                            # Overview dashboard (redirects or default tab)
├── contacts/
│   ├── page.tsx                        # Contact list with filters, search, segments
│   └── [contactId]/
│       └── page.tsx                    # Contact detail (profile, tags, timeline, custom fields)
├── flows/
│   ├── page.tsx                        # Flow list (status, stats, create/template buttons)
│   └── [flowId]/
│       └── page.tsx                    # Flow builder (drag-and-drop canvas)
├── templates/
│   └── page.tsx                        # Email/SMS template management
├── tags/
│   └── page.tsx                        # Tag management (CRUD, contact counts)
├── campaigns/
│   └── page.tsx                        # Campaign list and detail
└── settings/
    └── page.tsx                        # Custom fields, sync contacts, system health

lib/
├── actions/
│   └── crm.ts                         # Server actions (shown above)
├── stores/
│   └── crm-store.ts                   # Zustand store for CRM state
├── hooks/
│   └── use-crm.ts                     # React Query hooks wrapping server actions
└── types/
    └── crm.ts                         # All CRM TypeScript types (shown above)
```

---

## Environment Variables (Frontend .env.local)

```env
# CRM Engine connection
CRM_ENGINE_URL=http://localhost:3001
```

The Next.js app must share the same `AUTH_SECRET` and `MONGODB_URI` as the CRM engine for JWT verification and data consistency.
