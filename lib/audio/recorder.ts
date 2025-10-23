// 音频录制器

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private onDataCallback: ((data: Blob) => void) | null = null;

  async start(onData: (data: Blob) => void) {
    try {
      console.log('🎤 Requesting microphone access...');
      // 请求麦克风权限
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Soniox 推荐 16kHz
        }
      });

      console.log('✅ Microphone access granted');
      this.onDataCallback = onData;

      // 尝试使用 Opus 编码（Soniox 支持）
      const mimeType = this.getSupportedMimeType();
      console.log('🎵 Using MIME type:', mimeType);

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          console.log('🎵 Audio data available:', event.data.size, 'bytes, type:', event.data.type);
          if (this.onDataCallback) {
            this.onDataCallback(event.data);
          }
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
      };

      // 每 250ms 产生一个音频块（实时性与网络开销的平衡）
      this.mediaRecorder.start(250);
      console.log('✅ Recording started, chunk interval: 250ms');

      return true;
    } catch (error) {
      console.error('❌ Failed to start audio recorder:', error);
      throw error;
    }
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.mediaRecorder = null;
    this.onDataCallback = null;
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  private getSupportedMimeType(): string {
    // 按优先级检查浏览器支持的编码格式
    const types = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/ogg',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('Using MIME type:', type);
        return type;
      }
    }

    // 降级到默认
    return '';
  }
}
