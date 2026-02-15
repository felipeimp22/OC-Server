# oc-crm-engine

Event-driven CRM automation engine for the OrderChop restaurant SaaS platform.

## Overview

`oc-crm-engine` is a standalone Node.js microservice that powers the CRM backend for OrderChop. It listens to Kafka events from the main OrderChop platform (orders, customers, carts) and executes automation flows defined through a visual flow builder.

### Key Capabilities

- **Flow Engine** — DAG-based automation flows with triggers, actions, conditions, timers, and logic nodes
- **19 Trigger Types** — Order events, CRM events, activity triggers, developer webhooks
- **11 Action Types** — Email/SMS, tag management, custom fields, tasks, Meta CAPI, webhooks
- **9 Logic Types** — Yes/No branching, A/B splits, loops, smart date sequences
- **Template Engine** — Variable interpolation with `{{variable}}` syntax for email/SMS
- **Lifecycle Tracking** — Automatic lead → first_time → returning → lost → recovered → VIP transitions
- **Multi-tenant** — Full restaurant isolation via `restaurantId` on every query
- **Anti-spam** — Frequency limits and review request cooldowns

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ LTS |
| Language | TypeScript 5.x (strict mode, ESM) |
| HTTP | Fastify v5 |
| Database | MongoDB (Mongoose v8) — shared Atlas instance |
| Message Broker | KafkaJS |
| Job Queue | BullMQ v5 + ioredis |
| Scheduling | node-cron |
| Validation | Zod |
| Auth | jose (NextAuth v5 JWT verification) |
| Testing | Vitest |
| Logging | Pino |

## Quick Start

### Prerequisites

- Node.js 20+
- MongoDB Atlas connection string
- Kafka broker (Upstash or similar)
- Redis instance (Upstash or similar)

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Build
npm run build

# Start (production)
npm start

# Start (development with hot reload)
npm run dev
```

### Environment Variables

See [.env.example](.env.example) for all required and optional variables.

Key variables:
- `MONGODB_URI` — MongoDB connection string
- `KAFKA_BROKER` / `KAFKA_USERNAME` / `KAFKA_PASSWORD` — Kafka credentials
- `REDIS_URL` — Redis URL for BullMQ
- `AUTH_SECRET` — Shared secret with NextAuth v5
- `MAILGUN_API_KEY` / `EMAIL_DOMAIN` — Email provider (Mailgun or SendGrid)
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — SMS provider

## Project Structure

```
src/
├── api/                  # Fastify routes and validators
│   ├── middleware/        # Auth (JWT) and tenancy (restaurantId) middleware
│   ├── routes/           # REST endpoints (flows, contacts, tags, etc.)
│   └── validators/       # Zod schemas for request validation
├── config/               # Environment, logger, database, Kafka, Redis
├── domain/
│   ├── enums/            # LifecycleStatus, FlowStatus, NodeType, etc.
│   ├── interfaces/       # IEvent, IFlowEngine, ICommunicationProvider, IRepository
│   └── models/
│       ├── crm/          # CRM-owned Mongoose schemas (Contact, Flow, Tag, etc.)
│       └── external/     # Read-only schemas for existing OrderChop collections
├── factories/            # Email/SMS/Meta provider factories (singleton)
├── kafka/                # Kafka consumers (Order, Customer, Cart, CRM) and producers
├── providers/            # Email (Mailgun, SendGrid) and SMS (Twilio, MessageBird) providers
├── repositories/         # Data access with tenant-isolated BaseRepository
├── schedulers/           # BullMQ timer processor + cron jobs
├── seeds/                # System flows, tags, and template seeds
├── services/             # Business logic (FlowEngine, Communication, Trigger, etc.)
└── utils/                # Interpolation, timezone, retry, anti-spam, idempotency
tests/
└── unit/                 # Vitest unit tests
```

## API Endpoints

All endpoints require `Authorization: Bearer <token>` and `X-Restaurant-Id` headers.

### Flows
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/flows` | List flows (paginated) |
| POST | `/api/flows` | Create a flow |
| GET | `/api/flows/:id` | Get a flow |
| PATCH | `/api/flows/:id` | Update a flow |
| DELETE | `/api/flows/:id` | Delete a flow |
| POST | `/api/flows/:id/activate` | Activate a flow |
| POST | `/api/flows/:id/pause` | Pause a flow |

### Contacts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contacts` | List contacts (paginated) |
| GET | `/api/contacts/:id` | Get contact with timeline |
| PATCH | `/api/contacts/:id` | Update contact |
| POST | `/api/contacts/:id/tags` | Apply tags |
| DELETE | `/api/contacts/:id/tags/:tagId` | Remove tag |

### Templates, Tags, Custom Fields, Campaigns
Similar CRUD patterns — see route files for full details.

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/overview` | Dashboard overview stats |
| GET | `/api/analytics/flows/:id` | Flow-level analytics |

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system/health` | Health check |
| POST | `/api/system/seed` | Run seed data |

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## License

Private — OrderChop internal use only.
