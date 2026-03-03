/**
 * @fileoverview Order Event Consumer — handles order and payment events from OrderChop.
 *
 * Topics: orderchop.orders, orderchop.payments
 *
 * @module kafka/consumers/OrderEventConsumer
 */

import type { EachMessagePayload } from 'kafkajs';
import { createConsumer, getProducer } from '../../config/kafka.js';
import { env } from '../../config/env.js';
import { KAFKA_TOPICS } from '../topics.js';
import { ContactService } from '../../services/ContactService.js';
import { TriggerService } from '../../services/TriggerService.js';
import { FlowRepository } from '../../repositories/FlowRepository.js';
import { PrinterSettingsRepository } from '../../repositories/PrinterSettingsRepository.js';
import { PrinterRepository } from '../../repositories/PrinterRepository.js';
import { PrintJobRepository } from '../../repositories/PrintJobRepository.js';
import { ReceiptFormatter } from '../../services/ReceiptFormatter.js';
import { timezoneService } from '../../services/TimezoneService.js';
import { abandonedCartQueue } from './CartEventConsumer.js';
import { tryProcessEvent } from '../../utils/idempotency.js';
import { Order } from '../../domain/models/external/Order.js';
import { Restaurant } from '../../domain/models/external/Restaurant.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('OrderEventConsumer');

/**
 * Statuses that qualify as "order completed" for CRM trigger purposes.
 * When an order reaches any of these statuses via order.status_changed,
 * processOrderAsCompleted() is called (with tryProcessEvent idempotency
 * ensuring it only runs once per order).
 */
const ORDER_COMPLETED_QUALIFYING_STATUSES = ['ready', 'out_for_delivery', 'delivered', 'completed'];

/** Map Order.orderType values to PrinterSettings toggle keys and Printer.orderTypes values */
const ORDER_TYPE_TO_PRINT_SETTING: Record<string, { settingKey: 'printPickup' | 'printDelivery' | 'printDineIn'; printerOrderType: string }> = {
  pickup: { settingKey: 'printPickup', printerOrderType: 'pickup' },
  delivery: { settingKey: 'printDelivery', printerOrderType: 'delivery' },
  dine_in: { settingKey: 'printDineIn', printerOrderType: 'dineIn' },
  dineIn: { settingKey: 'printDineIn', printerOrderType: 'dineIn' },
};

export class OrderEventConsumer {
  private consumer: ReturnType<typeof createConsumer> | null = null;
  private readonly contactService: ContactService;
  private readonly triggerService: TriggerService;
  private readonly flowRepo: FlowRepository;
  private readonly printerSettingsRepo: PrinterSettingsRepository;
  private readonly printerRepo: PrinterRepository;
  private readonly printJobRepo: PrintJobRepository;
  private readonly receiptFormatter: ReceiptFormatter;

  constructor() {
    this.contactService = new ContactService();
    this.triggerService = new TriggerService();
    this.flowRepo = new FlowRepository();
    this.printerSettingsRepo = new PrinterSettingsRepository();
    this.printerRepo = new PrinterRepository();
    this.printJobRepo = new PrintJobRepository();
    this.receiptFormatter = new ReceiptFormatter();
  }

  async start(): Promise<void> {
    this.consumer = createConsumer({ groupId: env.KAFKA_CONSUMER_GROUP });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [KAFKA_TOPICS.ORDERCHOP_ORDERS, KAFKA_TOPICS.ORDERCHOP_PAYMENTS],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (messagePayload: EachMessagePayload) => {
        await this.handleMessage(messagePayload);
      },
    });

    log.info('Order event consumer started');
  }

  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    try {
      const event = JSON.parse(message.value.toString());
      const { eventType, payload } = event;

      // restaurantId is at the top-level of the Kafka message (set by the event bridge
      // from the X-Restaurant-Id header), with payload.restaurantId as fallback
      const restaurantId = (event.restaurantId ?? payload?.restaurantId) as string | undefined;

      // Use the event's own UUID for idempotency; fall back to a synthetic key
      const idempotencyKey: string = event.eventId
        ?? `${topic}:${eventType}:${payload?.orderId ?? message.offset}`;

      const shouldProcess = await tryProcessEvent(idempotencyKey, eventType);
      if (!shouldProcess) {
        log.debug({ idempotencyKey }, 'Duplicate event — skipping');
        return;
      }

      log.info({ eventType, orderId: payload?.orderId }, 'Processing order event');

      switch (eventType) {
        case 'order.created':
        case 'order.confirmed':
          await this.handleOrderEvent(eventType, payload, restaurantId);
          break;

        case 'order.completed':
          await this.handleOrderCompleted(payload, restaurantId);
          break;

        case 'order.cancelled':
          await this.handleOrderEvent('order_cancelled', payload, restaurantId);
          break;

        case 'order.status_changed':
          await this.handleOrderStatusChanged(payload, restaurantId);
          break;

        case 'payment.succeeded':
          await this.handleNewOrder(payload, restaurantId);
          break;


        case 'payment.refunded':
          await this.handleOrderEvent('payment_refunded', payload, restaurantId);
          break;

        default:
          log.debug({ eventType }, 'Unhandled order event type');
      }
    } catch (err) {
      log.error({ err }, 'Error processing order event');
    }
  }

  /**
   * Handle order.completed — delegates to shared processOrderAsCompleted.
   */
  private async handleOrderCompleted(
    payload: Record<string, unknown>,
    eventRestaurantId?: string,
  ): Promise<void> {
    const restaurantId = (eventRestaurantId ?? payload.restaurantId) as string;
    await this.processOrderAsCompleted(payload, restaurantId);
  }

  /**
   * Shared order-completed processing logic.
   *
   * Called from both handleOrderCompleted (order.completed event) and
   * handleOrderStatusChanged (when status reaches a qualifying fulfillment status).
   *
   * Uses tryProcessEvent with a synthetic key 'order_completed_process:${orderId}'
   * to ensure this runs exactly once per order, even if multiple Kafka events fire
   * (e.g., order.status_changed AND order.completed both arrive for the same order).
   */
  private async processOrderAsCompleted(
    payload: Record<string, unknown>,
    restaurantId: string,
  ): Promise<void> {
    const customerId = payload.customerId as string;
    const orderId = payload.orderId as string;

    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'processOrderAsCompleted missing restaurantId or customerId — skipping');
      return;
    }

    // Application-level idempotency: ensure we only process order completion once per order
    const shouldProcess = await tryProcessEvent(
      `order_completed_process:${orderId}`,
      'order_completed_process',
    );
    if (!shouldProcess) {
      log.info({ orderId }, 'Order already processed as completed — skipping duplicate');
      return;
    }

    // Upsert contact from event payload (creates if not yet in CRM)
    const contact = await this.contactService.upsertFromEvent(restaurantId, {
      customerId,
      name: payload.customerName as string | undefined,
      email: payload.customerEmail as string | undefined,
    });

    // Update order stats
    const orderTotal = (payload.orderTotal as number) ?? 0;
    const updatedContact = await this.contactService.incrementOrderStats(
      restaurantId,
      contact._id.toString(),
      orderTotal,
    );

    // Fetch order from DB for items AND paymentStatus fallback (events don't always publish these)
    let items: Array<{ menuItemId: string; name: string; price: number; quantity: number; options: Array<{ name: string; choice: string; priceAdjustment: number }> }> = [];
    let orderDoc: Record<string, any> | null = null;
    if (orderId) {
      try {
        orderDoc = await Order.findById(orderId).lean().exec();
        if (orderDoc?.items && Array.isArray(orderDoc.items)) {
          items = orderDoc.items.map((item: any) => ({
            menuItemId: String(item.menuItemId),
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            options: Array.isArray(item.options) ? item.options.map((opt: any) => ({
              name: opt.name,
              choice: opt.choice,
              priceAdjustment: opt.priceAdjustment ?? 0,
            })) : [],
          }));
        }
        if (items.length === 0) {
          log.warn({ orderId }, 'Order items empty after fetch — item_ordered triggers will not fire');
        }
      } catch (err) {
        log.warn({ err, orderId }, 'Failed to fetch order for trigger context — items and paymentStatus may be missing');
      }
    }

    // Resolve paymentStatus: prefer Kafka payload, fall back to Order document
    const resolvedPaymentStatus = (payload.paymentStatus as string | undefined)
      ?? (orderDoc?.paymentStatus as string | undefined)
      ?? (orderDoc?.payment?.status as string | undefined);
    if (!resolvedPaymentStatus) {
      log.warn({ orderId }, 'paymentStatus could not be resolved from payload or Order document — payment guard will block all triggers');
    }

    const triggerContext = {
      orderId,
      orderNumber: payload.orderNumber as string | undefined,
      customerId,
      customerEmail: payload.customerEmail as string | undefined,
      customerName: payload.customerName as string | undefined,
      customerPhone: payload.customerPhone as string | undefined,
      orderType: payload.orderType as string | undefined,
      orderTotal,
      paymentStatus: resolvedPaymentStatus,
      status: payload.status as string | undefined,
      items,
    };

    // Evaluate order_completed triggers
    await this.triggerService.evaluateTriggers(restaurantId, 'order_completed', contact._id.toString(), triggerContext);

    // First order trigger: fire if this was the customer's very first order
    if (updatedContact && updatedContact.totalOrders === 1) {
      log.info({ restaurantId, customerId }, 'First order detected — firing first_order trigger');
      await this.triggerService.evaluateTriggers(restaurantId, 'first_order', contact._id.toString(), triggerContext);
    }

    // Nth order trigger: fire for every completed order (TriggerService checks config.n against contact's totalOrders)
    if (updatedContact && updatedContact.totalOrders > 1) {
      await this.triggerService.evaluateTriggers(restaurantId, 'nth_order', contact._id.toString(), {
        ...triggerContext,
        totalOrders: updatedContact.totalOrders,
      });
    }

    // Item-ordered trigger: fires on the same order.completed event path when order contains configured menu items
    if (items.length > 0) {
      await this.triggerService.evaluateTriggers(restaurantId, 'item_ordered', contact._id.toString(), triggerContext);

      // Item-ordered X times: cumulative counting trigger — fires exactly at threshold.
      // Shares same item context; TriggerService checks lifetime count via DB aggregation.
      await this.triggerService.evaluateTriggers(restaurantId, 'item_ordered_x_times', contact._id.toString(), {
        ...triggerContext,
        restaurantId,
      });
    }

    // Auto-print: trigger receipt printing for matching printers
    if (orderId) {
      await this.triggerAutoPrint(restaurantId, orderId, triggerContext.orderType);
    }

    // Cancel pending abandoned cart jobs for this order
    if (orderId) {
      await this.cancelAbandonedCartJobs(restaurantId, orderId);
    }
  }

  /**
   * Handle order.status_changed — evaluate order_status_changed triggers.
   */
  private async handleOrderStatusChanged(
    payload: Record<string, unknown>,
    eventRestaurantId?: string,
  ): Promise<void> {
    const restaurantId = (eventRestaurantId ?? payload.restaurantId) as string;
    const customerId = payload.customerId as string;
    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'order.status_changed missing restaurantId or customerId — skipping');
      return;
    }

    // Use upsertFromEvent instead of getByCustomerId — first-time customers
    // placing their first order should still trigger order_status_changed flows
    const contact = await this.contactService.upsertFromEvent(restaurantId, {
      customerId,
      name: payload.customerName as string | undefined,
      email: payload.customerEmail as string | undefined,
    });

    const newStatus = (payload.status ?? payload.newStatus) as string | undefined;

    await this.triggerService.evaluateTriggers(restaurantId, 'order_status_changed', contact._id.toString(), {
      orderId: payload.orderId as string | undefined,
      orderNumber: payload.orderNumber as string | undefined,
      customerId,
      customerEmail: payload.customerEmail as string | undefined,
      customerName: payload.customerName as string | undefined,
      customerPhone: payload.customerPhone as string | undefined,
      orderType: payload.orderType as string | undefined,
      orderTotal: payload.orderTotal as number | undefined,
      paymentStatus: payload.paymentStatus as string | undefined,
      newStatus,
      previousStatus: (payload.previousStatus ?? payload.oldStatus) as string | undefined,
    });

    // If the new status qualifies as "order completed", fire processOrderAsCompleted.
    // tryProcessEvent inside ensures this only executes once per order across all qualifying statuses.
    if (newStatus && ORDER_COMPLETED_QUALIFYING_STATUSES.includes(newStatus)) {
      log.info({ orderId: payload.orderId, newStatus }, 'Qualifying fulfillment status — firing processOrderAsCompleted');
      await this.processOrderAsCompleted(payload, restaurantId);
    }
  }

  /**
   * Handle payment.succeeded — evaluate new_order triggers.
   *
   * Uses upsertFromEvent() instead of getByCustomerId() so that first-time
   * customers are created in the CRM before trigger evaluation.
   * Does NOT increment order stats — that only happens in processOrderAsCompleted().
   * Also evaluates payment_succeeded triggers for backward compatibility.
   */
  private async handleNewOrder(
    payload: Record<string, unknown>,
    eventRestaurantId?: string,
  ): Promise<void> {
    const restaurantId = (eventRestaurantId ?? payload.restaurantId) as string;
    const customerId = payload.customerId as string;

    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId }, 'payment.succeeded missing restaurantId or customerId — skipping');
      return;
    }

    // Upsert contact — fixes bug where getByCustomerId() returns null for first-time customers
    const contact = await this.contactService.upsertFromEvent(restaurantId, {
      customerId,
      name: payload.customerName as string | undefined,
      email: payload.customerEmail as string | undefined,
    });

    // Fetch order items from DB for trigger context (events don't publish items)
    const newOrderId = payload.orderId as string | undefined;
    let newOrderItems: Array<{ menuItemId: string; name: string; price: number; quantity: number; options: Array<{ name: string; choice: string; priceAdjustment: number }> }> = [];
    if (newOrderId) {
      try {
        const order = await Order.findById(newOrderId).lean().exec();
        if (order?.items && Array.isArray(order.items)) {
          newOrderItems = order.items.map((item: any) => ({
            menuItemId: String(item.menuItemId),
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            options: Array.isArray(item.options) ? item.options.map((opt: any) => ({
              name: opt.name,
              choice: opt.choice,
              priceAdjustment: opt.priceAdjustment ?? 0,
            })) : [],
          }));
        }
      } catch (err) {
        log.warn({ err, orderId: newOrderId }, 'Failed to fetch order items for new_order trigger context');
      }
    }

    const triggerContext = {
      orderId: newOrderId,
      orderNumber: payload.orderNumber as string | undefined,
      customerId,
      customerEmail: payload.customerEmail as string | undefined,
      customerName: payload.customerName as string | undefined,
      customerPhone: payload.customerPhone as string | undefined,
      orderType: payload.orderType as string | undefined,
      orderTotal: (payload.orderTotal as number) ?? 0,
      paymentStatus: payload.paymentStatus as string | undefined,
      paymentMethod: payload.paymentMethod as string | undefined,
      items: newOrderItems,
    };

    // Evaluate new_order triggers
    await this.triggerService.evaluateTriggers(restaurantId, 'new_order', contact._id.toString(), triggerContext);

    // Backward compatibility: also evaluate payment_succeeded triggers
    await this.triggerService.evaluateTriggers(restaurantId, 'payment_succeeded', contact._id.toString(), triggerContext);

    // Cancel pending abandoned cart jobs for this order (payment = order no longer abandoned)
    const orderId = payload.orderId as string | undefined;
    if (orderId) {
      await this.cancelAbandonedCartJobs(restaurantId, orderId);
    }
  }

  /**
   * Handle generic order events — just evaluate triggers.
   */
  private async handleOrderEvent(
    eventType: string,
    payload: Record<string, unknown>,
    eventRestaurantId?: string,
  ): Promise<void> {
    const restaurantId = (eventRestaurantId ?? payload.restaurantId) as string;
    const customerId = payload.customerId as string;
    if (!restaurantId || !customerId) {
      log.warn({ restaurantId, customerId, eventType }, 'Order event missing restaurantId or customerId — skipping');
      return;
    }

    const contact = await this.contactService.getByCustomerId(restaurantId, customerId);
    if (!contact) return;

    await this.triggerService.evaluateTriggers(restaurantId, eventType, contact._id.toString(), payload);
  }

  /**
   * Auto-print: create print jobs for matching receipt printers and publish to Kafka.
   *
   * Called after order completion. Checks PrinterSettings (enabled + autoPrint + order type toggle),
   * finds enabled receipt printers matching the order type, creates a PrintJob per printer,
   * formats the receipt HTML, and publishes to the print.jobs Kafka topic.
   *
   * Failures here do NOT affect the order flow — printing is best-effort.
   */
  private async triggerAutoPrint(
    restaurantId: string,
    orderId: string,
    orderType?: string,
  ): Promise<void> {
    try {
      // 1. Load PrinterSettings — skip silently if not configured
      const settings = await this.printerSettingsRepo.findByRestaurant(restaurantId);
      if (!settings || !settings.enabled || !settings.autoPrint) {
        log.debug({ restaurantId }, 'Auto-print skipped — printing not enabled or autoPrint off');
        return;
      }

      // 2. Check order type against print settings
      const typeMapping = orderType ? ORDER_TYPE_TO_PRINT_SETTING[orderType] : undefined;
      if (!typeMapping) {
        log.info({ restaurantId, orderType }, 'Auto-print skipped — unknown order type');
        return;
      }
      if (!settings[typeMapping.settingKey]) {
        log.debug({ restaurantId, orderType, settingKey: typeMapping.settingKey }, 'Auto-print skipped — order type not enabled in print settings');
        return;
      }

      // 3. Find enabled receipt printers matching the order type
      const printers = await this.printerRepo.findEnabledByRestaurantAndOrderType(
        restaurantId,
        typeMapping.printerOrderType,
      );
      // Filter to receipt-type printers only (kitchen printers handled separately in US-012)
      const receiptPrinters = printers.filter((p) => p.type === 'receipt');
      if (receiptPrinters.length === 0) {
        log.info({ restaurantId, orderType }, 'Auto-print skipped — no enabled receipt printers for order type');
        return;
      }

      // 4. Load order and restaurant data for receipt formatting
      const [orderDoc, restaurantDoc] = await Promise.all([
        Order.findById(orderId).lean().exec(),
        Restaurant.findById(restaurantId).lean().exec(),
      ]);
      if (!orderDoc) {
        log.warn({ restaurantId, orderId }, 'Auto-print skipped — order not found in DB');
        return;
      }
      if (!restaurantDoc) {
        log.warn({ restaurantId, orderId }, 'Auto-print skipped — restaurant not found in DB');
        return;
      }

      // 5. Resolve timezone for receipt timestamps
      const timezone = await timezoneService.getTimezone(restaurantId);

      // 6. Format receipt HTML
      const receiptHtml = this.receiptFormatter.formatCustomerReceipt(
        orderDoc as any,
        restaurantDoc as any,
        timezone,
      );

      // 7. For each matching printer: create PrintJob → publish to Kafka
      const producer = getProducer();
      for (const printer of receiptPrinters) {
        const printerId = printer._id.toString();
        try {
          // Create PrintJob with status 'queued'
          const printJob = await this.printJobRepo.create({
            restaurantId: printer.restaurantId,
            printerId: printer._id,
            orderId: orderDoc._id,
            status: 'queued',
            trigger: 'auto',
            attempts: 0,
            maxAttempts: env.PRINT_MAX_RETRIES ?? 3,
            receiptHtml,
            timezone,
            scheduledAt: new Date(),
          } as any);

          // Publish to print.jobs topic
          await producer.send({
            topic: KAFKA_TOPICS.PRINT_JOBS,
            messages: [
              {
                key: restaurantId,
                value: JSON.stringify({
                  printJobId: printJob._id.toString(),
                  restaurantId,
                  printerId,
                  orderId,
                  trigger: 'auto',
                }),
              },
            ],
          });

          log.info(
            { restaurantId, orderId, printerId, printJobId: printJob._id.toString() },
            'Auto-print job created and published',
          );
        } catch (printerErr) {
          // Individual printer failure — continue with other printers
          log.error({ err: printerErr, restaurantId, orderId, printerId }, 'Failed to create auto-print job for printer');
        }
      }
    } catch (err) {
      // Non-critical: auto-print failure must never block the order flow
      log.error({ err, restaurantId, orderId }, 'Auto-print trigger failed — order flow continues');
    }
  }

  /**
   * Cancel all pending abandoned cart BullMQ jobs for a given orderId.
   *
   * Looks up all active abandoned_cart flows for the restaurant, then removes
   * each deterministic jobId (`abandoned-cart-${orderId}-${flowId}`).
   * BullMQ Queue.remove() is a no-op if the job doesn't exist, so this is safe
   * to call even when no abandoned cart event was ever emitted for the order.
   */
  private async cancelAbandonedCartJobs(restaurantId: string, orderId: string): Promise<void> {
    if (!abandonedCartQueue || !orderId) return;

    try {
      const flows = await this.flowRepo.findActiveByTrigger(restaurantId, 'abandoned_cart');
      if (flows.length === 0) return;

      for (const flow of flows) {
        const flowId = flow._id.toString();
        const jobId = `abandoned-cart-${orderId}-${flowId}`;
        await abandonedCartQueue.remove(jobId);
        log.info({ orderId, flowId, jobId }, 'Cancelled abandoned cart job for orderId=%s, flowId=%s', orderId, flowId);
      }
    } catch (err) {
      // Non-critical: if cancellation fails, AbandonedCartProcessor's order status check
      // provides defense-in-depth by skipping completed orders at processing time
      log.warn({ err, restaurantId, orderId }, 'Failed to cancel abandoned cart jobs — processor will check order status');
    }
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      log.info('Order event consumer stopped');
    }
  }
}
