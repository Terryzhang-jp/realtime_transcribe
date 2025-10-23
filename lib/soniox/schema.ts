// Soniox 类型定义

export type Language = 'zh' | 'en' | 'ja';

export type TranslationType = 'one_way' | 'two_way';

export interface TranslationConfig {
  type: TranslationType;
  target_language?: Language;
  language_a?: Language;
  language_b?: Language;
}

export interface SonioxConfig {
  api_key: string;
  model: string;
  audio_format: 'auto' | 'pcm_s16le' | 'opus';
  enable_language_identification?: boolean;
  language_hints?: Language[];
  enable_speaker_diarization?: boolean;
  translation?: TranslationConfig;
  sample_rate?: number;
}

export type TranslationStatus = 'original' | 'translation';

export interface Token {
  text: string;
  language?: Language;
  speaker?: number;
  start_ms?: number;
  end_ms?: number;
  translation_status?: TranslationStatus;
  /**
   * Soniox uses `is_final` to indicate a stable token.
   * `final` is kept for backward compatibility with older samples.
   */
  is_final?: boolean;
  final?: boolean;
}

export type SonioxMessage = Record<string, unknown>;

export function isResultMessage(message: SonioxMessage): message is SonioxMessage & { tokens: Token[] } {
  return Array.isArray((message as { tokens?: Token[] }).tokens);
}

export function extractProgress(message: SonioxMessage) {
  const cast = message as {
    audio_final_proc_ms?: number;
    final_audio_proc_ms?: number;
    audio_total_proc_ms?: number;
    total_audio_proc_ms?: number;
  };

  const audio_final_proc_ms = cast.audio_final_proc_ms ?? cast.final_audio_proc_ms;
  const audio_total_proc_ms = cast.audio_total_proc_ms ?? cast.total_audio_proc_ms;

  return {
    audio_final_proc_ms,
    audio_total_proc_ms,
  };
}

export interface TranscriptSegment {
  id: string;
  text: string;
  language?: Language;
  speaker?: number;
  timestamp?: number;
  isFinal: boolean;
  translationStatus: TranslationStatus;
}

// 临时 API Key 响应
export interface TempKeyResponse {
  api_key: string;
  expires_at: string;
}

// WebSocket 状态
export enum WSState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  STREAMING = 'STREAMING',
  ERROR = 'ERROR',
  CLOSED = 'CLOSED',
}
