/**
 * @fileoverview ReceiptFormatter — generates HTML receipts for thermal printer output.
 *
 * Produces two formats:
 * - Customer receipts: full order details with pricing, restaurant info, footer
 *   (Star Micronics layout spec: bordered section boxes, 576px table width)
 * - Kitchen tickets: large order number, items with modifiers/instructions only, NO pricing
 *
 * HTML uses inline CSS only (email rendering). Monospace font for alignment.
 * Width: 576px (80mm at 180dpi) for customer receipts; ~320px for kitchen tickets.
 *
 * @module services/ReceiptFormatter
 */

import type { IOrderDocument, IOrderItem } from '../domain/models/external/Order.js';
import type { IRestaurantDocument } from '../domain/models/external/Restaurant.js';

/** Font size preset type */
export type FontSizePreset = 'small' | 'normal' | 'large';

/** Font size configuration */
interface FontSizes {
  body: number;
  header: number;
  section: number;
}

/** Font size presets (in px) */
const FONT_SIZE_MAP: Record<FontSizePreset, FontSizes> = {
  small: { body: 10, header: 22, section: 13 },
  normal: { body: 12, header: 28, section: 16 },
  large: { body: 14, header: 34, section: 19 },
};

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
 * Format just the date portion in the given timezone.
 */
function formatDateOnly(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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
 * Format an order item's modifiers/options as a string (used by kitchen tickets).
 */
function formatModifiers(item: IOrderItem): string {
  if (!item.options || item.options.length === 0) return '';
  return item.options
    .map((opt) => `  ${opt.name}: ${opt.choice}`)
    .join('<br/>');
}

/**
 * Strip HTML tags from a string to prevent injection from dynamic content.
 */
function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

/**
 * Build a bordered box cell for the receipt table.
 */
function borderedBox(content: string, padding = 8): string {
  return `<tr><td style="border: 1px solid #000; padding: ${padding}px;">${content}</td></tr>`;
}

/**
 * Build a spacer row.
 */
function spacerRow(height = 8): string {
  return `<tr><td style="height: ${height}px;"></td></tr>`;
}

/**
 * Render a totals line as a mini table row (label left, value right).
 */
function totalsLine(label: string, value: string, fontSize: string): string {
  return `<table style="width: 100%; border-collapse: collapse;"><tr>
    <td style="font-size: ${fontSize}; padding: 2px 0;">${escapeHtml(label)}</td>
    <td style="font-size: ${fontSize}; padding: 2px 0; text-align: right;">${value}</td>
  </tr></table>`;
}

/**
 * Extract a readable address string from an order's customerAddress field.
 */
function extractAddress(order: IOrderDocument): string {
  const addr = order.customerAddress;
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  const parts: string[] = [];
  if (addr.street || addr.line1) parts.push(String(addr.street || addr.line1));
  if (addr.line2) parts.push(String(addr.line2));
  if (addr.city) parts.push(String(addr.city));
  if (addr.state) parts.push(String(addr.state));
  if (addr.zip || addr.zipCode || addr.postalCode) parts.push(String(addr.zip || addr.zipCode || addr.postalCode));
  return parts.join(', ');
}

/** Kitchen ticket inline styles (320px max width) */
const KITCHEN_STYLES = `
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
   * Generate an HTML customer receipt matching the Star Micronics layout spec.
   *
   * Layout: 576px single-column table with bordered section boxes.
   * Sections: Header → Order Type → Service Date → Customer Info → Items → Totals → Payment Footer.
   */
  formatCustomerReceipt(
    order: IOrderDocument,
    restaurant: IRestaurantDocument,
    timezone: string,
    fontSize: FontSizePreset = 'normal',
  ): string {
    const sizes = FONT_SIZE_MAP[fontSize] || FONT_SIZE_MAP.normal;
    const currencySymbol = (order as any).currencySymbol ?? '$';
    const orderTypeLabel = orderTypeBadge(order.orderType);

    // Derived sizes
    const bodyPx = `${sizes.body}px`;
    const headerPx = `${sizes.header}px`;
    const sectionPx = `${sizes.section}px`;
    const orderTypePx = `${sizes.body * 2}px`;
    const totalPx = `${Math.round(sizes.body * 1.3)}px`;
    const smallPx = `${Math.round(sizes.body * 0.85)}px`;

    // --- Section 1: Header ---
    const headerSection = `
      <tr><td style="text-align: center; padding: 12px 8px;">
        <div style="font-size: ${headerPx}; font-weight: bold; letter-spacing: 1px;">${escapeHtml(restaurant.name)}</div>
        <div style="font-size: ${bodyPx}; margin-top: 6px;">Order ID: #${escapeHtml(order.orderNumber)}</div>
        <div style="font-size: ${smallPx}; margin-top: 4px; color: #333;">${formatTimestamp(order.createdAt, timezone)}</div>
      </td></tr>
    `;

    // --- Section 2: Order Type Box ---
    const orderTypeBox = borderedBox(
      `<div style="text-align: center; font-size: ${orderTypePx}; font-weight: bold; letter-spacing: 2px;">${orderTypeLabel}</div>`,
    );

    // --- Section 3: Service Date Box ---
    const serviceDateStr = formatDateOnly(order.createdAt, timezone);
    const serviceDateBox = borderedBox(
      `<div style="font-size: ${sectionPx};">
        <div style="font-weight: normal; margin-bottom: 4px;">Service Date</div>
        <div style="font-weight: bold;">${serviceDateStr} | ASAP</div>
      </div>`,
    );

    // --- Section 4: Customer Info Box ---
    const address = extractAddress(order);
    const customerInfoBox = borderedBox(
      `<div style="font-size: ${bodyPx}; line-height: 1.6;">
        <div>Name: <strong>${escapeHtml(order.customerName)}</strong></div>
        <div>Phone: <strong>${escapeHtml(order.customerPhone)}</strong></div>
        <div>Email: <strong>${escapeHtml(order.customerEmail)}</strong></div>
        <div>Address: <strong>${address ? escapeHtml(address) : ''}</strong></div>
      </div>`,
    );

    // --- Section 5: Items ---
    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

    const itemRows = order.items
      .map((item) => {
        let row = `
          <tr>
            <td colspan="2" style="padding: 6px 0; border-bottom: 1px solid #ccc;">
              <table style="width: 100%; border-collapse: collapse;"><tr>
                <td style="font-size: ${bodyPx}; vertical-align: top;">${item.quantity} X&nbsp;&nbsp;${escapeHtml(item.name)}</td>
                <td style="font-size: ${bodyPx}; vertical-align: top; text-align: right; white-space: nowrap;">${formatMoney(item.price * item.quantity, currencySymbol)}</td>
              </tr></table>`;

        // Modifiers
        if (item.options && item.options.length > 0) {
          for (const opt of item.options) {
            const modLabel = `${opt.name}: ${opt.choice}`;
            const modPrice = opt.priceAdjustment && opt.priceAdjustment !== 0
              ? ` ${formatMoney(opt.priceAdjustment, currencySymbol)}`
              : '';
            const qty = opt.quantity ?? 1;
            row += `
              <div style="font-size: ${smallPx}; padding-left: 24px; color: #333;">
                &nbsp;&nbsp;&nbsp;${qty} X&nbsp;&nbsp;${escapeHtml(stripHtmlTags(modLabel))}${modPrice}
              </div>`;
          }
        }

        // Special instructions
        if (item.specialInstructions) {
          row += `
            <div style="font-size: ${smallPx}; padding-left: 12px; font-style: italic; color: #555; margin-top: 2px;">
              ${escapeHtml(stripHtmlTags(item.specialInstructions))}
            </div>`;
        }

        row += `</td></tr>`;
        return row;
      })
      .join('');

    const itemsSection = `
      <tr><td style="padding: 0;">
        <div style="font-size: ${sectionPx}; font-weight: bold; padding: 8px 0 4px 0; border-bottom: 2px solid #000;">
          ${itemCount} Item${itemCount !== 1 ? 's' : ''}
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          ${itemRows}
        </table>
      </td></tr>
    `;

    // --- Section 6: Totals ---
    const totalsRows: string[] = [];
    totalsRows.push(totalsLine('Subtotal', formatMoney(order.subtotal, currencySymbol), bodyPx));
    totalsRows.push(totalsLine('Tax', formatMoney(order.tax, currencySymbol), bodyPx));

    if (order.deliveryFee > 0) {
      totalsRows.push(totalsLine('Delivery Fee', formatMoney(order.deliveryFee, currencySymbol), bodyPx));
    }
    if (order.platformFee > 0) {
      totalsRows.push(totalsLine('Platform Fee', formatMoney(order.platformFee, currencySymbol), bodyPx));
    }
    if (order.processingFee > 0) {
      totalsRows.push(totalsLine('Processing Fee / CC', formatMoney(order.processingFee, currencySymbol), bodyPx));
    }
    if (order.tip > 0) {
      totalsRows.push(totalsLine('Tip', formatMoney(order.tip, currencySymbol), bodyPx));
    }

    const totalsSection = `
      <tr><td style="padding: 8px 0;">
        ${totalsRows.join('')}
        <hr style="border: none; border-top: 2px solid #000; margin: 8px 0;" />
        <table style="width: 100%; border-collapse: collapse;"><tr>
          <td style="font-size: ${totalPx}; font-weight: bold;">TOTAL</td>
          <td style="font-size: ${totalPx}; font-weight: bold; text-align: right;">${formatMoney(order.total, currencySymbol)}</td>
        </tr></table>
      </td></tr>
    `;

    // --- Section 7: Payment Footer Box ---
    const isPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'succeeded';
    const paymentStatusLabel = isPaid ? 'PAID' : 'PENDING';
    const paymentMethodLabel = escapeHtml(stripHtmlTags(order.paymentMethod || ''));

    const paymentBox = borderedBox(
      `<div style="text-align: center;">
        <div style="font-size: ${orderTypePx}; font-weight: bold; letter-spacing: 2px;">${paymentStatusLabel}</div>
        <div style="font-size: ${bodyPx}; margin-top: 4px;">${paymentMethodLabel.toLowerCase()}</div>
      </div>`,
    );

    // --- Assemble receipt ---
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin: 0; padding: 0; font-family: 'Courier New', Courier, monospace; font-size: ${bodyPx}; line-height: 1.4; color: #000;">
  <table style="width: 576px; border-collapse: collapse; margin: 0 auto;" cellpadding="0" cellspacing="0">
    ${headerSection}
    ${spacerRow(6)}
    ${orderTypeBox}
    ${spacerRow(6)}
    ${serviceDateBox}
    ${spacerRow(6)}
    ${customerInfoBox}
    ${spacerRow(6)}
    ${itemsSection}
    ${totalsSection}
    ${spacerRow(6)}
    ${paymentBox}
    ${spacerRow(12)}
    <tr><td style="text-align: center; font-size: ${smallPx}; color: #555;">Thank you for your order!</td></tr>
  </table>
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
<body style="${KITCHEN_STYLES}">
  ${header}
  ${itemsTable}
  ${timestampSection}
</body>
</html>`;
  }
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

// ── Sample Order Generator ──

/** Options for generating a sample order */
export interface SampleOrderOptions {
  itemCount: number;
  orderType: 'pickup' | 'delivery' | 'dine_in';
  includeModifiers?: boolean;
}

/** Menu item in the sample data pool */
interface SampleMenuItem {
  name: string;
  price: number; // cents
}

/** Sample modifier definition */
interface SampleModifier {
  name: string;
  choice: string;
  priceAdjustment: number; // cents
}

/** Pool of realistic menu items (prices in cents) */
const SAMPLE_MENU_ITEMS: SampleMenuItem[] = [
  { name: 'Cavatelli & Broccoli', price: 1275 },
  { name: 'Parmigiana Sub - Whole', price: 1425 },
  { name: 'Margherita Pizza', price: 1650 },
  { name: 'Caesar Salad', price: 995 },
  { name: 'Chicken Alfredo', price: 1595 },
  { name: 'Mozzarella Sticks', price: 895 },
  { name: 'Grilled Salmon', price: 2195 },
  { name: 'Spaghetti & Meatballs', price: 1495 },
  { name: 'BBQ Chicken Wings (12pc)', price: 1395 },
  { name: 'Garlic Bread', price: 595 },
  { name: 'Mushroom Risotto', price: 1795 },
  { name: 'Turkey Club Sandwich', price: 1295 },
  { name: 'French Onion Soup', price: 895 },
  { name: 'Tiramisu', price: 895 },
  { name: 'Lemonade', price: 395 },
];

/** Pool of realistic modifiers */
const SAMPLE_MODIFIERS: SampleModifier[] = [
  { name: 'Size', choice: 'Whole', priceAdjustment: 0 },
  { name: 'Protein', choice: 'Chicken', priceAdjustment: 300 },
  { name: 'Side', choice: 'Fries', priceAdjustment: 250 },
  { name: 'Dressing', choice: 'Ranch', priceAdjustment: 0 },
  { name: 'Extra Cheese', choice: 'Yes', priceAdjustment: 150 },
  { name: 'Spice Level', choice: 'Medium', priceAdjustment: 0 },
  { name: 'Add Bacon', choice: 'Yes', priceAdjustment: 200 },
];

/**
 * Generate a deterministic sample order for receipt preview.
 *
 * Item selection is based on `itemCount` — same count always produces the same items.
 * Returns a plain object matching the shape `formatCustomerReceipt` expects from IOrderDocument.
 */
export function generateSampleOrder(options: SampleOrderOptions): Record<string, unknown> {
  const { itemCount, orderType, includeModifiers = true } = options;
  const clampedCount = Math.max(1, Math.min(itemCount, SAMPLE_MENU_ITEMS.length));

  // Deterministic item selection: pick first N items from pool
  const items: Array<{
    menuItemId: null;
    name: string;
    price: number;
    quantity: number;
    options: Array<{ name: string; choice: string; priceAdjustment: number; quantity: number }>;
    specialInstructions?: string;
  }> = [];

  let subtotal = 0;

  for (let i = 0; i < clampedCount; i++) {
    const menuItem = SAMPLE_MENU_ITEMS[i];
    // Deterministic quantity: items at even indexes get qty 2, odd get qty 1
    const quantity = i % 3 === 0 && i > 0 ? 2 : 1;

    const itemOptions: Array<{ name: string; choice: string; priceAdjustment: number; quantity: number }> = [];

    // Add modifiers deterministically: items at indexes 0, 2, 4... get a modifier
    if (includeModifiers && i % 2 === 0 && i < SAMPLE_MODIFIERS.length) {
      const mod = SAMPLE_MODIFIERS[i % SAMPLE_MODIFIERS.length];
      itemOptions.push({
        name: mod.name,
        choice: mod.choice,
        priceAdjustment: mod.priceAdjustment,
        quantity: 1,
      });
      subtotal += mod.priceAdjustment * quantity;
    }

    // Add special instructions to item at index 1
    const specialInstructions = i === 1 ? 'No onions please' : undefined;

    subtotal += menuItem.price * quantity;

    items.push({
      menuItemId: null,
      name: menuItem.name,
      price: menuItem.price,
      quantity,
      options: itemOptions,
      ...(specialInstructions ? { specialInstructions } : {}),
    });
  }

  // Calculate fees (all in cents)
  const tax = Math.round(subtotal * 0.07);
  const processingFee = Math.round(subtotal * 0.029) + 30;
  const deliveryFee = orderType === 'delivery' ? 499 : 0;
  const platformFee = 0;
  const tip = Math.round(subtotal * 0.18); // 18% tip
  const total = subtotal + tax + processingFee + deliveryFee + platformFee + tip;

  return {
    _id: 'preview-order',
    orderNumber: 'PREVIEW-1234',
    customerId: null,
    customerName: 'Jane Smith',
    customerEmail: 'jane.smith@example.com',
    customerPhone: '(555) 867-5309',
    customerAddress:
      orderType === 'delivery'
        ? { street: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', zip: '62704' }
        : null,
    items,
    orderType,
    status: 'completed',
    paymentStatus: 'paid',
    paymentMethod: 'stripe',
    subtotal,
    tax,
    tip,
    driverTip: 0,
    deliveryFee,
    platformFee,
    processingFee,
    total,
    createdAt: new Date(),
    updatedAt: new Date(),
    currencySymbol: '$',
  };
}
