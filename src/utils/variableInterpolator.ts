/**
 * @fileoverview Template variable interpolation utility.
 *
 * Replaces `{{variable_name}}` placeholders in email/SMS templates
 * with values from a context object built from contact, restaurant,
 * and order data.
 *
 * Supported variables:
 * - Contact: first_name, last_name, email, phone, lifecycle_status
 * - Restaurant: restaurant_name, restaurant_phone, restaurant_email
 * - Order: order_total, order_number, order_type, order_date
 * - Currency: currency, currency_symbol
 * - Special: review_link, promo_code, unsubscribe_link
 * - Custom fields: any key defined in crm_custom_fields
 *
 * @module utils/variableInterpolator
 */

/**
 * Context object for template interpolation.
 * Supports both flat keys ({{first_name}}) and dot-notation ({{customer.first_name}}).
 */
export type InterpolationContext = Record<string, unknown>;

/**
 * Regex pattern matching `{{variable.name}}` with optional whitespace.
 * Supports dot-notation: {{customer.first_name}}, {{order.total}}, {{first_name}}
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Resolve a dot-notation key path from a nested context object.
 * Returns undefined for unknown or non-scalar leaf values.
 */
function resolveKey(key: string, context: Record<string, unknown>): string | number | boolean | null | undefined {
  const parts = key.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current !== null && typeof current === 'object') return undefined;
  return current as string | number | boolean | null | undefined;
}

/**
 * Interpolate template variables in a string.
 * Supports both flat keys ({{first_name}}) and dot-notation ({{customer.first_name}}).
 *
 * @param template - Template string with `{{variable}}` or `{{object.field}}` placeholders
 * @param context - Key-value map (flat or nested) of variable values
 * @returns Interpolated string with all recognized variables replaced.
 *          Unknown tokens are replaced with empty string.
 *
 * @example
 * ```ts
 * const result = interpolate(
 *   'Hey {{customer.first_name}}, your order total is {{order.total}}!',
 *   { customer: { first_name: 'Maria' }, order: { total: 42.5 } },
 * );
 * // → 'Hey Maria, your order total is 42.5!'
 * ```
 */
export function interpolate(template: string, context: InterpolationContext): string {
  // Backwards-compat alias: old saved flows may still use {{restaurant.owner_name}}
  const normalized = template.replace(/\{\{\s*restaurant\.owner_name\s*\}\}/g, '{{restaurant.name}}');
  return normalized.replace(VARIABLE_PATTERN, (_match, key: string) => {
    const value = resolveKey(key, context);
    if (value === null || value === undefined) {
      return ''; // Unknown or null vars replaced with empty string
    }
    return String(value);
  });
}

/**
 * Extract all variable names used in a template.
 * Used for template validation and listing available variables.
 *
 * @param template - Template string
 * @returns Array of unique variable names found
 *
 * @example
 * ```ts
 * extractVariables('Hi {{first_name}}, your total is {{order_total}}');
 * // → ['first_name', 'order_total']
 * ```
 */
export function extractVariables(template: string): string[] {
  const variables = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(VARIABLE_PATTERN);

  while ((match = regex.exec(template)) !== null) {
    variables.add(match[1]!);
  }

  return Array.from(variables);
}

/**
 * Format an array of order/cart items into a human-readable summary.
 * Produces e.g. "2x Burger, 1x Fries".
 */
function formatItems(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return '';
      const i = item as Record<string, unknown>;
      const qty = i.quantity ?? i.qty ?? 1;
      const name = i.name ?? i.menuItemName ?? i.title ?? '';
      return name ? `${qty}x ${name}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Build a full interpolation context from CRM data sources.
 *
 * Maps trigger event payload fields to nested dot-notation variables matching
 * the trigger-scoped variable table in CRM_FRONTEND_SPEC.md.
 *
 * Nested keys (for dot-notation templates): {{customer.first_name}}, {{order.total}}, etc.
 * Flat keys (for backward compat): {{first_name}}, {{restaurant_name}}, etc.
 *
 * @param contact - CRM contact document (source of customer.* fields)
 * @param payload - Trigger event payload (source of order.*, payment.*, cart.* fields)
 * @param restaurant - Restaurant document (source of restaurant.* fields)
 * @returns Context ready for interpolation; unknown {{tokens}} resolve to empty string
 */
export async function buildContext(
  contact: Record<string, unknown>,
  payload: Record<string, unknown>,
  restaurant: Record<string, unknown>,
): Promise<InterpolationContext> {
  const ctx: InterpolationContext = {};

  // ── Customer fields ──────────────────────────────────────────────
  if (contact) {
    // Resolve phone: accept object { countryCode, number } OR plain string
    const phoneStr = (() => {
      if (contact.phone && typeof contact.phone === 'object') {
        const phone = contact.phone as { countryCode?: string; number?: string };
        return `${phone.countryCode ?? ''}${phone.number ?? ''}`;
      }
      if (typeof contact.phone === 'string' && contact.phone) {
        return contact.phone;
      }
      // Fallback to payload.customerPhone (Kafka sends flat string e.g. '+1 7787915942')
      if (payload.customerPhone && typeof payload.customerPhone === 'string') {
        return payload.customerPhone;
      }
      return '';
    })();

    // Resolve first/last name with fallback to splitting payload.customerName
    let firstName = String(contact.firstName ?? '');
    let lastName = String(contact.lastName ?? '');
    if ((!firstName || !lastName) && payload.customerName) {
      const parts = String(payload.customerName).trim().split(/\s+/);
      if (!firstName) firstName = parts[0] ?? '';
      if (!lastName) lastName = parts.slice(1).join(' ');
    }

    // Flat keys for backward compat
    ctx.first_name = firstName;
    ctx.last_name = lastName;
    ctx.email = String(contact.email ?? '');
    ctx.phone = phoneStr;
    ctx.lifecycle_status = String(contact.lifecycleStatus ?? '');
    ctx.total_orders = Number(contact.totalOrders ?? 0);
    ctx.lifetime_value = Number(contact.lifetimeValue ?? 0);

    // Flat custom fields
    if (contact.customFields && typeof contact.customFields === 'object') {
      for (const [key, value] of Object.entries(contact.customFields as Record<string, unknown>)) {
        ctx[key] = value as string | number | boolean | null;
      }
    }

    // Nested {{customer.*}} — payload overrides contact for lastOrderDate/daysSinceOrder
    ctx.customer = {
      first_name: firstName,
      last_name: lastName,
      email: String(contact.email ?? ''),
      phone: phoneStr,
      last_order_date: payload.lastOrderDate
        ? String(payload.lastOrderDate)
        : contact.lastOrderAt
          ? new Date(contact.lastOrderAt as string).toLocaleDateString()
          : '',
      days_since_order: payload.daysSinceOrder !== undefined
        ? Number(payload.daysSinceOrder)
        : (() => {
            if (!contact.lastOrderAt) return '';
            const ms = Date.now() - new Date(contact.lastOrderAt as string).getTime();
            return Math.floor(ms / 86_400_000);
          })(),
    };
  }

  // ── Restaurant fields ─────────────────────────────────────────────
  if (restaurant) {
    ctx.restaurant_name = String(restaurant.name ?? '');
    ctx.restaurant_phone = String(restaurant.phone ?? '');
    ctx.restaurant_email = String(restaurant.email ?? '');

    ctx.restaurant = {
      name: String(restaurant.name ?? ''),
      phone: String(restaurant.phone ?? ''),
      email: String(restaurant.email ?? ''),
    };
  }

  // ── Order fields (from trigger payload) ───────────────────────────
  if (payload.orderId || payload.orderTotal !== undefined || payload.orderNumber) {
    let itemsSummary = formatItems(payload.items);

    // If items not in payload but orderId exists, look up from DB
    if (!itemsSummary && payload.orderId) {
      try {
        const { Order } = await import('../domain/models/external/Order.js');
        const order = await Order.findById(payload.orderId).lean().exec();
        if (order?.items) {
          itemsSummary = formatItems(order.items);
        }
      } catch {
        // DB lookup failed — leave items_summary empty
      }
    }

    ctx.order_total = Number(payload.orderTotal ?? 0);
    ctx.order_number = String(payload.orderNumber ?? '');
    ctx.order_type = String(payload.orderType ?? '');

    ctx.order = {
      total: Number(payload.orderTotal ?? 0),
      number: String(payload.orderNumber ?? ''),
      type: String(payload.orderType ?? ''),
      items_summary: itemsSummary,
      date: new Date().toLocaleDateString(),
      status: String(payload.newStatus ?? payload.status ?? ''),
    };
  }

  // ── Payment fields (from trigger payload) ────────────────────────
  if (payload.paymentStatus || payload.failureReason) {
    ctx.payment = {
      status: String(payload.paymentStatus ?? ''),
      failure_reason: String(payload.failureReason ?? ''),
    };
  }

  // ── Cart fields (from trigger payload) ───────────────────────────
  if (payload.cartTotal !== undefined || payload.cartItems || payload.abandonTime) {
    ctx.cart = {
      total: Number(payload.cartTotal ?? 0),
      items_summary: formatItems(payload.cartItems),
      abandon_time: String(payload.abandonTime ?? ''),
    };
  }

  return ctx;
}
