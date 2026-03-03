/**
 * @fileoverview ReceiptFormatter — generates HTML receipts for thermal printer output.
 *
 * Produces two formats:
 * - Customer receipts: full order details with pricing, restaurant info, footer
 * - Kitchen tickets: large order number, items with modifiers/instructions only, NO pricing
 *
 * HTML uses inline CSS only (email rendering). Monospace font for alignment.
 * Width optimized for ~80mm thermal paper (~42 characters per line).
 *
 * @module services/ReceiptFormatter
 */

import type { IOrderDocument, IOrderItem } from '../domain/models/external/Order.js';
import type { IRestaurantDocument } from '../domain/models/external/Restaurant.js';

/**
 * Format cents to a dollar string (e.g. 1250 → "12.50").
 */
function formatMoney(cents: number, currencySymbol = '$'): string {
  return `${currencySymbol}${(cents / 100).toFixed(2)}`;
}

/**
 * Format a Date in the given IANA timezone.
 */
function formatTimestamp(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Get a human-readable order type badge label.
 */
function orderTypeBadge(orderType: string): string {
  switch (orderType) {
    case 'pickup':
      return 'PICKUP';
    case 'delivery':
      return 'DELIVERY';
    case 'dine_in':
    case 'dineIn':
      return 'DINE-IN';
    default:
      return orderType.toUpperCase();
  }
}

/**
 * Format an order item's modifiers/options as a string.
 */
function formatModifiers(item: IOrderItem): string {
  if (!item.options || item.options.length === 0) return '';
  return item.options
    .map((opt) => `  ${opt.name}: ${opt.choice}`)
    .join('<br/>');
}

/**
 * Shared inline styles for receipt HTML.
 */
const BASE_STYLES = `
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  line-height: 1.4;
  color: #000;
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  padding: 8px;
`.replace(/\n/g, '');

const HR = '<hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;" />';

export class ReceiptFormatter {
  /**
   * Generate an HTML customer receipt.
   *
   * Content: restaurant header, order number/type, customer name, items with
   * quantities and modifiers, pricing breakdown, payment status, special
   * instructions, timestamp, and footer.
   */
  formatCustomerReceipt(
    order: IOrderDocument,
    restaurant: IRestaurantDocument,
    timezone: string,
  ): string {
    const currencySymbol = (order as any).currencySymbol ?? '$';

    // --- Header ---
    const header = `
      <div style="text-align: center; margin-bottom: 8px;">
        <div style="font-size: 16px; font-weight: bold;">${escapeHtml(restaurant.name)}</div>
        <div>${escapeHtml(restaurant.street)}</div>
        <div>${escapeHtml(restaurant.city)}, ${escapeHtml(restaurant.state)} ${escapeHtml(restaurant.zipCode)}</div>
        <div>${escapeHtml(restaurant.phone)}</div>
      </div>
    `;

    // --- Order info ---
    const orderInfo = `
      ${HR}
      <div style="text-align: center; margin: 4px 0;">
        <div style="font-size: 14px; font-weight: bold;">Order #${escapeHtml(order.orderNumber)}</div>
        <div style="display: inline-block; padding: 2px 8px; background: #000; color: #fff; font-size: 11px; font-weight: bold; margin-top: 4px;">
          ${orderTypeBadge(order.orderType)}
        </div>
      </div>
    `;

    // --- Customer ---
    const customerSection = order.customerName
      ? `<div style="margin: 4px 0;">Customer: ${escapeHtml(order.customerName)}</div>`
      : '';

    // --- Items ---
    const itemRows = order.items
      .map((item) => {
        const modifiers = formatModifiers(item);
        const instructions = item.specialInstructions
          ? `<br/><span style="font-style: italic;">  Note: ${escapeHtml(item.specialInstructions)}</span>`
          : '';
        return `
          <tr>
            <td style="vertical-align: top; padding: 2px 0;">${item.quantity}x</td>
            <td style="vertical-align: top; padding: 2px 4px;">
              ${escapeHtml(item.name)}${modifiers ? '<br/>' + modifiers : ''}${instructions}
            </td>
            <td style="vertical-align: top; padding: 2px 0; text-align: right;">
              ${formatMoney(item.price * item.quantity, currencySymbol)}
            </td>
          </tr>
        `;
      })
      .join('');

    const itemsTable = `
      ${HR}
      <table style="width: 100%; border-collapse: collapse;">
        ${itemRows}
      </table>
    `;

    // --- Pricing breakdown ---
    const pricingLines: string[] = [];
    pricingLines.push(line('Subtotal', formatMoney(order.subtotal, currencySymbol)));
    pricingLines.push(line('Tax', formatMoney(order.tax, currencySymbol)));

    if (order.deliveryFee > 0) {
      pricingLines.push(line('Delivery Fee', formatMoney(order.deliveryFee, currencySymbol)));
    }
    if (order.platformFee > 0) {
      pricingLines.push(line('Platform Fee', formatMoney(order.platformFee, currencySymbol)));
    }
    if (order.tip > 0) {
      pricingLines.push(line('Tip', formatMoney(order.tip, currencySymbol)));
    }

    const pricingSection = `
      ${HR}
      ${pricingLines.join('')}
      ${HR}
      <div style="font-weight: bold; display: flex; justify-content: space-between;">
        <span>TOTAL</span>
        <span>${formatMoney(order.total, currencySymbol)}</span>
      </div>
    `;

    // --- Payment status ---
    const paymentSection = `
      <div style="margin: 4px 0;">Payment: ${escapeHtml(order.paymentStatus)} (${escapeHtml(order.paymentMethod)})</div>
    `;

    // --- Timestamp ---
    const timestampSection = `
      <div style="margin: 4px 0; font-size: 11px;">
        ${formatTimestamp(order.createdAt, timezone)}
      </div>
    `;

    // --- Footer ---
    const footer = `
      ${HR}
      <div style="text-align: center; margin-top: 8px; font-size: 11px;">
        Thank you for your order!
      </div>
    `;

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="${BASE_STYLES}">
  ${header}
  ${orderInfo}
  ${customerSection}
  ${itemsTable}
  ${pricingSection}
  ${paymentSection}
  ${timestampSection}
  ${footer}
</body>
</html>`;
  }

  /**
   * Generate an HTML kitchen ticket.
   *
   * Content: LARGE order number, order type badge, items with quantities,
   * modifiers, and special instructions only — NO pricing.
   * Timestamp in restaurant timezone.
   */
  formatKitchenTicket(
    order: IOrderDocument,
    restaurant: IRestaurantDocument,
    timezone: string,
  ): string {
    // --- Large order number header ---
    const header = `
      <div style="text-align: center; margin-bottom: 8px;">
        <div style="font-size: 11px;">${escapeHtml(restaurant.name)}</div>
        <div style="font-size: 28px; font-weight: bold; letter-spacing: 2px;">
          #${escapeHtml(order.orderNumber)}
        </div>
        <div style="display: inline-block; padding: 2px 8px; background: #000; color: #fff; font-size: 14px; font-weight: bold; margin-top: 4px;">
          ${orderTypeBadge(order.orderType)}
        </div>
      </div>
    `;

    // --- Items (no pricing) ---
    const itemRows = order.items
      .map((item) => {
        const modifiers = formatModifiers(item);
        const instructions = item.specialInstructions
          ? `<br/><span style="font-weight: bold; text-decoration: underline;">!! ${escapeHtml(item.specialInstructions)}</span>`
          : '';
        return `
          <tr>
            <td style="vertical-align: top; padding: 2px 0; font-size: 14px; font-weight: bold;">${item.quantity}x</td>
            <td style="vertical-align: top; padding: 2px 4px; font-size: 14px;">
              <strong>${escapeHtml(item.name)}</strong>${modifiers ? '<br/>' + modifiers : ''}${instructions}
            </td>
          </tr>
        `;
      })
      .join('');

    const itemsTable = `
      ${HR}
      <table style="width: 100%; border-collapse: collapse;">
        ${itemRows}
      </table>
      ${HR}
    `;

    // --- Timestamp ---
    const timestampSection = `
      <div style="text-align: center; font-size: 11px; margin-top: 4px;">
        ${formatTimestamp(order.createdAt, timezone)}
      </div>
    `;

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="${BASE_STYLES}">
  ${header}
  ${itemsTable}
  ${timestampSection}
</body>
</html>`;
  }
}

/**
 * Helper to render a line with label and value justified.
 */
function line(label: string, value: string): string {
  return `<div style="display: flex; justify-content: space-between;"><span>${label}</span><span>${value}</span></div>`;
}

/**
 * Basic HTML escaping to prevent injection in receipt content.
 */
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
