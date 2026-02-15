# Integration Guide

## Connecting to oc-crm-engine from oc-webapp

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
Development: http://localhost:4000/api
Production:  https://crm.orderchop.com/api  (or your deployment URL)
```

### Example: Creating a Flow

```typescript
const response = await fetch(`${CRM_BASE_URL}/api/flows`, {
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
        config: { templateId: '<template-id>' },
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

const response = await fetch(`${CRM_BASE_URL}/api/contacts?${params}`, {
  headers,
});

const { data, total, page, limit, totalPages, hasMore } = await response.json();
```

### Example: Updating a Contact

```typescript
await fetch(`${CRM_BASE_URL}/api/contacts/${contactId}`, {
  method: 'PATCH',
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

## Kafka Event Format

Events published to Kafka by the main oc-server should follow this format:

```typescript
interface OrderEvent {
  eventId: string;      // UUID — used for idempotency
  eventType: string;    // e.g., 'order_completed', 'order_status_changed'
  restaurantId: string; // MongoDB ObjectId as string
  customerId: string;   // MongoDB ObjectId as string
  orderId?: string;
  data: {
    // Event-specific payload
    total?: number;
    orderNumber?: string;
    orderType?: string;
    status?: string;
    previousStatus?: string;
    // ... additional fields
  };
  timestamp: string;    // ISO 8601
}
```

### Required Kafka Topics

Ensure these topics exist in your Kafka cluster:

| Topic | Producer | Consumer |
|-------|----------|----------|
| `order-events` | oc-server | oc-crm-engine |
| `customer-events` | oc-server | oc-crm-engine |
| `cart-events` | oc-server | oc-crm-engine |
| `crm-events` | oc-crm-engine | oc-crm-engine |

## Template Variables

Available variables for email/SMS templates:

### Contact Variables
| Variable | Description |
|----------|-------------|
| `{{first_name}}` | Contact's first name |
| `{{last_name}}` | Contact's last name |
| `{{email}}` | Contact's email |
| `{{phone}}` | Contact's phone |
| `{{lifecycle_status}}` | Current lifecycle status |
| `{{total_orders}}` | Total order count |
| `{{lifetime_value}}` | Total spend |

### Restaurant Variables
| Variable | Description |
|----------|-------------|
| `{{restaurant_name}}` | Restaurant name |
| `{{restaurant_phone}}` | Restaurant phone |
| `{{restaurant_email}}` | Restaurant email |

### Order Variables (when triggered by order events)
| Variable | Description |
|----------|-------------|
| `{{order_total}}` | Order total amount |
| `{{order_number}}` | Order number |
| `{{order_type}}` | delivery/pickup/dine-in |
| `{{order_date}}` | Order date |

### Special Variables
| Variable | Description |
|----------|-------------|
| `{{review_link}}` | Auto-generated review link |
| `{{promo_code}}` | Promotional code |
| `{{unsubscribe_link}}` | Unsubscribe URL |

### Custom Fields
Any custom field defined for the restaurant is available as `{{field_key}}`.

## Docker Deployment

```bash
# Build the image
docker build -t oc-crm-engine .

# Run with docker-compose
docker-compose up -d
```

The `docker-compose.yml` includes MongoDB, Redis, and Kafka for local development.
