# AI 文本优化功能说明

## 概述

已成功集成 GPT-5-nano AI 模型，用于实时优化语音转写文本。该功能可以：
- 修正错别字和语法错误
- 删除重复的词句
- 提升文本流畅度和可读性
- 保留原意，不添加额外内容

## 技术架构

### 1. 依赖包
- `ai` - Vercel AI SDK 5 核心包
- `@ai-sdk/openai` - OpenAI 提供商
- `zod` - Schema 验证（AI SDK 依赖）

### 2. 核心组件

#### 文本平滑服务 (`lib/ai/text-smoother.ts`)
```typescript
smoothTranscriptionText(options: SmoothTextOptions): Promise<SmoothTextResult>
```
- 使用 GPT-5-nano 模型 (`gpt-5-nano-2025-08-07`)
- 支持中文、英文、日文的自动检测
- 错误时返回原文（graceful degradation）

#### API 端点 (`app/api/smooth-text/route.ts`)
- **路径**: `POST /api/smooth-text`
- **认证**: 需要登录（session cookie）
- **请求体**:
  ```json
  {
    "text": "要优化的文本",
    "language": "auto" // 可选: "zh" | "en" | "ja" | "auto"
  }
  ```
- **响应**:
  ```json
  {
    "smoothedText": "优化后的文本",
    "original": "原始文本"
  }
  ```

### 3. UI 功能

#### 三列显示布局
1. **原文转写** - 实时语音识别结果
2. **AI 优化版本** - GPT-5-nano 优化后的文本
3. **翻译** - 原有的翻译功能

#### 控制选项
- **AI 文本优化** - 复选框开关
- 录制时禁用切换（防止状态混乱）
- 自动 debounce（1秒）避免频繁 API 调用

#### 状态指示
- "处理中..." - AI 正在优化文本
- "正在优化文本..." - 等待 API 响应
- "等待转写内容..." - 尚无内容

## 环境配置

### 必需的环境变量

在 `.env.local` 中添加：
```bash
# OpenAI API Key (for GPT-5-nano text smoothing)
OPENAI_API_KEY=your_openai_api_key_here
```

获取 API Key：https://platform.openai.com/api-keys

### 示例配置

参考 `.env.example` 文件已更新，包含 OpenAI API 配置说明。

## 使用流程

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **配置 API Key**
   - 确保 `.env.local` 包含有效的 `OPENAI_API_KEY`

3. **使用功能**
   - 登录应用
   - 勾选 "AI 文本优化" 复选框
   - 开始录制语音
   - 查看三列实时更新的内容

## 优化策略

### Prompt 设计
AI 模型接收以下指令：
1. 修正明显的错别字和语法错误
2. 删除重复的词语或句子
3. 调整标点符号使其更符合书面语习惯
4. 保持原文的意思和语气
5. 保持原文的语言
6. 如果文本已经很流畅，只需稍作调整或保持原样

### 性能优化
- **Debounce**: 1 秒延迟，避免每次更新都调用 API
- **模型选择**: GPT-5-nano 是最快且成本最低的 GPT-5 变体
- **错误处理**: API 失败时返回原文，不影响用户体验
- **超时设置**: API 端点最大执行时间 30 秒

## 成本考虑

### GPT-5-nano 特点
- ✅ 最快速度（GPT-5 系列中第 39 百分位）
- ✅ 最低成本（第 45 百分位）
- ✅ 100% 可靠性（基准测试）
- ⚡ 适合实时文本处理场景

### 计费估算
- 按 token 计费
- 短文本处理成本极低
- Debounce 机制减少不必要的 API 调用

## 安全性

### API Key 保护
- ✅ 已添加到 `.gitignore`
- ✅ 仅在服务端使用（不暴露给客户端）
- ✅ 示例文件 (`.env.example`) 已更新

### 用户认证
- 需要通过应用的身份验证
- Session cookie 验证

## 故障排查

### 常见问题

**Q: AI 优化不工作？**
- 检查 `.env.local` 是否配置了正确的 `OPENAI_API_KEY`
- 检查控制台是否有错误信息
- 确认已勾选 "AI 文本优化" 复选框

**Q: 优化速度慢？**
- GPT-5-nano 已经是最快的模型
- 检查网络连接
- 考虑增加 debounce 延迟

**Q: 成本过高？**
- 调整 debounce 时间（当前 1 秒）
- 考虑仅在停止录制后优化全文
- 监控 OpenAI 使用量面板

## 未来改进方向

### 可选增强功能
1. **批量优化模式** - 仅在停止录制后优化全文
2. **自定义 Prompt** - 允许用户定义优化风格
3. **对比视图** - 高亮显示优化前后的差异
4. **导出功能** - 导出优化后的文本
5. **模型选择** - 支持切换不同的 GPT 模型

## 版本信息

- **AI SDK**: 5.x (latest)
- **GPT Model**: gpt-5-nano-2025-08-07
- **实现日期**: 2025
- **状态**: ✅ 已完成并通过构建测试
