/**
 * @fileoverview Auth middleware — verifies NextAuth v5 JWTs using jose.
 *
 * Reads the `Authorization: Bearer <token>` header and verifies it
 * against the shared AUTH_SECRET.
 *
 * @module api/middleware/auth
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../config/env.js';
import { createLogger } from '../../config/logger.js';

const log = createLogger('AuthMiddleware');

export interface JWTUser {
  id: string;
  email: string;
  name?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JWTUser;
  }
}

/**
 * Fastify preHandler hook that verifies Bearer JWT tokens.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    // NextAuth v5 encodes the secret as a UTF-8 TextEncoder key
    const secret = new TextEncoder().encode(env.AUTH_SECRET);

    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    const jwtPayload = payload as JWTPayload & { sub?: string; email?: string; name?: string };

    request.user = {
      id: jwtPayload.sub ?? '',
      email: jwtPayload.email ?? '',
      name: jwtPayload.name,
    };
  } catch (err) {
    log.debug({ err }, 'JWT verification failed');
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}
