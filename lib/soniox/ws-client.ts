// Soniox WebSocket 客户端

import { extractProgress, isResultMessage, WSState } from './schema';
import type { SonioxConfig, SonioxMessage } from './schema';

type MessageHandler = (message: SonioxMessage) => void;
type StateChangeHandler = (state: WSState) => void;
type ErrorHandler = (error: Error) => void;

export class SonioxWSClient {
  private ws: WebSocket | null = null;
  private state: WSState = WSState.IDLE;
  private messageHandler: MessageHandler | null = null;
  private stateChangeHandler: StateChangeHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private config: SonioxConfig | null = null;
  private pendingAudioChunks: Blob[] = [];
  private finalizeRequested = false;

  constructor(
    onMessage?: MessageHandler,
    onStateChange?: StateChangeHandler,
    onError?: ErrorHandler
  ) {
    this.messageHandler = onMessage || null;
    this.stateChangeHandler = onStateChange || null;
    this.errorHandler = onError || null;
  }

  async connect(config: SonioxConfig) {
    if (this.state === WSState.CONNECTING || this.state === WSState.CONNECTED) {
      console.warn('Already connecting or connected');
      return;
    }

    this.config = config;
    this.pendingAudioChunks = [];
    this.finalizeRequested = false;
    this.setState(WSState.CONNECTING);

    try {
      this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        this.setState(WSState.CONNECTED);
        this.reconnectAttempts = 0;

        // 发送配置
        if (this.ws && this.config) {
          const configJson = JSON.stringify(this.config);
          console.log('📤 Sending config:', configJson);
          this.ws.send(configJson);
          this.setState(WSState.STREAMING);
          console.log('🎙️ Ready to stream audio');
          this.flushPendingAudio();
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          let rawData: string;
          if (typeof event.data === 'string') {
            rawData = event.data;
          } else if (event.data instanceof Blob) {
            rawData = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            rawData = new TextDecoder().decode(event.data);
          } else {
            console.warn('⚠️ Unsupported message data type:', typeof event.data);
            return;
          }

          console.log('📨 Received message:', rawData);
          const message: SonioxMessage = JSON.parse(rawData);

          if (typeof (message as { error?: string }).error === 'string') {
            console.error('❌ Soniox error:', (message as { error: string }).error);
            this.handleError(new Error((message as { error: string }).error));
          }

          if (isResultMessage(message)) {
            console.log('✅ Got result:', message.tokens.length, 'tokens');
          } else {
            const { audio_final_proc_ms, audio_total_proc_ms } = extractProgress(message);
            if (audio_final_proc_ms != null || audio_total_proc_ms != null) {
              console.log(
                '⏱️ Progress:',
                { audio_final_proc_ms, audio_total_proc_ms }
              );
            }
          }

          if (this.messageHandler) {
            this.messageHandler(message);
          }
        } catch (error) {
          console.error('❌ Failed to parse message:', error);
        }
      };

      this.ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        this.setState(WSState.ERROR);
        this.handleError(new Error('WebSocket error'));
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.setState(WSState.CLOSED);

        // 自动重连（如果不是正常关闭）
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error('Failed to connect:', error);
      this.setState(WSState.ERROR);
      this.handleError(error as Error);
    }
  }

  sendAudio(audioData: Blob) {
    if (this.ws && this.state === WSState.STREAMING) {
      console.log('🎵 Sending audio chunk:', audioData.size, 'bytes');
      if (this.finalizeRequested) {
        console.warn('Finalize requested; ignoring additional audio chunk.');
        return;
      }
      this.ws.send(audioData);
      return;
    }

    console.log('⏳ Queuing audio chunk until streaming state:', audioData.size, 'bytes');
    this.pendingAudioChunks.push(audioData);
  }

  finalize() {
    if (!this.ws || this.finalizeRequested) {
      return;
    }

    if (this.state === WSState.CONNECTED || this.state === WSState.STREAMING) {
      try {
        this.ws.send(JSON.stringify({ type: 'finalize' }));
        this.finalizeRequested = true;
      } catch (error) {
        console.error('Failed to send finalize message:', error);
        this.handleError(error as Error);
      }
    }
  }

  close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client closed');
      this.ws = null;
    }

    this.setState(WSState.CLOSED);
    this.pendingAudioChunks = [];
    this.finalizeRequested = false;
  }

  getState(): WSState {
    return this.state;
  }

  private setState(newState: WSState) {
    if (this.state !== newState) {
      this.state = newState;
      if (this.stateChangeHandler) {
        this.stateChangeHandler(newState);
      }
    }
  }

  private handleError(error: Error) {
    if (this.errorHandler) {
      this.errorHandler(error);
    }
  }

  private flushPendingAudio() {
    if (!this.ws || this.state !== WSState.STREAMING || this.pendingAudioChunks.length === 0) {
      return;
    }

    console.log('🚿 Flushing queued audio chunks:', this.pendingAudioChunks.length);
    for (const chunk of this.pendingAudioChunks) {
      this.ws.send(chunk);
    }
    this.pendingAudioChunks = [];
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // 指数退避：1s, 2s, 4s, 8s, 8s...
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 8000);
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.config) {
        this.connect(this.config);
      }
    }, delay);
  }
}
