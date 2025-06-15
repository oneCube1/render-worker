# 🏭 Artify AI Worker Service

这是部署在 Render 上的 AI 图片生成工人服务，负责处理耗时的 yunwu.ai API 调用。

## 🚀 部署到 Render

### 1. 准备代码
将 `render-worker` 文件夹上传到 GitHub 仓库。
 
### 2. 在 Render 创建服务
1. 访问 [render.com](https://render.com) 并登录
2. 点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库
4. 配置服务：
   - **Name**: `artify-ai-worker`
   - **Region**: 选择离你近的地区
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

### 3. 配置环境变量
在 Render 服务设置中添加以下环境变量：

```bash
# yunwu.ai API密钥
YUNWU_API_KEY=sk-a1rL1XFLv6xMZ0qvZKJbuTAtTX51eLlvcIJTRbD0aMG6bQaz

# Vercel Webhook URL（部署后获取）
VERCEL_WEBHOOK_URL=https://your-vercel-project.vercel.app/api/webhook

# 安全密钥（与Vercel中的WORKER_SECRET保持一致）
WORKER_SECRET=your-secure-secret-key-here
```

## 🔗 API 端点

### `GET /` 或 `GET /health`
健康检查端点
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `POST /process`
处理图片生成任务

**请求格式**:
```json
{
  "taskId": "abc123def456",
  "prompt": "Transform this image into Studio Ghibli style...",
  "imageUrl": "data:image/jpeg;base64,...",
  "style": "ghibli",
  "webhookUrl": "https://your-vercel-app.vercel.app/api/webhook"
}
```

**响应格式**:
```json
{
  "message": "Task accepted and is being processed.",
  "taskId": "abc123def456",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🔄 工作流程

1. **接收任务**: 从 Vercel 接收图片生成任务
2. **立即响应**: 告诉 Vercel "任务已接收"
3. **后台处理**: 异步调用 yunwu.ai API
4. **轮询等待**: 如果需要，轮询检查任务状态
5. **结果通知**: 完成后通过 Webhook 通知 Vercel

## 📊 日志格式

Worker 使用详细的日志记录，便于调试：

```
[WORKER] 🔔 收到新的图片生成任务
[WORKER] [taskId] 🚀 开始AI图片生成...
[WORKER] [taskId] 📡 调用yunwu.ai API...
[WORKER] [taskId] ✅ yunwu.ai API 调用成功
[WORKER] [taskId] 🎉 任务已完成，找到图片链接: 2 张
[WORKER] [taskId] ✅ 成功通知Vercel，响应状态: 200
```

## 🔧 本地开发

```bash
# 安装依赖
npm install

# 创建 .env 文件并配置环境变量
cp .env.example .env

# 启动服务
npm start
```

服务将在 `http://localhost:3001` 启动。

## 🛡️ 安全特性

- **请求验证**: 验证必要参数
- **Webhook 安全**: 使用 `x-worker-secret` 头验证
- **超时保护**: API 调用和轮询都有超时限制
- **错误处理**: 完整的错误捕获和日志记录

## 📈 监控建议

1. 监控 Render 服务的健康状态
2. 查看日志了解任务处理情况
3. 监控 yunwu.ai API 的响应时间
4. 跟踪任务成功率和失败原因 