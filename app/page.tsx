'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AudioRecorder, type AudioDevice } from '@/lib/audio/recorder';
import { SonioxWSClient } from '@/lib/soniox/ws-client';
import { extractProgress, isResultMessage, WSState } from '@/lib/soniox/schema';
import type { Language, SonioxMessage } from '@/lib/soniox/schema';

// 说话人数据类型定义
type SpeakerData = {
  speaker: number;
  originalFinal: string;
  translatedFinal: string;
  smoothedText: string;
  originalInterim: string;
  translatedInterim: string;
  isSmoothing: boolean;
  lastUpdateTime: number;
};

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

  // 麦克风设备状态
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [devicesLoaded, setDevicesLoaded] = useState(false);

  // AI 文本优化状态
  const [enableAISmoothing, setEnableAISmoothing] = useState(false);

  // 说话人分离数据结构
  const [speakerData, setSpeakerData] = useState<Map<number, SpeakerData>>(new Map());
  const lastSmoothedTextRef = useRef<Map<number, string>>(new Map());
  const smoothingTimersRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

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

  const loadAudioDevices = async () => {
    try {
      const devices = await AudioRecorder.getAudioDevices();
      setAudioDevices(devices);
      if (devices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(devices[0].deviceId);
      }
      setDevicesLoaded(true);
    } catch (error) {
      console.error('Failed to load audio devices:', error);
    }
  };

  // 加载音频设备列表
  useEffect(() => {
    if (isAuthenticated && !devicesLoaded) {
      loadAudioDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, devicesLoaded]);

  useEffect(() => {
    const timersMap = smoothingTimersRef.current;
    return () => {
      // 清理
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
        finalizeTimeoutRef.current = null;
      }
      // 清理所有 AI smoothing timers
      timersMap.forEach(timer => clearTimeout(timer));
      timersMap.clear();

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
      setSpeakerData(new Map());
      lastSmoothedTextRef.current = new Map();
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
        audio_format: 'pcm_s16le', // 16-bit PCM, little-endian
        sample_rate: 16000, // 16kHz
        num_channels: 1, // mono
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
      }, selectedDeviceId || undefined);

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
        // 清空所有 speaker 的 interim 文本
        setSpeakerData(prev => {
          const updated = new Map(prev);
          updated.forEach((data, speakerId) => {
            updated.set(speakerId, {
              ...data,
              originalInterim: '',
              translatedInterim: '',
            });
          });
          return updated;
        });
        finalizeTimeoutRef.current = null;
      }, 2000);
    } else {
      client.close();
      if (wsClientRef.current === client) {
        wsClientRef.current = null;
      }
      // 清空所有 speaker 的 interim 文本
      setSpeakerData(prev => {
        const updated = new Map(prev);
        updated.forEach((data, speakerId) => {
          updated.set(speakerId, {
            ...data,
            originalInterim: '',
            translatedInterim: '',
          });
        });
        return updated;
      });
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

      // 清空所有 speaker 的 interim 文本
      setSpeakerData(prev => {
        const updated = new Map(prev);
        updated.forEach((data, speakerId) => {
          updated.set(speakerId, {
            ...data,
            originalInterim: '',
            translatedInterim: '',
          });
        });
        return updated;
      });

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

      // 按 speaker 分组处理 tokens
      // 结构: Map<speakerId, { originalFinal, translatedFinal, originalInterim, translatedInterim }>
      const speakerUpdates = new Map<number, {
        originalFinalChunk: string;
        translatedFinalChunk: string;
        originalInterimText: string;
        translatedInterimText: string;
      }>();

      for (const token of message.tokens) {
        const tokenText = token.text ?? '';
        const speakerId = token.speaker ?? 0;
        const isTranslation = token.translation_status === 'translation';
        const isFinal = token.is_final ?? token.final ?? false;

        // 处理 <fin> 标记
        if (tokenText.trim() === '<fin>') {
          if (isFinal) {
            if (finalizeTimeoutRef.current) {
              clearTimeout(finalizeTimeoutRef.current);
              finalizeTimeoutRef.current = null;
            }
            awaitingFinalizeRef.current = false;
            setSpeakerData(prev => {
              const updated = new Map(prev);
              updated.forEach((data, id) => {
                updated.set(id, {
                  ...data,
                  originalInterim: '',
                  translatedInterim: '',
                });
              });
              return updated;
            });

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

        // 跳过 speaker: 0（未识别的说话人）
        if (speakerId === 0) {
          console.log('⏭️ Skipping token with speaker: 0, waiting for update');
          continue;
        }

        console.log('🔤 Token:', {
          text: tokenText,
          speaker: speakerId,
          final: isFinal,
          translation_status: token.translation_status,
        });

        // 确保该 speaker 在 speakerUpdates 中有条目
        if (!speakerUpdates.has(speakerId)) {
          speakerUpdates.set(speakerId, {
            originalFinalChunk: '',
            translatedFinalChunk: '',
            originalInterimText: '',
            translatedInterimText: '',
          });
        }

        const update = speakerUpdates.get(speakerId)!;

        // 按 translation_status 和 is_final 分类
        if (isTranslation) {
          if (isFinal) {
            update.translatedFinalChunk += tokenText;
            console.log(`✅ Speaker ${speakerId}: Adding final translated token:`, tokenText);
          } else {
            update.translatedInterimText += tokenText;
          }
        } else {
          if (isFinal) {
            update.originalFinalChunk += tokenText;
            console.log(`✅ Speaker ${speakerId}: Adding final original token:`, tokenText);
          } else {
            update.originalInterimText += tokenText;
          }
        }
      }

      // 批量更新所有 speaker 的数据
      if (speakerUpdates.size > 0) {
        setSpeakerData(prev => {
          const updated = new Map(prev);

          speakerUpdates.forEach((update, speakerId) => {
            const existing = updated.get(speakerId) || {
              speaker: speakerId,
              originalFinal: '',
              translatedFinal: '',
              smoothedText: '',
              originalInterim: '',
              translatedInterim: '',
              isSmoothing: false,
              lastUpdateTime: Date.now(),
            };

            updated.set(speakerId, {
              ...existing,
              originalFinal: existing.originalFinal + update.originalFinalChunk,
              translatedFinal: existing.translatedFinal + update.translatedFinalChunk,
              originalInterim: update.originalInterimText,
              translatedInterim: update.translatedInterimText,
              lastUpdateTime: Date.now(),
            });

            console.log(`📝 Speaker ${speakerId} updated:`, {
              originalFinal: updated.get(speakerId)!.originalFinal,
              translatedFinal: updated.get(speakerId)!.translatedFinal,
            });
          });

          return updated;
        });
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

  // AI 文本平滑功能 - 按 speaker 独立处理
  const smoothTextForSpeaker = async (speakerId: number, text: string) => {
    if (!enableAISmoothing || !text || text.trim().length === 0) {
      return;
    }

    console.log(`🤖 Smoothing text for Speaker ${speakerId}...`);

    // 设置该 speaker 的 isSmoothing 状态
    setSpeakerData(prev => {
      const updated = new Map(prev);
      const existing = updated.get(speakerId);
      if (existing) {
        updated.set(speakerId, { ...existing, isSmoothing: true });
      }
      return updated;
    });

    try {
      const response = await fetch('/api/smooth-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          language: 'auto',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to smooth text');
      }

      const data = await response.json();

      // 更新该 speaker 的优化文本
      setSpeakerData(prev => {
        const updated = new Map(prev);
        const existing = updated.get(speakerId);
        if (existing) {
          updated.set(speakerId, {
            ...existing,
            smoothedText: data.smoothedText,
            isSmoothing: false,
          });
        }
        return updated;
      });

      console.log(`✅ Speaker ${speakerId} text smoothed successfully`);
    } catch (err) {
      console.error(`AI smoothing error for Speaker ${speakerId}:`, err);
      // 失败时也要清除 isSmoothing 状态
      setSpeakerData(prev => {
        const updated = new Map(prev);
        const existing = updated.get(speakerId);
        if (existing) {
          updated.set(speakerId, { ...existing, isSmoothing: false });
        }
        return updated;
      });
    }
  };

  // 当启用 AI 优化且 speaker 数据更新时，自动触发平滑
  // 每个 speaker 独立管理自己的 timer，避免互相干扰
  useEffect(() => {
    const timersMap = smoothingTimersRef.current;

    if (!enableAISmoothing) {
      // 禁用时清除所有 timers
      timersMap.forEach(timer => clearTimeout(timer));
      timersMap.clear();
      return;
    }

    speakerData.forEach((data, speakerId) => {
      const lastText = lastSmoothedTextRef.current.get(speakerId);

      // 只在文本真正变化且不在处理中时触发
      if (data.originalFinal &&
          data.originalFinal !== lastText &&
          !data.isSmoothing) {

        // 清除该 speaker 之前的 timer（如果有）
        const existingTimer = timersMap.get(speakerId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // 为该 speaker 设置新的 timer
        const timer = setTimeout(() => {
          smoothTextForSpeaker(speakerId, data.originalFinal);
          lastSmoothedTextRef.current.set(speakerId, data.originalFinal);
          timersMap.delete(speakerId);
        }, 1000);

        timersMap.set(speakerId, timer);
      }
    });

    // Cleanup: 只清除不再存在的 speaker 的 timers
    return () => {
      timersMap.forEach((timer, speakerId) => {
        if (!speakerData.has(speakerId)) {
          clearTimeout(timer);
          timersMap.delete(speakerId);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerData, enableAISmoothing]);

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                麦克风设备
              </label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={isRecording || audioDevices.length === 0}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              >
                {audioDevices.length === 0 && (
                  <option value="">加载中...</option>
                )}
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </div>

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

            <div className="flex items-end">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={enableAISmoothing}
                  onChange={(e) => setEnableAISmoothing(e.target.checked)}
                  disabled={isRecording}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  AI 文本优化
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

        {/* Transcript Display - Speaker-separated layout */}
        <div className="space-y-6">
          {speakerData.size === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
              <p className="text-gray-400 dark:text-gray-500 italic">
                等待语音输入...
              </p>
            </div>
          )}

          {Array.from(speakerData.entries())
            .sort((a, b) => a[0] - b[0]) // 按 speaker ID 排序
            .map(([speakerId, data]) => {
              // 为不同 speaker 选择不同颜色 - 使用完整的映射表避免 Tailwind 动态类名问题
              const colorSchemes = [
                { border: 'border-blue-500', bg: 'bg-blue-500', dot: 'bg-blue-500' },
                { border: 'border-green-500', bg: 'bg-green-500', dot: 'bg-green-500' },
                { border: 'border-purple-500', bg: 'bg-purple-500', dot: 'bg-purple-500' },
                { border: 'border-orange-500', bg: 'bg-orange-500', dot: 'bg-orange-500' },
                { border: 'border-pink-500', bg: 'bg-pink-500', dot: 'bg-pink-500' },
                { border: 'border-indigo-500', bg: 'bg-indigo-500', dot: 'bg-indigo-500' },
                { border: 'border-red-500', bg: 'bg-red-500', dot: 'bg-red-500' },
                { border: 'border-yellow-500', bg: 'bg-yellow-500', dot: 'bg-yellow-500' },
              ];
              const colorScheme = colorSchemes[(speakerId - 1) % colorSchemes.length];

              return (
                <div
                  key={speakerId}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg border-l-4 ${colorScheme.border} overflow-hidden`}
                >
                  {/* Speaker Header */}
                  <div className="bg-gradient-to-r from-gray-50 to-white dark:from-gray-700 dark:to-gray-800 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <span className={`inline-block w-3 h-3 rounded-full ${colorScheme.dot}`}></span>
                        Speaker {speakerId}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                        <span>
                          {data.originalFinal.length} 字符
                        </span>
                        {data.isSmoothing && (
                          <span className="text-blue-500 animate-pulse flex items-center gap-1">
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            AI 优化中
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Three columns: Original | AI Smoothed | Translation */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 divide-x divide-gray-200 dark:divide-gray-700">
                    {/* Original Text */}
                    <div className="p-6">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">
                        原文转写
                      </h4>
                      <div className="text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed">
                        {data.originalFinal && (
                          <span>{data.originalFinal}</span>
                        )}
                        {data.originalInterim && (
                          <span className="text-blue-600 dark:text-blue-400 italic">
                            {data.originalInterim}
                          </span>
                        )}
                        {!data.originalFinal && !data.originalInterim && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            等待语音...
                          </p>
                        )}
                      </div>
                    </div>

                    {/* AI Smoothed Text */}
                    <div className="p-6 bg-blue-50/50 dark:bg-gray-900/50">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide flex items-center gap-2">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
                        </svg>
                        AI 优化
                      </h4>
                      <div className="text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed">
                        {!enableAISmoothing && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            AI 优化已禁用
                          </p>
                        )}
                        {enableAISmoothing && data.smoothedText && (
                          <span>{data.smoothedText}</span>
                        )}
                        {enableAISmoothing && !data.smoothedText && data.originalFinal && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            {data.isSmoothing ? '正在优化...' : '等待优化...'}
                          </p>
                        )}
                        {enableAISmoothing && !data.smoothedText && !data.originalFinal && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            等待内容...
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Translation */}
                    <div className="p-6">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">
                        翻译 ({targetLang})
                      </h4>
                      <div className="text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed">
                        {!enableTranslation && (
                          <p className="text-gray-400 dark:text-gray-500 italic">
                            翻译已禁用
                          </p>
                        )}
                        {enableTranslation && (
                          <>
                            {data.translatedFinal && (
                              <span>{data.translatedFinal}</span>
                            )}
                            {data.translatedInterim && (
                              <span className="text-blue-600 dark:text-blue-400 italic">
                                {data.translatedInterim}
                              </span>
                            )}
                            {!data.translatedFinal && !data.translatedInterim && (
                              <p className="text-gray-400 dark:text-gray-500 italic">
                                等待翻译...
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
