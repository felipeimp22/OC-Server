/**
 * @fileoverview Contact Service — business logic for CRM contacts.
 *
 * Handles:
 * - Syncing contacts from OrderChop Customer events
 * - Contact CRUD
 * - Tag management
 * - Custom field updates
 * - Lifecycle status queries
 *
 * @module services/ContactService
 */

import { ContactRepository } from '../repositories/ContactRepository.js';
import { TagRepository } from '../repositories/TagRepository.js';
import type { IContactDocument } from '../domain/models/crm/Contact.js';
import type { IPaginationOptions, IPaginatedResult } from '../domain/interfaces/IRepository.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('ContactService');

export class ContactService {
  private readonly contactRepo: ContactRepository;
  private readonly tagRepo: TagRepository;

  constructor() {
    this.contactRepo = new ContactRepository();
    this.tagRepo = new TagRepository();
  }

  /**
   * Upsert a contact from a customer event (customer.created / customer.updated).
   * Sets lifecycleStatus: 'lead' only on creation, never overwrites it on updates.
   *
   * @param restaurantId - Tenant ID
   * @param customerData - Data from the customer event payload
   * @returns The upserted CRM contact
   */
  async upsertFromCustomer(
    restaurantId: string,
    customerData: {
      customerId: string;
      name: string;
      email: string;
      phone?: { countryCode: string; number: string } | null;
    },
  ): Promise<IContactDocument> {
    const [firstName, ...lastParts] = customerData.name.split(' ');
    const lastName = lastParts.join(' ');

    const contact = await this.contactRepo.upsertByCustomerId(
      restaurantId,
      customerData.customerId,
      {
        email: customerData.email,
        firstName: firstName ?? '',
        lastName,
        phone: customerData.phone ?? null,
      } as Partial<IContactDocument>,
      { lifecycleStatus: 'lead' } as Partial<IContactDocument>,
    );

    log.info(
      { restaurantId, contactId: contact._id, customerId: customerData.customerId },
      'Contact upserted from customer event',
    );

    return contact;
  }

  /**
   * Find a contact by their OrderChop customer ID.
   * Returns null if not found or if wrong tenant.
   */
  async findByCustomerId(
    restaurantId: string,
    customerId: string,
  ): Promise<IContactDocument | null> {
    return this.contactRepo.findByCustomerId(restaurantId, customerId);
  }

  /**
   * Sync a contact from an OrderChop Customer event.
   * Creates or updates the CRM contact with data from the Customer collection.
   *
   * @param restaurantId - Tenant ID
   * @param customerData - Data from the customer.created/updated event payload
   * @returns The upserted CRM contact
   */
  async syncFromCustomer(
    restaurantId: string,
    customerData: {
      customerId: string;
      name: string;
      email: string;
      phone?: { countryCode: string; number: string } | null;
    },
  ): Promise<IContactDocument> {
    const [firstName, ...lastParts] = customerData.name.split(' ');
    const lastName = lastParts.join(' ');

    const contact = await this.contactRepo.upsertByCustomerId(
      restaurantId,
      customerData.customerId,
      {
        email: customerData.email,
        firstName: firstName ?? '',
        lastName,
        phone: customerData.phone ?? null,
      } as Partial<IContactDocument>,
    );

    log.info(
      { restaurantId, contactId: contact._id, customerId: customerData.customerId },
      'Contact synced from customer',
    );

    return contact;
  }

  /**
   * Upsert a contact from an order event payload.
   * Creates the contact if they do not yet exist in the CRM.
   *
   * @param restaurantId - Tenant ID
   * @param payload - Order event payload (must contain customerId; optionally name/email)
   * @returns The upserted CRM contact
   */
  async upsertFromEvent(
    restaurantId: string,
    payload: { customerId: string; name?: string; email?: string },
  ): Promise<IContactDocument> {
    const data: Partial<IContactDocument> = {};
    if (payload.name) {
      const [firstName, ...lastParts] = payload.name.split(' ');
      data.firstName = firstName ?? '';
      data.lastName = lastParts.join(' ');
    }
    if (payload.email) data.email = payload.email;

    const contact = await this.contactRepo.upsertByCustomerId(restaurantId, payload.customerId, data);
    log.info({ restaurantId, contactId: contact._id, customerId: payload.customerId }, 'Contact upserted from event');
    return contact;
  }

  /**
   * Increment order stats after a completed order.
   */
  async incrementOrderStats(
    restaurantId: string,
    contactId: string,
    orderTotal: number,
  ): Promise<IContactDocument | null> {
    return this.recordOrder(restaurantId, contactId, orderTotal);
  }

  /**
   * Update contact order stats after a completed order.
   */
  async recordOrder(
    restaurantId: string,
    contactId: string,
    orderTotal: number,
  ): Promise<IContactDocument | null> {
    const contact = await this.contactRepo.incrementOrderStats(restaurantId, contactId, orderTotal);
    if (contact) {
      log.info(
        { restaurantId, contactId, orderTotal, totalOrders: contact.totalOrders },
        'Contact order stats updated',
      );
    }
    return contact;
  }

  /**
   * Get a contact by ID.
   */
  async getById(
    restaurantId: string,
    contactId: string,
  ): Promise<IContactDocument | null> {
    return this.contactRepo.findById(restaurantId, contactId);
  }

  /**
   * Get a contact by customer ID.
   */
  async getByCustomerId(
    restaurantId: string,
    customerId: string,
  ): Promise<IContactDocument | null> {
    return this.contactRepo.findByCustomerId(restaurantId, customerId);
  }

  /**
   * List contacts with pagination and filtering.
   */
  async list(
    restaurantId: string,
    filters: Record<string, unknown> = {},
    pagination?: IPaginationOptions,
  ): Promise<IPaginatedResult<IContactDocument>> {
    return this.contactRepo.findPaginated(restaurantId, filters, pagination);
  }

  /**
   * Update a contact's fields.
   */
  async update(
    restaurantId: string,
    contactId: string,
    data: Partial<IContactDocument>,
  ): Promise<IContactDocument | null> {
    return this.contactRepo.updateById(restaurantId, contactId, { $set: data });
  }

  /**
   * Apply a tag to a contact.
   * Also increments the tag's contactCount.
   *
   * @returns Updated contact, or null if not found
   */
  async applyTag(
    restaurantId: string,
    contactId: string,
    tagId: string,
  ): Promise<IContactDocument | null> {
    const contact = await this.contactRepo.applyTag(restaurantId, contactId, tagId);
    if (contact) {
      await this.tagRepo.incrementContactCount(tagId, 1);
      log.info({ restaurantId, contactId, tagId }, 'Tag applied to contact');
    }
    return contact;
  }

  /**
   * Remove a tag from a contact.
   */
  async removeTag(
    restaurantId: string,
    contactId: string,
    tagId: string,
  ): Promise<IContactDocument | null> {
    const contact = await this.contactRepo.removeTag(restaurantId, contactId, tagId);
    if (contact) {
      await this.tagRepo.incrementContactCount(tagId, -1);
      log.info({ restaurantId, contactId, tagId }, 'Tag removed from contact');
    }
    return contact;
  }

  /**
   * Get segment counts for the analytics dashboard.
   */
  async getSegmentCounts(restaurantId: string): Promise<Record<string, number>> {
    return this.contactRepo.getSegmentCounts(restaurantId);
  }

  /**
   * Find inactive contacts (for inactivity trigger flows).
   */
  async findInactive(
    restaurantId: string,
    daysSinceLastOrder: number,
  ): Promise<IContactDocument[]> {
    return this.contactRepo.findInactive(restaurantId, daysSinceLastOrder);
  }

  /**
   * Bulk update lifecycle status.
   */
  async bulkUpdateLifecycle(
    restaurantId: string,
    contactIds: string[],
    lifecycleStatus: string,
  ): Promise<number> {
    return this.contactRepo.bulkUpdateLifecycle(restaurantId, contactIds, lifecycleStatus);
  }
}
