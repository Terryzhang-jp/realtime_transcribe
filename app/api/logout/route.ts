import { NextResponse } from 'next/server';
import { buildClearedSessionCookie } from '@/lib/auth/session';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(buildClearedSessionCookie());
  return response;
}
