# 调试指南

## 如何调试转写问题

### 1. 打开浏览器控制台

- **Chrome/Edge**: 按 `F12` 或右键点击页面 → 检查 → Console
- **Firefox**: 按 `F12` → Console
- **Safari**: 开发 → 显示 JavaScript 控制台

### 2. 重新启动开发服务器

```bash
# 停止当前服务器（Ctrl+C）
# 然后重新启动
npm run dev
```

### 3. 刷新页面并点击"开始录制"

### 4. 检查控制台日志

你应该看到类似这样的日志序列：

#### ✅ 正常流程：

```
🚀 Starting transcription...
🔑 Fetching temporary API key...
✅ Got temporary API key
✅ WebSocket connected
📤 Sending config: {"api_key":"...","model":"stt-rt-preview",...}
🎙️ Ready to stream audio
🎤 Requesting microphone access...
✅ Microphone access granted
🎵 Using MIME type: audio/webm;codecs=opus
✅ Recording started, chunk interval: 250ms
🎵 Audio data available: 1234 bytes, type: audio/webm;codecs=opus
🎵 Sending audio chunk: 1234 bytes
📨 Received message: {"type":"result","tokens":[...]}
✅ Got result: 1 tokens
💬 handleMessage called: result {...}
📝 Processing 1 tokens
🔤 Token: {text: "hello", translation_status: "original", ...}
➡️ Adding to original segments: hello
```

### 5. 常见问题诊断

#### 问题 1: 看不到 "✅ WebSocket connected"

**可能原因**:
- 网络连接问题
- API Key 无效
- 防火墙阻止 WebSocket

**解决方案**:
1. 检查网络连接
2. 确认 `.env.local` 中的 API Key 是否正确
3. 尝试禁用 VPN/代理

#### 问题 2: 看到 "✅ WebSocket connected" 但没有音频数据

**可能原因**:
- 麦克风未授权
- 浏览器不支持 MediaRecorder API

**解决方案**:
1. 检查浏览器地址栏，确保允许了麦克风权限
2. 尝试刷新页面重新授权
3. 使用 Chrome/Edge 浏览器（最佳支持）

#### 问题 3: 看到音频数据发送但没有收到消息

**可能原因**:
- Soniox API 配置错误
- 音频格式不支持
- API Key 过期

**检查控制台错误**:
```
❌ Soniox error: [错误信息]
```

**解决方案**:
1. 复制控制台完整日志
2. 检查是否有错误消息
3. 确认 API Key 有效且有配额

#### 问题 4: 收到消息但 UI 不更新

**可能原因**:
- 消息格式不符合预期
- React 状态更新问题

**检查日志**:
```
💬 handleMessage called: [查看消息内容]
```

### 6. 详细诊断步骤

#### 步骤 1: 检查 API Key

在控制台输入：
```javascript
fetch('/api/soniox-temp-key', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```

应该返回：
```json
{
  "apiKey": "...",
  "expiresAt": "..."
}
```

#### 步骤 2: 检查麦克风

在控制台输入：
```javascript
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✅ Microphone OK:', stream);
    stream.getTracks().forEach(track => track.stop());
  })
  .catch(console.error)
```

#### 步骤 3: 检查 WebSocket

查看 Network 标签 → WS（WebSocket）→ 查看消息

### 7. 收集完整日志

如果问题仍然存在，请：

1. 清空控制台
2. 点击"开始录制"
3. 说话 10 秒
4. 复制所有控制台日志

## 常见错误信息

### Error: "Failed to get temporary API key"

- 检查 `.env.local` 文件是否存在
- 确认 `SONIOX_API_KEY` 已设置
- 重启开发服务器

### Error: "WebSocket error"

- 检查网络连接
- 确认没有防火墙阻止
- 尝试使用 4G/5G 网络

### Error: "NotAllowedError: Permission denied"

- 点击浏览器地址栏的麦克风图标
- 允许麦克风访问
- 刷新页面

### Error: "NotFoundError: Requested device not found"

- 检查麦克风是否已连接
- 在系统设置中检查麦克风
- 尝试其他浏览器

## 性能检查

### 检查音频发送频率

应该看到每 250ms 一次音频数据：
```
🎵 Audio data available: xxx bytes
🎵 Sending audio chunk: xxx bytes
```

### 检查消息接收延迟

从说话到看到转写结果应该 < 1 秒

## 联系支持

如果以上步骤都无法解决问题，请提供：

1. 完整的控制台日志
2. 浏览器版本
3. 操作系统
4. 网络环境（WiFi/4G/有线）
5. 错误截图

## 测试配置

### 最小测试配置

如果怀疑是配置问题，尝试最简单的配置：

```typescript
{
  api_key: apiKey,
  model: 'stt-rt-preview',
  audio_format: 'auto',
  enable_language_identification: false,  // 禁用
  enable_speaker_diarization: false,      // 禁用
  // 不启用翻译
}
```

### 测试单语言

只使用一种语言测试，例如只说英语：

```typescript
{
  api_key: apiKey,
  model: 'stt-rt-preview',
  audio_format: 'auto',
  language_hints: ['en'],  // 只用英语
}
```
