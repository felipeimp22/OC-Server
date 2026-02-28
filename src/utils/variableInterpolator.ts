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
  return template.replace(VARIABLE_PATTERN, (_match, key: string) => {
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
 * Build a full interpolation context from CRM data sources.
 *
 * Returns both flat keys (for backward compat) and nested keys (for dot-notation templates).
 * Flat: {{first_name}}, {{restaurant_name}}, {{order_total}}
 * Nested: {{customer.first_name}}, {{restaurant.name}}, {{order.total}}
 *
 * @param contact - CRM contact data
 * @param restaurant - Restaurant data
 * @param order - Order data (optional, for order-triggered flows)
 * @param extras - Additional variables (promo_code, review_link, etc.)
 * @returns Context ready for interpolation
 */
export function buildContext(
  contact: Record<string, unknown>,
  restaurant: Record<string, unknown>,
  order?: Record<string, unknown> | null,
  extras?: Record<string, unknown>,
): InterpolationContext {
  const ctx: InterpolationContext = {};

  // Contact fields — flat keys for backward compat
  if (contact) {
    const phoneStr = (() => {
      if (contact.phone && typeof contact.phone === 'object') {
        const phone = contact.phone as { countryCode?: string; number?: string };
        return `${phone.countryCode ?? ''}${phone.number ?? ''}`;
      }
      return '';
    })();

    ctx.first_name = String(contact.firstName ?? '');
    ctx.last_name = String(contact.lastName ?? '');
    ctx.email = String(contact.email ?? '');
    ctx.phone = phoneStr;
    ctx.lifecycle_status = String(contact.lifecycleStatus ?? '');
    ctx.total_orders = Number(contact.totalOrders ?? 0);
    ctx.lifetime_value = Number(contact.lifetimeValue ?? 0);

    // Include custom fields (flat)
    if (contact.customFields && typeof contact.customFields === 'object') {
      for (const [key, value] of Object.entries(contact.customFields as Record<string, unknown>)) {
        ctx[key] = value as string | number | boolean | null;
      }
    }

    // Nested customer object for dot-notation: {{customer.first_name}}
    ctx.customer = {
      first_name: String(contact.firstName ?? ''),
      last_name: String(contact.lastName ?? ''),
      email: String(contact.email ?? ''),
      phone: phoneStr,
      last_order_date: contact.lastOrderAt ? new Date(contact.lastOrderAt as string).toLocaleDateString() : '',
      days_since_order: (() => {
        if (!contact.lastOrderAt) return '';
        const ms = Date.now() - new Date(contact.lastOrderAt as string).getTime();
        return Math.floor(ms / 86_400_000);
      })(),
    };
  }

  // Restaurant fields — flat keys for backward compat
  if (restaurant) {
    ctx.restaurant_name = String(restaurant.name ?? '');
    ctx.restaurant_phone = String(restaurant.phone ?? '');
    ctx.restaurant_email = String(restaurant.email ?? '');

    // Nested restaurant object for dot-notation: {{restaurant.name}}
    ctx.restaurant = {
      name: String(restaurant.name ?? ''),
      owner_name: String(restaurant.ownerName ?? restaurant.owner_name ?? ''),
      phone: String(restaurant.phone ?? ''),
      email: String(restaurant.email ?? ''),
    };
  }

  // Order fields — flat keys for backward compat
  if (order) {
    ctx.order_total = Number(order.total ?? 0);
    ctx.order_number = String(order.orderNumber ?? '');
    ctx.order_type = String(order.orderType ?? '');
    ctx.order_date = order.createdAt ? new Date(order.createdAt as string).toLocaleDateString() : '';
    ctx.order_subtotal = Number(order.subtotal ?? 0);

    // Nested order object for dot-notation: {{order.total}}
    ctx.order = {
      total: Number(order.total ?? 0),
      number: String(order.orderNumber ?? ''),
      items_summary: String(order.itemsSummary ?? ''),
      date: order.createdAt ? new Date(order.createdAt as string).toLocaleDateString() : '',
      status: String(order.status ?? ''),
    };
  }

  // Extras (promo_code, review_link, unsubscribe_link, etc.)
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (key !== 'customer' && key !== 'restaurant' && key !== 'order') {
        ctx[key] = value as string | number | boolean | null;
      }
    }
  }

  return ctx;
}
