// Session Rotator - 60 分钟自动续流器

import { SonioxWSClient } from './ws-client';
import type { SonioxConfig, SonioxMessage } from './schema';

type MessageHandler = (message: SonioxMessage) => void;

export class SessionRotator {
  private primaryClient: SonioxWSClient | null = null;
  private secondaryClient: SonioxWSClient | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private sessionStartTime: number = 0;
  private messageHandler: MessageHandler | null = null;
  private currentConfig: SonioxConfig | null = null;

  // 55 分钟后开始轮换（留 5 分钟缓冲）
  private readonly ROTATION_INTERVAL = 55 * 60 * 1000;
  // 双写重叠时间（10 秒）
  private readonly OVERLAP_DURATION = 10 * 1000;

  constructor(onMessage: MessageHandler) {
    this.messageHandler = onMessage;
  }

  async start(config: SonioxConfig) {
    this.currentConfig = config;
    this.sessionStartTime = Date.now();

    // 创建主客户端
    this.primaryClient = new SonioxWSClient(
      this.handlePrimaryMessage.bind(this),
      undefined,
      (err) => console.error('Primary client error:', err)
    );

    await this.primaryClient.connect(config);

    // 启动轮换计时器
    this.scheduleRotation();
  }

  stop() {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }

    this.primaryClient?.close();
    this.secondaryClient?.close();

    this.primaryClient = null;
    this.secondaryClient = null;
  }

  sendAudio(audioData: Blob) {
    // 在重叠期间，同时发送给两个客户端
    if (this.secondaryClient) {
      this.secondaryClient.sendAudio(audioData);
    }

    if (this.primaryClient) {
      this.primaryClient.sendAudio(audioData);
    }
  }

  private scheduleRotation() {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
    }

    this.rotationTimer = setTimeout(() => {
      this.rotate();
    }, this.ROTATION_INTERVAL);
  }

  private async rotate() {
    if (!this.currentConfig) {
      console.error('No config available for rotation');
      return;
    }

    console.log('Starting session rotation...');

    try {
      // 创建次要客户端
      this.secondaryClient = new SonioxWSClient(
        this.handleSecondaryMessage.bind(this),
        undefined,
        (err) => console.error('Secondary client error:', err)
      );

      await this.secondaryClient.connect(this.currentConfig);

      // 等待重叠期结束
      setTimeout(() => {
        // 关闭主客户端
        if (this.primaryClient) {
          this.primaryClient.close();
        }

        // 次要客户端晋升为主客户端
        this.primaryClient = this.secondaryClient;
        this.secondaryClient = null;

        console.log('Session rotation complete');

        // 重置计时器，安排下一次轮换
        this.sessionStartTime = Date.now();
        this.scheduleRotation();
      }, this.OVERLAP_DURATION);

    } catch (error) {
      console.error('Failed to rotate session:', error);

      // 如果轮换失败，继续使用主客户端
      if (this.secondaryClient) {
        this.secondaryClient.close();
        this.secondaryClient = null;
      }

      // 重试轮换
      this.scheduleRotation();
    }
  }

  private handlePrimaryMessage(message: SonioxMessage) {
    // 只有在没有次要客户端时才转发主客户端的消息
    // 在重叠期间，只转发次要客户端的消息
    if (!this.secondaryClient && this.messageHandler) {
      this.messageHandler(message);
    }
  }

  private handleSecondaryMessage(message: SonioxMessage) {
    // 次要客户端存在时，优先使用其消息
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  getSessionDuration(): number {
    return Date.now() - this.sessionStartTime;
  }

  getTimeUntilRotation(): number {
    const elapsed = this.getSessionDuration();
    return Math.max(0, this.ROTATION_INTERVAL - elapsed);
  }
}
