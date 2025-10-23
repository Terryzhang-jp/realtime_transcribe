'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AudioRecorder } from '@/lib/audio/recorder';
import { SonioxWSClient } from '@/lib/soniox/ws-client';
import { extractProgress, isResultMessage, WSState } from '@/lib/soniox/schema';
import type { Language, SonioxMessage } from '@/lib/soniox/schema';

export default function Page() {
  const wsClientRef = useRef<SonioxWSClient | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [answerOne, setAnswerOne] = useState('');
  const [answerTwo, setAnswerTwo] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<Language>('en');
  const [enableTranslation, setEnableTranslation] = useState(true);
  const [enableSpeakerDiarization, setEnableSpeakerDiarization] = useState(true);

  // 转写文本状态 - 使用累加字符串而不是 segments 数组
  const [originalFinalText, setOriginalFinalText] = useState<string>('');
  const [translatedFinalText, setTranslatedFinalText] = useState<string>('');

  // 临时文本（non-final tokens）
  const [originalInterim, setOriginalInterim] = useState<string>('');
  const [translatedInterim, setTranslatedInterim] = useState<string>('');

  // UI 状态
  const [wsState, setWsState] = useState<WSState>(WSState.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [sessionTime, setSessionTime] = useState(0);

  // 会话计时器
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const awaitingFinalizeRef = useRef(false);
  const finalizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answerOne,
          answerTwo,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setIsAuthenticated(false);
        setLoginError(data?.error ?? '回答不正确，请再试一次。');
        return;
      }

      setIsAuthenticated(true);
      setLoginError(null);
      setAnswerOne('');
      setAnswerTwo('');
    } catch (error) {
      console.error('Login request failed:', error);
      setLoginError('登录请求失败，请稍后重试。');
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    fetch('/api/session', { method: 'GET', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) {
          throw new Error('unauthorized');
        }
        return response.json();
      })
      .then(() => {
        if (isMounted) {
          setIsAuthenticated(true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsAuthenticated(false);
        }
      })
      .finally(() => {
        if (isMounted) {
          setSessionChecked(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      // 清理
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
        finalizeTimeoutRef.current = null;
      }
      audioRecorderRef.current?.stop();
      wsClientRef.current?.close();
    };
  }, []);

  const handleStart = async () => {
    try {
      if (!isAuthenticated) {
        setError('请先完成身份验证。');
        return;
      }

      console.log('🚀 Starting transcription...');
      setError(null);
      setOriginalFinalText('');
      setTranslatedFinalText('');
      setOriginalInterim('');
      setTranslatedInterim('');
      setSessionTime(0);
      awaitingFinalizeRef.current = false;
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
        finalizeTimeoutRef.current = null;
      }

      // 1. 获取临时 API Key
      console.log('🔑 Fetching temporary API key...');
      const response = await fetch('/api/soniox-temp-key', { method: 'POST' });
      if (!response.ok) {
        if (response.status === 401) {
          setIsAuthenticated(false);
          setError('登录状态已过期，请重新验证。');
          return;
        }
        throw new Error('Failed to get temporary API key');
      }
      const { apiKey } = await response.json();
      console.log('✅ Got temporary API key');

      // 2. 创建 WebSocket 客户端
      wsClientRef.current = new SonioxWSClient(
        handleMessage,
        handleStateChange,
        handleError
      );

      // 3. 连接 WebSocket
      await wsClientRef.current.connect({
        api_key: apiKey,
        model: 'stt-rt-preview',
        audio_format: 'auto',
        enable_language_identification: true,
        language_hints: ['zh', 'en', 'ja'],
        enable_speaker_diarization: enableSpeakerDiarization,
        ...(enableTranslation && {
          translation: {
            type: 'one_way',
            target_language: targetLang,
          }
        })
      });

      // 4. 启动音频录制
      audioRecorderRef.current = new AudioRecorder();
      await audioRecorderRef.current.start((audioData) => {
        wsClientRef.current?.sendAudio(audioData);
      });

      // 5. 启动会话计时器
      sessionTimerRef.current = setInterval(() => {
        setSessionTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Failed to start:', err);
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
  };

  const handleStop = () => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }

    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }

    audioRecorderRef.current?.stop();
    audioRecorderRef.current = null;

    const client = wsClientRef.current;
    if (!client) {
      return;
    }

    const state = client.getState();
    if (state === WSState.STREAMING || state === WSState.CONNECTED) {
      awaitingFinalizeRef.current = true;
      client.finalize();

      finalizeTimeoutRef.current = setTimeout(() => {
        awaitingFinalizeRef.current = false;
        client.close();
        if (wsClientRef.current === client) {
          wsClientRef.current = null;
        }
        setOriginalInterim('');
        setTranslatedInterim('');
        finalizeTimeoutRef.current = null;
      }, 2000);
    } else {
      client.close();
      if (wsClientRef.current === client) {
        wsClientRef.current = null;
      }
      setOriginalInterim('');
      setTranslatedInterim('');
    }

  };

  const handleMessage = (message: SonioxMessage) => {
    console.log('💬 handleMessage called:', message);

    if ((message as { finished?: boolean }).finished === true) {
      console.log('📦 Stream finished message received.');
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
        finalizeTimeoutRef.current = null;
      }
      awaitingFinalizeRef.current = false;
      setOriginalInterim('');
      setTranslatedInterim('');

      const client = wsClientRef.current;
      if (client) {
        client.close();
        if (wsClientRef.current === client) {
          wsClientRef.current = null;
        }
      }

      return;
    }

    if (isResultMessage(message) && message.tokens.length) {
      console.log('📝 Processing', message.tokens.length, 'tokens');

      // 按照官方示例的方式：直接累加 final tokens
      let originalFinalChunk = '';
      let translatedFinalChunk = '';
      let originalNonFinalText = '';
      let translatedNonFinalText = '';

      for (const token of message.tokens) {
        const isTranslation = token.translation_status === 'translation';
        const isFinal = token.is_final ?? token.final ?? false;
        const tokenText = token.text ?? '';

        if (tokenText.trim() === '<fin>') {
          if (isFinal) {
            if (finalizeTimeoutRef.current) {
              clearTimeout(finalizeTimeoutRef.current);
              finalizeTimeoutRef.current = null;
            }
            awaitingFinalizeRef.current = false;
            setOriginalInterim('');
            setTranslatedInterim('');

            const client = wsClientRef.current;
            if (client) {
              client.close();
              if (wsClientRef.current === client) {
                wsClientRef.current = null;
              }
            }
          }
          continue;
        }

        console.log('🔤 Token:', {
          text: tokenText,
          final: isFinal,
          translation_status: token.translation_status,
        });

        if (isTranslation) {
          if (isFinal) {
            // 翻译的 final token - 直接累加
            console.log('✅ Adding final translated token:', token.text);
            translatedFinalChunk += tokenText;
          } else {
            // 翻译的 non-final token - 收集起来稍后替换
            translatedNonFinalText += tokenText;
          }
        } else {
          if (isFinal) {
            // 原文的 final token - 直接累加
            console.log('✅ Adding final original token:', token.text);
            originalFinalChunk += tokenText;
          } else {
            // 原文的 non-final token - 收集起来稍后替换
            originalNonFinalText += tokenText;
          }
        }
      }

      if (originalFinalChunk) {
        setOriginalFinalText(prev => {
          const newText = prev + originalFinalChunk;
          console.log('📝 Original final text now:', newText);
          return newText;
        });
      }

      if (translatedFinalChunk) {
        setTranslatedFinalText(prev => {
          const newText = prev + translatedFinalChunk;
          console.log('📝 Translated final text now:', newText);
          return newText;
        });
      }

      // 更新 interim 文本（完全替换，不累加）
      if (originalNonFinalText !== originalInterim) {
        console.log('🔄 Updating original interim to:', originalNonFinalText);
        setOriginalInterim(originalNonFinalText);
      }

      if (translatedNonFinalText !== translatedInterim) {
        console.log('🔄 Updating translated interim to:', translatedNonFinalText);
        setTranslatedInterim(translatedNonFinalText);
      }

      return;
    }

    const { audio_final_proc_ms, audio_total_proc_ms } = extractProgress(message);
    if (audio_final_proc_ms != null || audio_total_proc_ms != null) {
      console.log('⏱️ Audio progress:', { audio_final_proc_ms, audio_total_proc_ms });
    }
  };

  const handleStateChange = (newState: WSState) => {
    setWsState(newState);
  };

  const handleError = (err: Error) => {
    setError(err.message);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isRecording = wsState === WSState.STREAMING;

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">加载中...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8 space-y-6 border border-slate-200">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900">转写访问验证</h1>
            <p className="text-sm text-slate-500">
              请回答以下固定问题后继续。
            </p>
          </header>

          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                1. 谁是天下最帅的宝比？
              </label>
              <input
                type="text"
                value={answerOne}
                onChange={(e) => setAnswerOne(e.target.value)}
                disabled={isLoggingIn}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                placeholder="请填写答案"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                2. 以后还跟宝比吵架吗？
              </label>
              <div className="grid grid-cols-2 gap-3">
                {['会', '不会'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAnswerTwo(option)}
                    disabled={isLoggingIn}
                    className={`px-4 py-3 rounded-lg border transition text-sm ${
                      answerTwo === option
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {loginError && (
              <div className="rounded-lg bg-rose-100 border border-rose-200 text-rose-600 px-4 py-3 text-sm">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              确认
            </button>
          </form>

          <footer className="text-xs text-slate-400">
            仅限内部使用，答案固定。
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            实时转写 + 翻译
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            支持中文、英语、日语实时语音转写和翻译
          </p>
          <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm">
            欢迎来到转写服务 Yuxi，祝录制顺利。
          </div>
        </header>

        {/* Controls */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                翻译目标语言
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value as Language)}
                disabled={isRecording}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={enableTranslation}
                  onChange={(e) => setEnableTranslation(e.target.checked)}
                  disabled={isRecording}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  启用翻译
                </span>
              </label>
            </div>

            <div className="flex items-end">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={enableSpeakerDiarization}
                  onChange={(e) => setEnableSpeakerDiarization(e.target.checked)}
                  disabled={isRecording}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  说话人分离
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleStart}
              disabled={isRecording}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-md transition-colors duration-200 disabled:cursor-not-allowed"
            >
              开始录制
            </button>
            <button
              onClick={handleStop}
              disabled={!isRecording}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium rounded-md transition-colors duration-200 disabled:cursor-not-allowed"
            >
              停止录制
            </button>

            {/* Status */}
            <div className="flex items-center gap-4 ml-auto">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-400'
                }`} />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {wsState}
                </span>
              </div>
              {isRecording && (
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {formatTime(sessionTime)}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-200 rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Transcript Display */}
        <div className="space-y-6">
          {/* Original */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <header className="font-semibold text-lg mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
              原文
            </header>
            <div className="p-4 max-h-[600px] overflow-y-auto whitespace-pre-wrap">
              {originalFinalText && (
                <span className="text-gray-900 dark:text-white">
                  {originalFinalText}
                </span>
              )}
              {originalInterim && (
                <span className="text-blue-600 dark:text-blue-400 italic">
                  {originalInterim}
                </span>
              )}
              {!originalFinalText && !originalInterim && (
                <p className="text-gray-400 dark:text-gray-500 italic">
                  等待语音输入...
                </p>
              )}
            </div>
          </section>

          {/* Translation */}
          <section className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <header className="font-semibold text-lg mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
              翻译（{targetLang}）
            </header>
            <div className="p-4 max-h-[600px] overflow-y-auto whitespace-pre-wrap">
              {!enableTranslation && (
                <p className="text-gray-400 dark:text-gray-500 italic">
                  翻译已禁用
                </p>
              )}
              {enableTranslation && (
                <>
                  {translatedFinalText && (
                    <span className="text-gray-900 dark:text-white">
                      {translatedFinalText}
                    </span>
                  )}
                  {translatedInterim && (
                    <span className="text-blue-600 dark:text-blue-400 italic">
                      {translatedInterim}
                    </span>
                  )}
                  {!translatedFinalText && !translatedInterim && (
                    <p className="text-gray-400 dark:text-gray-500 italic">
                      等待翻译...
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
