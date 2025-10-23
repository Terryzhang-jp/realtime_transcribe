# 实时转写 + 翻译

基于 Next.js 和 Soniox API 的实时语音转写和翻译工具。

## 功能特性

- ✅ **实时语音转写**：支持中文、英语、日语
- ✅ **实时翻译**：one-way 翻译到目标语言
- ✅ **混说识别**：自动识别和切换语言
- ✅ **说话人分离**：区分不同说话人（可选）
- ✅ **自动重连**：网络断线自动重连（指数退避）
- ✅ **60分钟续流**：自动会话轮换，支持长时间录制
- ✅ **低延迟**：WebSocket 直连，端到端延迟 < 800ms
- ✅ **响应式设计**：支持桌面和移动设备

## 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **API**: Soniox Real-time Transcription API
- **音频**: Web Audio API + MediaRecorder

## 项目结构

```
.
├── app/
│   ├── api/
│   │   └── soniox-temp-key/  # 临时密钥签发
│   │       └── route.ts
│   ├── page.tsx              # 主界面
│   ├── layout.tsx            # 根布局
│   └── globals.css           # 全局样式
├── lib/
│   ├── audio/
│   │   └── recorder.ts       # 音频采集器
│   └── soniox/
│       ├── schema.ts         # 类型定义
│       ├── ws-client.ts      # WebSocket 客户端
│       └── rotator.ts        # 会话续流器
└── .env.local                # 环境变量
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env.local` 文件并配置 Soniox API Key：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```bash
SONIOX_API_KEY=你的Soniox_API密钥
```

⚠️ **安全提醒**：
- `.env.local` 已被 `.gitignore` 排除，不会被提交到 Git
- 切勿将 API 密钥硬编码在代码中或提交到版本控制

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 打开浏览器

访问 [http://localhost:3000](http://localhost:3000)

## 使用说明

1. **选择翻译目标语言**：从下拉菜单选择英语、中文或日语
2. **配置选项**：
   - 启用/禁用翻译
   - 启用/禁用说话人分离
3. **点击"开始录制"**：允许麦克风权限后开始录制
4. **开始说话**：
   - 左侧显示原文（带语言标识）
   - 右侧显示翻译（如已启用）
   - 蓝色背景表示实时（partial）结果
   - 灰色背景表示最终（final）结果
5. **点击"停止录制"**：结束会话

## 核心功能说明

### 实时转写

- 采用 Soniox 的 `stt-rt-preview` 模型
- 支持语言自动识别（中文、英语、日语）
- 区分 partial 和 final 结果
- 延迟 < 800ms

### 实时翻译

- One-way 翻译模式
- 可选择目标语言
- 不产生额外功能费用（仅计算输出 token）

### 说话人分离

- 自动标识不同说话人（S1, S2, ...）
- 可选功能，按需启用

### 自动重连

- 网络断线自动重连
- 指数退避策略（1s → 2s → 4s → 8s）
- 最多重试 5 次

### 60分钟续流

- Soniox 单路限制 60 分钟
- 自动在 55 分钟时创建新会话
- 10 秒重叠期双写音频
- 无缝切换，不丢句

## 成本估算

基于 Soniox 定价：

- 仅转写：~$0.12 / 小时
- 转写 + 翻译：~$0.18 / 小时

## 浏览器兼容性

推荐使用：
- Chrome / Edge (最佳支持)
- Firefox
- Safari (需要额外音频编码处理)

## 部署

### Vercel（推荐）

详细的部署步骤请参考 [DEPLOYMENT.md](./DEPLOYMENT.md)

**快速部署**：

1. 连接 Git 仓库到 Vercel
2. 在 Vercel Dashboard 配置环境变量：
   - `SONIOX_API_KEY`: 你的 Soniox API 密钥
3. 点击 Deploy

或使用 CLI：

```bash
vercel login
vercel
# 在 Vercel Dashboard 配置环境变量后
vercel --prod
```

### 自托管

```bash
# 1. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入 SONIOX_API_KEY

# 2. 构建和启动
npm run build
npm start
```

## 开发说明

### 添加新语言

1. 在 `lib/soniox/schema.ts` 中添加语言代码
2. 在 UI 下拉菜单中添加选项
3. 更新 `language_hints` 配置

### 调整音频参数

修改 `lib/audio/recorder.ts` 中的：
- `sampleRate`: 采样率（默认 16000）
- `audioBitsPerSecond`: 比特率（默认 128000）
- `start()` 参数: 音频块间隔（默认 250ms）

### 调试 WebSocket

在 `lib/soniox/ws-client.ts` 中添加日志：

```typescript
this.ws.onmessage = (event) => {
  console.log('Received:', event.data);
  // ...
}
```

## 常见问题

**Q: 为什么需要临时 API Key？**
A: 避免在浏览器暴露长期密钥，同时保持前端直连的低延迟。

**Q: 可以录制多长时间？**
A: 理论上无限制，会话续流器会自动轮换。

**Q: 支持文件上传转写吗？**
A: 当前版本仅支持实时转写。文件转写需要使用 Soniox 异步 API。

**Q: 翻译质量如何？**
A: 依赖 Soniox 的翻译引擎，适合实时场景。对于高质量翻译，建议后期使用专业翻译服务。

## 后续计划

- [ ] 导出功能（TXT / JSON / SRT）
- [ ] Two-way 翻译 UI
- [ ] 术语表/热词支持
- [ ] 会议纪要生成（AI 摘要）
- [ ] 音频可视化（波形图）
- [ ] 历史会话管理

## 许可证

MIT

## 参考文档

- [Soniox API 文档](https://soniox.com/docs)
- [Next.js 文档](https://nextjs.org/docs)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
