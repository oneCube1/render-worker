// 引入必要的库
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config(); // 加载环境变量

// 创建 Express 应用
const app = express();
app.use(bodyParser.json({ limit: '50mb' })); // 增加请求体大小限制，支持base64图片

// 健康检查端点
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'Artify AI Worker is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// --- 这是我们工人唯一需要监听的地址 ---
app.post('/process', (req, res) => {
  console.log('[WORKER] 🔔 收到新的图片生成任务');
  
  const { taskId, prompt, imageUrl, style, webhookUrl } = req.body;

  // 验证必要参数
  if (!taskId || !prompt || !imageUrl || !webhookUrl) {
    console.log('[WORKER] ❌ 缺少必要参数');
    return res.status(400).json({ 
      error: 'Missing required parameters: taskId, prompt, imageUrl, webhookUrl' 
    });
  }

  console.log('[WORKER] 📝 任务信息:', {
    taskId,
    style: style || 'unknown',
    promptLength: prompt.length,
    imageUrlType: imageUrl.startsWith('data:') ? 'base64' : 'url',
    webhookUrl: webhookUrl.substring(0, 50) + '...'
  });

  // 1. 立刻响应 Vercel，告诉它"任务我收到了！"
  // 这样 Vercel 的函数就不会超时了
  res.status(200).json({ 
    message: 'Task accepted and is being processed.',
    taskId,
    timestamp: new Date().toISOString()
  });

  // 2. 在后台异步执行真正的耗时任务
  processImageGeneration(taskId, prompt, imageUrl, style, webhookUrl);
});

// --- 真正的 AI 处理函数 ---
async function processImageGeneration(taskId, prompt, imageUrl, style, webhookUrl) {
  console.log(`[WORKER] [${taskId}] 🚀 开始AI图片生成...`);
  console.log(`[WORKER] [${taskId}] 🎨 风格: ${style}`);
  console.log(`[WORKER] [${taskId}] 📝 提示词长度: ${prompt.length} 字符`);

  try {
    // 3. 调用耗时的yunwu.ai API
    console.log(`[WORKER] [${taskId}] 📡 调用yunwu.ai API...`);
    
    const response = await axios.post(
      'https://yunwu.ai/v1/chat/completions',
      {
        model: 'gpt-4o-image-vip',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.YUNWU_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 300000 // 设置一个5分钟的超时，防止无限等待
      }
    );

    console.log(`[WORKER] [${taskId}] ✅ yunwu.ai API 调用成功`);
    
    // 4. 从复杂的返回内容中解析出图片 URL
    const messageContent = response.data.choices?.[0]?.message?.content;
    if (!messageContent) {
      throw new Error('yunwu.ai API 返回格式异常：没有找到消息内容');
    }

    console.log(`[WORKER] [${taskId}] 📄 API响应内容长度: ${messageContent.length} 字符`);
    console.log(`[WORKER] [${taskId}] 🔍 开始解析图片链接...`);

    // 检查是否包含图片链接（已完成）
    const imageUrlRegex = /https:\/\/[^\s\)]+\.(?:png|jpg|jpeg|gif|webp)/gi;
    const imageUrls = messageContent.match(imageUrlRegex);

    if (imageUrls && imageUrls.length > 0) {
      console.log(`[WORKER] [${taskId}] 🎉 任务已完成，找到图片链接: ${imageUrls.length} 张`);
      
      // 格式化图片数据
      const images = imageUrls.map((url, index) => {
        console.log(`[WORKER] [${taskId}] 🖼️ 图片 ${index + 1}: ${url.substring(0, 80)}...`);
        return { url };
      });
      
      // 5. 任务成功，调用 Vercel Webhook 通知结果
      await notifyVercel(taskId, 'completed', { images }, webhookUrl);
      return;
    }

    // 检查是否包含任务ID（需要轮询）
    const taskIdMatch = messageContent.match(/task_([a-zA-Z0-9]+)/);
    if (taskIdMatch) {
      const yunwuTaskId = taskIdMatch[0];
      console.log(`[WORKER] [${taskId}] ⏳ 任务进行中，yunwu任务ID: ${yunwuTaskId}`);
      console.log(`[WORKER] [${taskId}] 🔄 开始轮询等待完成...`);
      
      // 轮询检查任务状态（最多等待5分钟）
      const maxAttempts = 60; // 5分钟，每5秒检查一次
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        attempts++;
        console.log(`[WORKER] [${taskId}] 🔄 轮询检查 ${attempts}/${maxAttempts}`);
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒
        
        try {
          // 重新请求检查状态
          const checkResponse = await axios.post(
            'https://yunwu.ai/v1/chat/completions',
            {
              model: 'gpt-4o-image-vip',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `检查任务状态: ${yunwuTaskId}`
                    }
                  ]
                }
              ],
              max_tokens: 4000,
              temperature: 0.7
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.YUNWU_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000 // 30秒超时
            }
          );

          const checkContent = checkResponse.data.choices?.[0]?.message?.content || '';
          console.log(`[WORKER] [${taskId}] 🔍 轮询响应 ${attempts}: ${checkContent.substring(0, 100)}...`);
          
          // 检查是否完成
          const completedImageUrls = checkContent.match(imageUrlRegex);
          if (completedImageUrls && completedImageUrls.length > 0) {
            console.log(`[WORKER] [${taskId}] 🎉 轮询发现任务完成！图片数量: ${completedImageUrls.length}`);
            
            const images = completedImageUrls.map((url, index) => {
              console.log(`[WORKER] [${taskId}] 🖼️ 完成图片 ${index + 1}: ${url.substring(0, 80)}...`);
              return { url };
            });
            
            await notifyVercel(taskId, 'completed', { images }, webhookUrl);
            return;
          }
          
          // 检查是否失败
          if (checkContent.includes('失败') || checkContent.includes('错误')) {
            console.log(`[WORKER] [${taskId}] ❌ 轮询发现任务失败`);
            const failureReason = checkContent.includes('input_moderation') ? '内容审核失败' : '生成失败';
            throw new Error(failureReason);
          }
          
        } catch (pollError) {
          console.log(`[WORKER] [${taskId}] ⚠️ 轮询请求失败 ${attempts}: ${pollError.message}`);
          // 继续轮询，不立即失败
        }
      }
      
      // 轮询超时
      throw new Error('任务处理超时，请稍后重试');
    }

    // 检查是否直接失败
    if (messageContent.includes('失败') || messageContent.includes('错误')) {
      const failureReason = messageContent.includes('input_moderation') ? '内容审核失败' : '生成失败';
      throw new Error(failureReason);
    }

    // 无法解析响应
    console.log(`[WORKER] [${taskId}] ⚠️ 无法解析API响应:`);
    console.log(`[WORKER] [${taskId}] 📄 完整响应: ${messageContent}`);
    throw new Error('无法解析yunwu.ai API响应');

  } catch (error) {
    const errorMessage = error.response ? 
      `API错误 ${error.response.status}: ${JSON.stringify(error.response.data)}` : 
      error.message;
    
    console.error(`[WORKER] [${taskId}] ❌ AI生成失败:`, errorMessage);

    // 6. 任务失败，也调用 Vercel Webhook 通知错误
    await notifyVercel(taskId, 'failed', { error: errorMessage }, webhookUrl);
  }
}

// --- 通知 Vercel 的函数 ---
async function notifyVercel(taskId, status, data, webhookUrl) {
  const secret = process.env.WORKER_SECRET;

  if (!webhookUrl || !secret) {
    console.error(`[WORKER] [${taskId}] ❌ WEBHOOK_URL 或 WORKER_SECRET 未配置`);
    return;
  }

  console.log(`[WORKER] [${taskId}] 📡 通知Vercel，状态: ${status}`);

  try {
    const payload = {
      taskId,
      status,
      ...data
    };

    console.log(`[WORKER] [${taskId}] 📤 发送Webhook数据:`, {
      taskId,
      status,
      dataKeys: Object.keys(data),
      webhookUrl: webhookUrl.substring(0, 50) + '...'
    });

    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': secret
      },
      timeout: 10000 // 10秒超时
    });

    console.log(`[WORKER] [${taskId}] ✅ 成功通知Vercel，响应状态: ${response.status}`);
  } catch (error) {
    const errorMsg = error.response ? 
      `${error.response.status}: ${JSON.stringify(error.response.data)}` : 
      error.message;
    console.error(`[WORKER] [${taskId}] ❌ 通知Vercel失败: ${errorMsg}`);
  }
}

// 错误处理中间件
app.use((error, req, res, next) => {
  console.error('[WORKER] ❌ 服务器错误:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: ['GET /', 'GET /health', 'POST /process'],
    timestamp: new Date().toISOString()
  });
});

// --- 启动服务器 ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[WORKER] 🚀 Artify AI Worker 正在运行在端口 ${PORT}`);
  console.log(`[WORKER] 🌐 健康检查: http://localhost:${PORT}/health`);
  console.log(`[WORKER] 📡 处理端点: http://localhost:${PORT}/process`);
  console.log(`[WORKER] ⏰ 启动时间: ${new Date().toISOString()}`);
}); 