// API endpoint for text smoothing using GPT-5-nano
import { NextRequest, NextResponse } from 'next/server';
import { smoothTranscriptionText } from '@/lib/ai/text-smoother';
import { cookies } from 'next/headers';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    // 验证用户登录状态
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session');

    if (!sessionCookie?.value || sessionCookie.value !== 'authenticated') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { text, language } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // 调用 AI 文本平滑服务
    const result = await smoothTranscriptionText({
      text,
      language: language || 'auto',
    });

    return NextResponse.json({
      smoothedText: result.smoothedText,
      original: result.original,
    });
  } catch (error) {
    console.error('Text smoothing error:', error);
    return NextResponse.json(
      { error: 'Failed to smooth text' },
      { status: 500 }
    );
  }
}
