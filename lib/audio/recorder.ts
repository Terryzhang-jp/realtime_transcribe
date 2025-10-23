// 音频录制器

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private onDataCallback: ((data: Blob) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  /**
   * 获取所有可用的音频输入设备
   */
  static async getAudioDevices(): Promise<AudioDevice[]> {
    try {
      // 先请求一次权限，否则 enumerateDevices 可能返回空 label
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `麦克风 ${device.deviceId.slice(0, 5)}`,
        }));

      console.log('🎤 Available audio devices:', audioDevices);
      return audioDevices;
    } catch (error) {
      console.error('❌ Failed to get audio devices:', error);
      return [];
    }
  }

  async start(onData: (data: Blob) => void, deviceId?: string) {
    try {
      console.log('🎤 Requesting microphone access...', deviceId ? `deviceId: ${deviceId}` : 'default device');

      // 请求麦克风权限 - 使用更简单的约束
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      // 检查实际获得的音频轨道设置
      const audioTrack = this.stream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();
      console.log('🎤 Audio track settings:', {
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount,
        deviceId: settings.deviceId,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      });

      console.log('✅ Microphone access granted');
      this.onDataCallback = onData;

      // 使用 AudioContext 来处理音频并转换为 PCM
      // 这样可以更好地控制音频格式，确保 Soniox 兼容性
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000, // 强制 16kHz 采样率
      });

      console.log('🎵 AudioContext sample rate:', this.audioContext.sampleRate);

      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // 使用 ScriptProcessorNode（虽然已废弃，但兼容性最好）
      // bufferSize: 4096 样本 ≈ 256ms @ 16kHz
      const bufferSize = 4096;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0); // Float32Array

        // 转换为 Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Float32 (-1.0 to 1.0) 转换为 Int16 (-32768 to 32767)
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // 转换为 Blob
        const blob = new Blob([pcmData.buffer], { type: 'audio/pcm' });
        console.log('🎵 Audio data available (PCM):', blob.size, 'bytes');

        if (this.onDataCallback) {
          this.onDataCallback(blob);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log('✅ Recording started with PCM format (16-bit, 16kHz, mono)');

      return true;
    } catch (error) {
      console.error('❌ Failed to start audio recorder:', error);
      throw error;
    }
  }

  stop() {
    // 清理 AudioContext 相关资源
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // 清理 MediaRecorder（如果使用了）
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // 停止音频流
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.mediaRecorder = null;
    this.onDataCallback = null;
  }

  isRecording(): boolean {
    return this.processor !== null || this.mediaRecorder?.state === 'recording';
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
