/**
 * @fileoverview Tenancy middleware — extracts restaurantId from X-Restaurant-Id header.
 *
 * Also validates that the authenticated user has access to the restaurant
 * by checking the UserRestaurant collection, and that they have the
 * `marketing` permission via RolePermissions.
 *
 * @module api/middleware/tenancy
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRestaurant } from '../../domain/models/external/UserRestaurant.js';
import { RolePermissions } from '../../domain/models/external/RolePermissions.js';

declare module 'fastify' {
  interface FastifyRequest {
    restaurantId: string;
  }
}

/**
 * Fastify preHandler hook that validates tenant access.
 */
export async function tenancyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const restaurantId = request.headers['x-restaurant-id'] as string | undefined;

  if (!restaurantId) {
    reply.code(400).send({ error: 'Missing X-Restaurant-Id header' });
    return;
  }

  // Validate user has access to this restaurant
  const userId = request.user?.id;
  if (!userId) {
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }

  const userRestaurant = await UserRestaurant.findOne({
    userId,
    restaurantId,
  }).lean().exec();

  if (!userRestaurant) {
    reply.code(403).send({ error: 'No access to this restaurant' });
    return;
  }

  // Check marketing permission via role
  const role = userRestaurant.role;
  if (role !== 'owner') {
    const permissions = await RolePermissions.findOne({
      restaurantId,
      role,
    }).lean().exec();

    if (!permissions?.marketing) {
      reply.code(403).send({ error: 'Marketing permission required for CRM access' });
      return;
    }
  }

  request.restaurantId = restaurantId;
}
