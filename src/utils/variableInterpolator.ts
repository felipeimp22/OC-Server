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
 * Built from contact, restaurant, and order data before sending.
 */
export interface InterpolationContext {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Regex pattern matching `{{variable_name}}` with optional whitespace.
 * Matches: {{first_name}}, {{ restaurant_name }}, {{order_total}}
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Interpolate template variables in a string.
 *
 * @param template - Template string with `{{variable}}` placeholders
 * @param context - Key-value map of variable values
 * @returns Interpolated string with all recognized variables replaced.
 *          Unrecognized variables are left as-is (for debugging).
 *
 * @example
 * ```ts
 * const result = interpolate(
 *   'Hey {{first_name}}, thanks for ordering from {{restaurant_name}}!',
 *   { first_name: 'Maria', restaurant_name: 'Best Pizza' },
 * );
 * // → 'Hey Maria, thanks for ordering from Best Pizza!'
 * ```
 */
export function interpolate(template: string, context: InterpolationContext): string {
  return template.replace(VARIABLE_PATTERN, (match, variableName: string) => {
    const value = context[variableName];
    if (value === null || value === undefined) {
      return match; // Leave unrecognized/null variables as-is
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
 * @param contact - CRM contact data
 * @param restaurant - Restaurant data
 * @param order - Order data (optional, for order-triggered flows)
 * @param extras - Additional variables (promo_code, review_link, etc.)
 * @returns Flattened context ready for interpolation
 */
export function buildContext(
  contact: Record<string, unknown>,
  restaurant: Record<string, unknown>,
  order?: Record<string, unknown> | null,
  extras?: Record<string, unknown>,
): InterpolationContext {
  const ctx: InterpolationContext = {};

  // Contact fields
  if (contact) {
    ctx.first_name = String(contact.firstName ?? '');
    ctx.last_name = String(contact.lastName ?? '');
    ctx.email = String(contact.email ?? '');
    ctx.lifecycle_status = String(contact.lifecycleStatus ?? '');
    ctx.total_orders = Number(contact.totalOrders ?? 0);
    ctx.lifetime_value = Number(contact.lifetimeValue ?? 0);

    if (contact.phone && typeof contact.phone === 'object') {
      const phone = contact.phone as { countryCode?: string; number?: string };
      ctx.phone = `${phone.countryCode ?? ''}${phone.number ?? ''}`;
    }

    // Include custom fields
    if (contact.customFields && typeof contact.customFields === 'object') {
      for (const [key, value] of Object.entries(contact.customFields as Record<string, unknown>)) {
        ctx[key] = value as string | number | boolean | null;
      }
    }
  }

  // Restaurant fields
  if (restaurant) {
    ctx.restaurant_name = String(restaurant.name ?? '');
    ctx.restaurant_phone = String(restaurant.phone ?? '');
    ctx.restaurant_email = String(restaurant.email ?? '');
  }

  // Order fields
  if (order) {
    ctx.order_total = Number(order.total ?? 0);
    ctx.order_number = String(order.orderNumber ?? '');
    ctx.order_type = String(order.orderType ?? '');
    ctx.order_date = order.createdAt ? new Date(order.createdAt as string).toLocaleDateString() : '';
    ctx.order_subtotal = Number(order.subtotal ?? 0);
  }

  // Extras (promo_code, review_link, unsubscribe_link, etc.)
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      ctx[key] = value as string | number | boolean | null;
    }
  }

  return ctx;
}
