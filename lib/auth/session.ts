import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'rt_auth';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

interface SessionPayload {
  issuedAt: number;
}

const ENCODING = 'base64url';

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not configured.');
  }
  return secret;
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString(ENCODING);
}

function decodePayload(encoded: string): SessionPayload | null {
  try {
    const json = Buffer.from(encoded, ENCODING).toString('utf8');
    const data = JSON.parse(json) as SessionPayload;
    if (typeof data.issuedAt !== 'number') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(encodedPayload)
    .digest(ENCODING);
}

export function createSessionToken(): string {
  const payload: SessionPayload = {
    issuedAt: Date.now(),
  };
  const encoded = encodePayload(payload);
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) {
    return null;
  }

  const expectedSignature = sign(encoded);
  const signatureBuffer = Buffer.from(signature, ENCODING);
  const expectedBuffer = Buffer.from(expectedSignature, ENCODING);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  const payload = decodePayload(encoded);
  if (!payload) {
    return null;
  }

  const age = Date.now() - payload.issuedAt;
  if (age > SESSION_MAX_AGE_SECONDS * 1000) {
    return null;
  }

  return payload;
}

export function buildSessionCookie(token: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function buildClearedSessionCookie() {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    path: '/',
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  };
}
