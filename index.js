// 引入必要的库
const express = require('express');
require('dotenv').config(); // 加载环境变量

// 创建 Express 应用
const app = express();

// --- vvvvvv 在这里进行修改 vvvvvv ---
// 增加 JSON 和 URL-encoded 请求体的大小限制，比如增加到 50mb
// 这是解决 "PayloadTooLargeError" 的关键
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// --- ^^^^^^ 修改结束 ^^^^^^ ---

// 图片链接转换函数
function convertImageUrl(originalUrl) {
  try {
    // 从R2链接中提取文件名
    // 例如: https://jubili.8a668a21c563ade0c297bd2404377b9a.r2.cloudflarestorage.com/1750039195939-7rB5Yl9_f2.jpg
    // 提取: 1750039195939-7rB5Yl9_f2
    
    const url = new URL(originalUrl);
    const pathname = url.pathname; // /1750039195939-7rB5Yl9_f2.jpg
    const filename = pathname.substring(1); // 去掉开头的 /
    const filenameWithoutExt = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, ''); // 去掉扩展名
    
    // 构建新的图片服务链接
    const convertedUrl = `https://tupian.image123.pro/${filenameWithoutExt}.jpg`;
    
    return convertedUrl;
  } catch (error) {
    console.error('Error converting image URL:', error);
    return originalUrl; // 如果转换失败，返回原始URL
  }
}

// --- 工人的主入口 ---
app.post('/process-image', (req, res) => {
  const { taskId, prompt, imageUrl } = req.body;

  // 日志1：确认收到 Vercel 的请求
  console.log(`\n\n--- [${taskId}] NEW TASK RECEIVED ---`);
  console.log(`[${taskId}] [INFO] 📡 Received prompt: "${prompt}"`);
  
  // 记录接收到的图片链接
  if (imageUrl) {
    console.log(`[${taskId}] [INFO] 🖼️ Received original image URL: ${imageUrl}`);
  }

  // 立刻响应 Vercel，告诉它"任务我收到了！"
  res.status(200).send({ message: 'Task accepted and is being processed.' });

  // 在后台异步执行真正的耗时任务
  processImageGeneration(taskId, prompt, imageUrl);
});

// --- 真正的 AI 处理函数 ---
async function processImageGeneration(taskId, prompt, imageUrl = null) {
  // 日志2：打印出将要使用的环境变量和参数（密钥做掩码处理）
  const apiKey = process.env.YUNWU_API_KEY;
  const apiKeyForDisplay = apiKey ? `sk-.......${apiKey.slice(-4)}` : "未定义(undefined)";
  
  console.log(`--- [${taskId}] DEBUG INFO ---`);
  console.log(`[${taskId}] [DEBUG] Model to be used: 'gpt-4o-image-vip'`);
  console.log(`[${taskId}] [DEBUG] API Key being used (masked): ${apiKeyForDisplay}`);
  console.log(`[${taskId}] [DEBUG] Has image URL: ${imageUrl ? 'Yes' : 'No'}`);
  console.log(`--- [${taskId}] END DEBUG INFO ---`);

  try {
    // 构建消息内容
    let messageContent;
    let finalImageUrl = null;
    
    if (imageUrl) {
      // 🔥 关键：转换图片链接
      finalImageUrl = convertImageUrl(imageUrl);
      
      console.log(`[${taskId}] [CONVERT] 🔄 Image URL conversion:`);
      console.log(`[${taskId}] [CONVERT] Original: ${imageUrl}`);
      console.log(`[${taskId}] [CONVERT] Converted: ${finalImageUrl}`);
      
      // ===== 🔥 重点：打印即将发送给AI的图片链接 🔥 =====
      console.log(`\n======== [${taskId}] 🚀 SENDING TO AI 🚀 ========`);
      console.log(`[${taskId}] [SEND_TO_AI] 📤 About to send the following image URL to AI service:`);
      console.log(`[${taskId}] [SEND_TO_AI] ⬇️⬇️⬇️ IMAGE URL BEING SENT TO AI ⬇️⬇️⬇️`);
      console.log(finalImageUrl);
      console.log(`[${taskId}] [SEND_TO_AI] ⬆️⬆️⬆️ END OF IMAGE URL BEING SENT TO AI ⬆️⬆️⬆️`);
      console.log(`======== [${taskId}] 🚀 END SENDING TO AI 🚀 ========\n`);
      
      // 构建包含图片的消息
      messageContent = [
        {
          type: "text",
          text: prompt
        },
        {
          type: "image_url",
          image_url: {
            url: finalImageUrl
          }
        }
      ];
    } else {
      // 纯文本消息
      messageContent = prompt;
    }

    // 准备要发送给 AI 的数据包 (Payload)
    const aiPayload = {
      model: "gpt-4o-image-vip",
      messages: [
        {
          role: "user",
          content: messageContent
        }
      ]
    };

    console.log(`[${taskId}] [AI CALL] 最终确认的请求数据:`);
    console.log(JSON.stringify(aiPayload, null, 2));

    // 日志3：准备调用外部 API
    console.log(`[${taskId}] [INFO] ➡️ Calling yunwu.ai API...`);
    
    const response = await fetch("https://yunwu.ai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(aiPayload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[${taskId}] [ERROR] AI 服务返回了错误，状态码: ${response.status}:`, errorBody);
      throw new Error(`AI service responded with status ${response.status}`);
    }

    // 日志4：外部 API 调用成功
    console.log(`[${taskId}] [SUCCESS] ✅ yunwu.ai API responded with status: ${response.status}`);

    const aiResult = await response.json();
    console.log(`[${taskId}] [AI CALL] 成功收到 AI 返回的结果。`);
    
    const content = aiResult.choices[0].message.content;
    
    console.log(`[${taskId}] [DEBUG] Full AI response content:`, content);
    
    // 日志5：准备解析返回结果
    console.log(`[${taskId}] [INFO] 🧠 Parsing response content...`);
    const match = content.match(/!\[.*?\]\((https:\/\/filesystem\.site.*?)\)/);

    if (!match || !match[1]) {
        throw new Error('Could not parse image URL from AI response. No match found.');
    }
    const resultImageUrl = match[1];  // 重命名变量避免与参数冲突
    console.log(`[${taskId}] [SUCCESS] ✅ Image URL parsed successfully.`);

    // 日志6：准备回调 Vercel Webhook
    console.log(`[${taskId}] [INFO] ↪️ Notifying Vercel with 'completed' status...`);
    await notifyVercel(taskId, 'completed', { resultUrl: resultImageUrl });

  } catch (error) {
    // 日志7：捕获到任何环节的错误
    console.error(`[${taskId}] [ERROR] ❌ An error occurred during processing!`);
    console.error(`[${taskId}] [ERROR] Error message:`, error.message);
    console.error(`[${taskId}] [ERROR] Error details:`, error);
    
    await notifyVercel(taskId, 'failed', { error: error.message });
  }
}

// 新增：专门用于调试发送给AI的图片链接的端点
app.post('/debug-send-to-ai', (req, res) => {
  const { imageUrl, prompt = "请分析这张图片" } = req.body;
  const taskId = `DEBUG_${Date.now()}`;
  
  console.log(`\n\n--- [${taskId}] DEBUG: SIMULATE SENDING TO AI ---`);
  
  if (imageUrl) {
    // 转换图片链接
    const convertedUrl = convertImageUrl(imageUrl);
    
    console.log(`[${taskId}] [DEBUG] Image URL conversion:`);
    console.log(`[${taskId}] [DEBUG] Original: ${imageUrl}`);
    console.log(`[${taskId}] [DEBUG] Converted: ${convertedUrl}`);
    
    // 🔥 重点：模拟发送给AI的过程，打印图片链接
    console.log(`\n======== [${taskId}] 🚀 SIMULATING SEND TO AI 🚀 ========`);
    console.log(`[${taskId}] [SIMULATION] 📤 This is what would be sent to AI service:`);
    console.log(`[${taskId}] [SIMULATION] Prompt: "${prompt}"`);
    console.log(`[${taskId}] [SIMULATION] ⬇️⬇️⬇️ IMAGE URL THAT WOULD BE SENT TO AI ⬇️⬇️⬇️`);
    console.log(convertedUrl);
    console.log(`[${taskId}] [SIMULATION] ⬆️⬆️⬆️ END OF IMAGE URL THAT WOULD BE SENT TO AI ⬆️⬆️⬆️`);
    console.log(`======== [${taskId}] 🚀 END SIMULATION 🚀 ========\n`);
    
    res.json({ 
      success: true, 
      message: '模拟发送给AI的图片链接已打印到控制台',
      taskId,
      originalUrl: imageUrl,
      convertedUrl: convertedUrl,
      prompt
    });
  } else {
    console.log(`[${taskId}] [ERROR] No image URL received for simulation`);
    res.status(400).json({ 
      success: false, 
      message: 'No imageUrl data provided for simulation' 
    });
  }
});

// 新增：测试图片链接转换的端点
app.post('/test-convert-url', (req, res) => {
  const { imageUrl } = req.body;
  
  if (!imageUrl) {
    return res.status(400).json({
      success: false,
      message: 'imageUrl is required'
    });
  }
  
  const convertedUrl = convertImageUrl(imageUrl);
  
  console.log(`[URL_CONVERT] Original: ${imageUrl}`);
  console.log(`[URL_CONVERT] Converted: ${convertedUrl}`);
  
  res.json({
    success: true,
    originalUrl: imageUrl,
    convertedUrl: convertedUrl
  });
});

// --- 通知 Vercel 的函数 ---
async function notifyVercel(taskId, status, data) {
    const webhookUrl = process.env.VERCEL_WEBHOOK_URL;
    const secret = process.env.WORKER_SECRET;

    if (!webhookUrl || !secret) {
        console.error(`[${taskId}] [FATAL] VERCEL_WEBHOOK_URL or WORKER_SECRET is not defined. Cannot notify Vercel.`);
        return;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-worker-secret': secret
            },
            body: JSON.stringify({
                taskId,
                status,
                ...data
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[${taskId}] [ERROR] ❌ Failed to notify Vercel. Status: ${response.status}, Body:`, errorBody);
        } else {
            console.log(`[${taskId}] [SUCCESS] ✅ Successfully notified Vercel with status: ${status}`);
        }
    } catch (error) {
        console.error(`[${taskId}] [ERROR] ❌ Failed to notify Vercel:`, error.message);
    }
}

// --- 启动服务器 ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Worker is listening on port ${PORT}`);
  console.log(`🖼️  Main endpoint: POST http://localhost:${PORT}/process-image`);
  console.log(`🔍  Debug endpoint: POST http://localhost:${PORT}/debug-send-to-ai`);
  console.log(`🔄  URL convert test: POST http://localhost:${PORT}/test-convert-url`);
  console.log(`\n📝 Usage examples:`);
  console.log(`   curl -X POST http://localhost:${PORT}/process-image -H "Content-Type: application/json" -d '{"taskId":"test123","prompt":"分析图片","imageUrl":"https://jubili.8a668a21c563ade0c297bd2404377b9a.r2.cloudflarestorage.com/1750039195939-7rB5Yl9_f2.jpg"}'`);
  console.log(`   curl -X POST http://localhost:${PORT}/debug-send-to-ai -H "Content-Type: application/json" -d '{"imageUrl":"https://jubili.8a668a21c563ade0c297bd2404377b9a.r2.cloudflarestorage.com/1750039195939-7rB5Yl9_f2.jpg"}'`);
  console.log(`   curl -X POST http://localhost:${PORT}/test-convert-url -H "Content-Type: application/json" -d '{"imageUrl":"https://jubili.8a668a21c563ade0c297bd2404377b9a.r2.cloudflarestorage.com/1750039195939-7rB5Yl9_f2.jpg"}'`);
});
