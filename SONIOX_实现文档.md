# Soniox 实时转写技术实现文档

## 项目概述

这是一个基于 **Next.js 14** 的实时语音转写和翻译应用，使用 **Soniox API** 提供实时语音识别（STT）和翻译功能。支持中文、英语、日语的实时转写，并可进行说话人分离和实时翻译。

## 技术栈

- **前端框架**: Next.js 14 (App Router)
- **UI**: React 18 + TypeScript
- **样式**: Tailwind CSS
- **实时通信**: WebSocket
- **语音处理**: Web Audio API + MediaRecorder API
- **STT服务**: Soniox Real-time Speech-to-Text API

---

## 核心架构

### 整体流程图

```
用户操作 → 获取临时API Key → 建立WebSocket连接 → 启动音频录制 → 流式传输音频数据 → 接收转写结果 → 显示
```

### 关键组件

```
app/
├── page.tsx                          # 主页面和UI逻辑
├── api/
│   ├── soniox-temp-key/route.ts     # 获取临时API Key的后端路由
│   ├── login/route.ts               # 身份验证路由
│   └── session/route.ts             # 会话验证路由
lib/
├── audio/
│   └── recorder.ts                   # 音频录制器
├── soniox/
│   ├── ws-client.ts                  # Soniox WebSocket 客户端
│   └── schema.ts                     # Soniox 类型定义
└── auth/
    └── session.ts                    # 会话管理
```

---

## 详细实现

### 1. 身份验证和 API Key 管理

#### 1.1 为什么需要临时 API Key？

Soniox 的永久 API Key 必须保存在服务器端，不能直接暴露给前端。因此我们采用以下方案：

1. 服务器持有永久 API Key（存储在环境变量 `SONIOX_API_KEY`）
2. 前端请求时，服务器生成一个**临时 API Key**（有效期 5 分钟）
3. 前端使用临时 Key 直接与 Soniox WebSocket 服务通信

#### 1.2 获取临时 API Key 的实现

**文件**: `app/api/soniox-temp-key/route.ts`

```typescript
export async function POST(request: NextRequest) {
  // 1. 验证用户会话
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const session = verifySessionToken(sessionToken);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. 读取服务器的永久 API Key
  const apiKey = process.env.SONIOX_API_KEY;

  // 3. 请求 Soniox 生成临时 Key
  const response = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: 300, // 5 分钟
      client_reference_id: 'web-live-stt'
    })
  });

  const data = await response.json();

  // 4. 返回临时 Key 给前端
  return NextResponse.json({
    apiKey: data.api_key,
    expiresAt: data.expires_at
  });
}
```

**关键点**:
- 使用 `usage_type: 'transcribe_websocket'` 指定用途
- 临时 Key 默认有效期为 **300 秒（5 分钟）**
- 前端收到后可以直接连接 WebSocket

---

### 2. 音频录制 (AudioRecorder)

**文件**: `lib/audio/recorder.ts`

#### 2.1 核心功能

`AudioRecorder` 类封装了浏览器的 `MediaRecorder API`，负责：
1. 请求麦克风权限
2. 录制音频
3. 每 250ms 产生一个音频块（Blob）
4. 将音频块传递给回调函数

#### 2.2 实现代码

```typescript
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private onDataCallback: ((data: Blob) => void) | null = null;

  async start(onData: (data: Blob) => void) {
    // 1. 请求麦克风权限
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,      // 回声消除
        noiseSuppression: true,      // 降噪
        autoGainControl: true,       // 自动增益
        sampleRate: 16000,           // 采样率 16kHz（Soniox 推荐）
      }
    });

    // 2. 选择最佳的编码格式
    const mimeType = this.getSupportedMimeType();

    // 3. 创建 MediaRecorder
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType,
      audioBitsPerSecond: 128000,  // 128 kbps
    });

    // 4. 监听音频数据
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        if (this.onDataCallback) {
          this.onDataCallback(event.data);  // 传递给回调函数
        }
      }
    };

    // 5. 每 250ms 产生一个音频块
    this.mediaRecorder.start(250);
  }

  stop() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
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
        return type;
      }
    }
    return '';
  }
}
```

#### 2.3 关键参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `sampleRate` | 16000 | Soniox 推荐 16kHz 采样率 |
| `echoCancellation` | true | 消除回声，提升识别准确度 |
| `noiseSuppression` | true | 降噪处理 |
| `audioBitsPerSecond` | 128000 | 128 kbps，平衡质量和带宽 |
| `start(250)` | 250ms | 每 250ms 产生一个音频块 |

**为什么选择 250ms？**
- 太短（如 100ms）：网络开销大，频繁发送小块数据
- 太长（如 1000ms）：实时性差，转写延迟高
- **250ms 是实时性和效率的最佳平衡点**

---

### 3. WebSocket 客户端 (SonioxWSClient)

**文件**: `lib/soniox/ws-client.ts`

#### 3.1 核心职责

`SonioxWSClient` 封装了与 Soniox WebSocket 服务的所有交互：

1. 建立 WebSocket 连接
2. 发送配置信息
3. 流式传输音频数据
4. 接收和解析转写结果
5. 处理错误和重连

#### 3.2 连接流程

```typescript
async connect(config: SonioxConfig) {
  // 1. 创建 WebSocket 连接
  this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

  this.ws.onopen = () => {
    // 2. 连接成功后，发送配置
    const configJson = JSON.stringify(this.config);
    this.ws.send(configJson);

    // 3. 进入 STREAMING 状态，可以发送音频了
    this.setState(WSState.STREAMING);

    // 4. 发送之前缓存的音频数据（如果有）
    this.flushPendingAudio();
  };

  this.ws.onmessage = async (event) => {
    // 5. 接收转写结果
    const message: SonioxMessage = JSON.parse(await event.data.text());

    if (this.messageHandler) {
      this.messageHandler(message);  // 通知外部处理器
    }
  };
}
```

#### 3.3 配置参数详解

**Soniox 配置对象** (`SonioxConfig`):

```typescript
{
  api_key: 'temp_xxx',                      // 临时 API Key
  model: 'stt-rt-preview',                  // 使用实时转写模型
  audio_format: 'auto',                     // 自动检测音频格式
  enable_language_identification: true,     // 启用语言识别
  language_hints: ['zh', 'en', 'ja'],      // 语言提示（中英日）
  enable_speaker_diarization: true,         // 启用说话人分离
  translation: {                            // 翻译配置（可选）
    type: 'one_way',                        // 单向翻译
    target_language: 'en',                  // 目标语言
  }
}
```

| 参数 | 说明 |
|------|------|
| `model: 'stt-rt-preview'` | 使用 Soniox 实时转写模型 |
| `audio_format: 'auto'` | 自动检测音频编码（Opus/WebM） |
| `enable_language_identification` | 自动识别说话语言 |
| `language_hints` | 提示可能出现的语言，提升识别准确度 |
| `enable_speaker_diarization` | 区分不同说话人（Speaker 1, Speaker 2...） |
| `translation` | 实时翻译配置 |

#### 3.4 发送音频数据

```typescript
sendAudio(audioData: Blob) {
  if (this.ws && this.state === WSState.STREAMING) {
    // 直接发送音频 Blob
    this.ws.send(audioData);
    return;
  }

  // 如果还没进入 STREAMING 状态，先缓存
  this.pendingAudioChunks.push(audioData);
}
```

**要点**:
- WebSocket 连接建立后，必须先发送配置，才能发送音频
- 在 `STREAMING` 状态之前收到的音频会被缓存
- 进入 `STREAMING` 状态后，立即发送缓存的音频

#### 3.5 结束转写

```typescript
finalize() {
  // 发送 finalize 消息，告诉 Soniox 音频已结束
  this.ws.send(JSON.stringify({ type: 'finalize' }));
  this.finalizeRequested = true;
}
```

- 用户点击"停止录制"后，必须调用 `finalize()`
- Soniox 收到后会处理剩余的音频缓冲区，返回最终结果
- 等待 `finished: true` 消息后关闭连接

---

### 4. 转写结果处理

**文件**: `app/page.tsx`

#### 4.1 Soniox 返回的数据格式

每次收到 WebSocket 消息，Soniox 返回一个包含 `tokens` 数组的对象：

```json
{
  "tokens": [
    {
      "text": "你好",
      "is_final": true,
      "translation_status": "original",
      "language": "zh",
      "speaker": 1
    },
    {
      "text": "Hello",
      "is_final": true,
      "translation_status": "translation",
      "language": "en"
    }
  ]
}
```

#### 4.2 Token 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 识别的文本 |
| `is_final` | boolean | 是否为最终结果 |
| `translation_status` | string | `'original'` 原文 / `'translation'` 翻译 |
| `language` | string | 语言代码（zh/en/ja） |
| `speaker` | number | 说话人编号（如果启用说话人分离） |

#### 4.3 Final vs Non-final Tokens

- **Final tokens** (`is_final: true`): 确定的识别结果，不会再改变
- **Non-final tokens** (`is_final: false`): 临时结果，后续可能修正

**处理策略**:
```typescript
const handleMessage = (message: SonioxMessage) => {
  let originalFinalChunk = '';
  let translatedFinalChunk = '';
  let originalNonFinalText = '';
  let translatedNonFinalText = '';

  for (const token of message.tokens) {
    const isTranslation = token.translation_status === 'translation';
    const isFinal = token.is_final ?? token.final ?? false;
    const tokenText = token.text ?? '';

    if (isTranslation) {
      if (isFinal) {
        translatedFinalChunk += tokenText;  // 累加 final 翻译
      } else {
        translatedNonFinalText += tokenText;  // 替换临时翻译
      }
    } else {
      if (isFinal) {
        originalFinalChunk += tokenText;  // 累加 final 原文
      } else {
        originalNonFinalText += tokenText;  // 替换临时原文
      }
    }
  }

  // 更新状态
  if (originalFinalChunk) {
    setOriginalFinalText(prev => prev + originalFinalChunk);
  }
  if (translatedFinalChunk) {
    setTranslatedFinalText(prev => prev + translatedFinalChunk);
  }
  setOriginalInterim(originalNonFinalText);
  setTranslatedInterim(translatedNonFinalText);
};
```

**关键点**:
- **Final tokens**: 直接累加到最终文本（`prev + newText`）
- **Non-final tokens**: 完全替换临时文本（不累加）

---

### 5. 主流程串联

**文件**: `app/page.tsx` 中的 `handleStart()` 函数

```typescript
const handleStart = async () => {
  // 1. 获取临时 API Key
  const response = await fetch('/api/soniox-temp-key', { method: 'POST' });
  const { apiKey } = await response.json();

  // 2. 创建 WebSocket 客户端
  wsClientRef.current = new SonioxWSClient(
    handleMessage,        // 消息处理器
    handleStateChange,    // 状态变化处理器
    handleError           // 错误处理器
  );

  // 3. 连接 WebSocket 并发送配置
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

  // 4. 启动音频录制，并将音频数据发送到 WebSocket
  audioRecorderRef.current = new AudioRecorder();
  await audioRecorderRef.current.start((audioData) => {
    wsClientRef.current?.sendAudio(audioData);
  });

  // 5. 启动会话计时器
  sessionTimerRef.current = setInterval(() => {
    setSessionTime(prev => prev + 1);
  }, 1000);
};
```

**流程图**:

```
用户点击"开始录制"
    ↓
1. 请求临时 API Key (POST /api/soniox-temp-key)
    ↓
2. 创建 SonioxWSClient
    ↓
3. 连接 WebSocket (wss://stt-rt.soniox.com/transcribe-websocket)
    ↓
4. 发送配置（包含语言、翻译等设置）
    ↓
5. 启动 AudioRecorder，每 250ms 产生音频块
    ↓
6. 通过 WebSocket 发送音频块
    ↓
7. 接收转写结果，更新 UI
    ↓
8. 用户点击"停止录制"
    ↓
9. 发送 finalize 消息
    ↓
10. 等待最终结果后关闭连接
```

---

## 最佳实践和注意事项

### 1. 安全性

- **永久 API Key 必须保存在服务器端**，通过环境变量 `SONIOX_API_KEY` 配置
- 前端只使用临时 API Key，有效期 5 分钟
- 使用会话验证（`SESSION_COOKIE_NAME`）保护 API 端点

### 2. 音频质量

- 推荐使用 **16kHz 采样率**（Soniox 优化）
- 启用 `echoCancellation` 和 `noiseSuppression` 提升识别率
- 选择 Opus 编码（`audio/webm;codecs=opus`）获得最佳压缩比

### 3. 实时性优化

- 音频块大小设置为 **250ms**，平衡实时性和网络开销
- 在 WebSocket 连接建立前缓存音频数据，避免丢失
- 使用 `is_final` 字段区分临时结果和最终结果

### 4. 错误处理

- 实现 WebSocket 自动重连（指数退避策略）
- 处理麦克风权限被拒绝的情况
- 监听 `error` 事件并通知用户

### 5. 性能优化

- 使用 `useRef` 存储 WebSocket 和 AudioRecorder 实例，避免重复创建
- 组件卸载时清理资源（关闭 WebSocket、停止录音、清除定时器）

---

## 常见问题

### Q1: 为什么需要 `finalize()`？

A: 停止录音后，Soniox 服务器的音频缓冲区可能还有未处理的数据。发送 `finalize` 消息会触发服务器处理剩余数据并返回最终结果。

### Q2: 如何处理说话人分离？

A: 在配置中设置 `enable_speaker_diarization: true`，Soniox 会在 token 中返回 `speaker` 字段（1, 2, 3...）。

### Q3: 支持哪些语言？

A: 当前配置支持中文（zh）、英语（en）、日语（ja）。可通过 `language_hints` 参数指定。

### Q4: 如何实现离线转写？

A: 当前实现是实时转写（需要网络连接）。离线转写需要使用 Soniox 的批量转写 API（不同的端点）。

### Q5: 如何优化翻译质量？

A:
- 使用 `language_hints` 提示源语言
- 选择正确的 `target_language`
- 考虑使用 `two_way` 翻译模式（双向翻译）

---

## 调试技巧

### 1. 查看 WebSocket 消息

打开浏览器开发者工具 → Network → WS，可以看到所有 WebSocket 消息：

```
→ 发送配置: {"api_key":"temp_xxx","model":"stt-rt-preview",...}
→ 发送音频: [Blob 3840 bytes]
← 接收结果: {"tokens":[{"text":"你好","is_final":true}]}
```

### 2. 启用详细日志

代码中已包含详细的 `console.log`，可以追踪：
- 连接状态变化
- 音频数据大小
- Token 处理过程

### 3. 测试音频格式

检查浏览器支持的音频格式：

```javascript
console.log(MediaRecorder.isTypeSupported('audio/webm;codecs=opus'));
```

---

## 扩展功能建议

1. **导出转写结果**: 添加"导出为 TXT/JSON"按钮
2. **历史记录**: 保存转写记录到数据库
3. **实时字幕**: 使用 Canvas 或 SVG 显示字幕效果
4. **多人协作**: 使用 WebRTC 实现多人实时转写
5. **自定义词汇表**: 利用 Soniox 的自定义词汇功能提升专业术语识别率

---

## 相关资源

- [Soniox 官方文档](https://soniox.com/docs)
- [Soniox WebSocket API](https://soniox.com/docs/websocket)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

---

## 总结

本项目通过以下技术实现了完整的实时语音转写和翻译：

1. **后端**: Next.js API Routes 安全地管理 Soniox API Key
2. **音频**: AudioRecorder 使用 MediaRecorder API 捕获麦克风音频
3. **通信**: SonioxWSClient 通过 WebSocket 流式传输音频并接收结果
4. **前端**: React 组件实时显示转写和翻译结果

整个流程是完全流式的，实现了低延迟的实时转写体验。
