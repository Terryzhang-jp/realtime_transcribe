import { NextRequest, NextResponse } from 'next/server';
import {
  buildClearedSessionCookie,
  verifySessionToken,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = verifySessionToken(token);

  if (!session) {
    const response = NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
    response.cookies.set(buildClearedSessionCookie());
    return response;
  }

  return NextResponse.json({ authenticated: true });
}
