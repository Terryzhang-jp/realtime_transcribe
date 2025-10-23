// AI 文本平滑服务
// 使用 LLM 优化转写文本，修正错别字、删除重复、提升流畅度

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export interface SmoothTextOptions {
  text: string;
  language?: 'zh' | 'en' | 'ja' | 'auto';
}

export interface SmoothTextResult {
  smoothedText: string;
  original: string;
}

/**
 * 使用 GPT-5-nano 优化转写文本
 * - 修正错别字和语法错误
 * - 删除重复的词句
 * - 提升文本流畅度和可读性
 * - 保留原意，不添加额外内容
 */
export async function smoothTranscriptionText(
  options: SmoothTextOptions
): Promise<SmoothTextResult> {
  const { text, language = 'auto' } = options;

  if (!text || text.trim().length === 0) {
    return {
      smoothedText: '',
      original: text,
    };
  }

  try {
    const languageInstruction = language === 'auto'
      ? '自动检测语言'
      : language === 'zh'
      ? '中文'
      : language === 'en'
      ? 'English'
      : '日本語';

    const result = await generateText({
      model: openai('gpt-5-nano-2025-08-07'),
      prompt: `你是一个专业的语音转写文本优化助手。你的任务是优化语音转写的文本，使其更加流畅和易读。

原始转写文本（${languageInstruction}）：
"""
${text}
"""

请按照以下规则优化文本：
1. 修正明显的错别字和语法错误
2. 删除重复的词语或句子
3. 调整标点符号使其更符合书面语习惯
4. 保持原文的意思和语气，不要添加、删除或改变原意
5. 保持原文的语言（中文/英文/日文）
6. 如果文本已经很流畅，只需稍作调整或保持原样

请直接输出优化后的文本，不要添加任何解释或说明。`,
    });

    return {
      smoothedText: result.text.trim(),
      original: text,
    };
  } catch (error) {
    console.error('Failed to smooth text:', error);
    // 如果失败，返回原文
    return {
      smoothedText: text,
      original: text,
    };
  }
}

/**
 * 批量平滑多段文本
 */
export async function smoothMultipleTexts(
  texts: string[],
  language?: 'zh' | 'en' | 'ja' | 'auto'
): Promise<SmoothTextResult[]> {
  const results = await Promise.all(
    texts.map(text => smoothTranscriptionText({ text, language }))
  );
  return results;
}
