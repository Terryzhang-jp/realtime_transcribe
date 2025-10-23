# Vercel 部署指南

本文档说明如何将实时转写应用部署到 Vercel。

## 前置要求

1. **Vercel 账号**
   前往 [vercel.com](https://vercel.com) 注册账号

2. **Soniox API Key**
   前往 [soniox.com/console](https://soniox.com/console) 获取 API 密钥

## 部署步骤

### 方法一：通过 Vercel CLI（推荐）

1. **安装 Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **登录 Vercel**
   ```bash
   vercel login
   ```

3. **部署项目**
   ```bash
   vercel
   ```

4. **配置环境变量**

   在首次部署后，访问 Vercel Dashboard：
   - 打开你的项目
   - 进入 **Settings** → **Environment Variables**
   - 添加以下变量：
     - **Name**: `SONIOX_API_KEY`
     - **Value**: 你的 Soniox API 密钥
     - **Environment**: 选择 `Production`、`Preview`、`Development`（全选）

5. **重新部署**
   ```bash
   vercel --prod
   ```

### 方法二：通过 Vercel Dashboard

1. **连接 Git 仓库**
   - 前往 [vercel.com/new](https://vercel.com/new)
   - 选择你的 Git 提供商（GitHub、GitLab、Bitbucket）
   - 导入此项目仓库

2. **配置环境变量**

   在 **Configure Project** 页面：
   - 展开 **Environment Variables** 部分
   - 添加：
     ```
     SONIOX_API_KEY=你的实际API密钥
     ```

3. **部署**
   - 点击 **Deploy** 按钮
   - 等待部署完成

## 环境变量说明

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `SONIOX_API_KEY` | Soniox API 密钥，用于生成临时密钥 | ✅ |

## 安全注意事项

⚠️ **重要**：
- ❌ 不要将 API 密钥提交到 Git 仓库
- ✅ 环境变量已通过 `.gitignore` 保护
- ✅ API 密钥仅在服务器端使用（`/api/soniox-temp-key` 路由）
- ✅ 前端仅接收临时密钥（5分钟有效期）

## 本地开发

1. **创建本地环境变量文件**
   ```bash
   cp .env.example .env.local
   ```

2. **编辑 `.env.local`**
   ```bash
   SONIOX_API_KEY=你的实际API密钥
   ```

3. **启动开发服务器**
   ```bash
   npm run dev
   ```

## 验证部署

部署成功后：

1. 访问你的 Vercel 部署 URL
2. 完成登录验证（回答问题）
3. 点击"开始录制"测试转写功能
4. 检查浏览器控制台，确保没有 API 错误

## 常见问题

### Q: 部署后显示 "SONIOX_API_KEY not configured"

**A:** 环境变量未正确配置
- 检查 Vercel Dashboard → Settings → Environment Variables
- 确保变量名拼写正确：`SONIOX_API_KEY`
- 重新部署项目

### Q: 如何更新环境变量？

**A:**
1. 在 Vercel Dashboard 中更新环境变量
2. 触发重新部署：
   - 推送新代码到 Git，或
   - 在 Deployments 页面点击 "Redeploy"

### Q: API 密钥安全吗？

**A:** 是的
- API 密钥仅存储在 Vercel 的加密环境变量中
- 前端代码永远看不到主 API 密钥
- 只有临时密钥（5分钟有效）会发送到客户端

## 自定义域名（可选）

1. 前往 Vercel Dashboard → Settings → Domains
2. 添加你的自定义域名
3. 按照提示配置 DNS 记录

## 技术支持

遇到问题？
- 查看 [Vercel 文档](https://vercel.com/docs)
- 查看 [Soniox 文档](https://soniox.com/docs)
- 检查 Vercel 部署日志中的错误信息
