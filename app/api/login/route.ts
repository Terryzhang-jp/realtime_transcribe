import { NextRequest, NextResponse } from 'next/server';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
} from '@/lib/auth/session';

interface LoginRequest {
  answerOne?: string;
  answerTwo?: string;
}

function normalizeAnswerOne(input?: string): string {
  return (input ?? '').trim().toLowerCase();
}

function normalizeAnswerTwo(input?: string): string {
  return (input ?? '').trim();
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as LoginRequest;
  const answerOne = normalizeAnswerOne(body.answerOne);
  const answerTwo = normalizeAnswerTwo(body.answerTwo);

  const isAnswerOneCorrect = answerOne === 'terry';
  const isAnswerTwoCorrect = answerTwo === '不会';

  if (!isAnswerOneCorrect || !isAnswerTwoCorrect) {
    const response = NextResponse.json(
      {
        success: false,
        error: '回答不正确，请再试一次。',
      },
      { status: 401 }
    );
    response.cookies.set(buildClearedSessionCookie());
    return response;
  }

  const token = createSessionToken();
  const response = NextResponse.json({ success: true });
  response.cookies.set(buildSessionCookie(token));
  return response;
}
