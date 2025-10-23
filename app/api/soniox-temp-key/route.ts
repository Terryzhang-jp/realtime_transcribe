import { NextRequest, NextResponse } from 'next/server';
import {
  verifySessionToken,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const session = verifySessionToken(sessionToken);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const apiKey = process.env.SONIOX_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'SONIOX_API_KEY not configured' },
        { status: 500 }
      );
    }

    const response = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: 300, // 5 分钟有效
        client_reference_id: 'web-live-stt'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to get temporary API key:', errorText);
      return NextResponse.json(
        { error: 'Failed to get temporary API key' },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      apiKey: data.api_key,
      expiresAt: data.expires_at
    });
  } catch (error) {
    console.error('Error in soniox-temp-key route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
