// 引入必要的库
const express = require('express');
const axios = require('axios');
require('dotenv').config(); // 加载环境变量

// 创建 Express 应用
const app = express();

// --- vvvvvv 在这里进行修改 vvvvvv ---
// 增加 JSON 和 URL-encoded 请求体的大小限制，比如增加到 50mb
// 这是解决 "PayloadTooLargeError" 的关键
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// --- ^^^^^^ 修改结束 ^^^^^^ ---

// --- 工人的主入口 ---
app.post('/process-image', (req, res) => {
  const { taskId, prompt, imageBase64 } = req.body;

  // 日志1：确认收到 Vercel 的请求
  console.log(`\n\n--- [${taskId}] NEW TASK RECEIVED ---`);
  console.log(`[${taskId}] [INFO] 📡 Received prompt: "${prompt}"`);
  
  // 只记录是否接收到图片，不打印具体内容
  if (imageBase64) {
    console.log(`[${taskId}] [INFO] 🖼️ Received base64 image data (length: ${imageBase64.length} characters)`);
  }

  // 立刻响应 Vercel，告诉它"任务我收到了！"
  res.status(200).send({ message: 'Task accepted and is being processed.' });

  // 在后台异步执行真正的耗时任务
  processImageGeneration(taskId, prompt, imageBase64);
});

// --- 真正的 AI 处理函数 ---
async function processImageGeneration(taskId, prompt, imageBase64 = null) {
  // 日志2：打印出将要使用的环境变量和参数（密钥做掩码处理）
  const apiKey = process.env.YUNWU_API_KEY;
  const apiKeyForDisplay = apiKey ? `sk-.......${apiKey.slice(-4)}` : "未定义(undefined)";
  
  console.log(`--- [${taskId}] DEBUG INFO ---`);
  console.log(`[${taskId}] [DEBUG] Model to be used: 'gpt-4o-image-vip'`);
  console.log(`[${taskId}] [DEBUG] API Key being used (masked): ${apiKeyForDisplay}`);
  console.log(`[${taskId}] [DEBUG] Has base64 image: ${imageBase64 ? 'Yes' : 'No'}`);
  console.log(`--- [${taskId}] END DEBUG INFO ---`);

  try {
    // 构建消息内容
    let messageContent;
    let base64ToSend = null; // 要发送给AI的base64编码
    
    if (imageBase64) {
      // 处理可能包含data URL前缀的base64
      if (imageBase64.startsWith('data:')) {
        const parts = imageBase64.split(',');
        if (parts.length === 2) {
          base64ToSend = parts[1]; // 纯base64部分
        } else {
          base64ToSend = imageBase64;
        }
      } else {
        base64ToSend = imageBase64;
      }
      
      // ===== 🔥 重点：打印即将发送给AI的base64编码 🔥 =====
      console.log(`\n======== [${taskId}] 🚀 SENDING TO AI 🚀 ========`);
      console.log(`[${taskId}] [SEND_TO_AI] 📤 About to send the following base64 image to AI service:`);
      console.log(`[${taskId}] [SEND_TO_AI] Base64 length: ${base64ToSend.length} characters`);
      console.log(`[${taskId}] [SEND_TO_AI] ⬇️⬇️⬇️ COMPLETE BASE64 ENCODING BEING SENT TO AI ⬇️⬇️⬇️`);
      console.log(base64ToSend);
      console.log(`[${taskId}] [SEND_TO_AI] ⬆️⬆️⬆️ END OF BASE64 ENCODING BEING SENT TO AI ⬆️⬆️⬆️`);
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
            url: `data:image/jpeg;base64,${base64ToSend}`
          }
        }
      ];
    } else {
      // 纯文本消息
      messageContent = prompt;
    }

    // 日志3：准备调用外部 API
    console.log(`[${taskId}] [INFO] ➡️ Calling yunwu.ai API...`);
    
    const response = await axios.post(
      'https://yunwu.ai/v1/chat/completions',
      {
        model: 'gpt-4o-image-vip',
        messages: [{ role: 'user', content: messageContent }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 300000 
      }
    );

    // 日志4：外部 API 调用成功
    console.log(`[${taskId}] [SUCCESS] ✅ yunwu.ai API responded with status: ${response.status}`);

    const content = response.data.choices[0].message.content;
    
    console.log(`[${taskId}] [DEBUG] Full AI response content:`, content);
    
    // 日志5：准备解析返回结果
    console.log(`[${taskId}] [INFO] 🧠 Parsing response content...`);
    const match = content.match(/!\[.*?\]\((https:\/\/filesystem\.site.*?)\)/);

    if (!match || !match[1]) {
        throw new Error('Could not parse image URL from AI response. No match found.');
    }
    const imageUrl = match[1];
    console.log(`[${taskId}] [SUCCESS] ✅ Image URL parsed successfully.`);

    // 日志6：准备回调 Vercel Webhook
    console.log(`[${taskId}] [INFO] ↪️ Notifying Vercel with 'completed' status...`);
    await notifyVercel(taskId, 'completed', { resultUrl: imageUrl });

  } catch (error) {
    // 日志7：捕获到任何环节的错误
    console.error(`[${taskId}] [ERROR] ❌ An error occurred during processing!`);
    
    if (error.response) {
      console.error(`[${taskId}] [ERROR] AI Service responded with status: ${error.response.status}`);
      console.error(`[${taskId}] [ERROR] AI Service responded with data:`, error.response.data);
      await notifyVercel(taskId, 'failed', { error: `AI service responded with status ${error.response.status}` });
    } else if (error.request) {
      console.error(`[${taskId}] [ERROR] No response received from AI service:`, error.request);
      await notifyVercel(taskId, 'failed', { error: 'No response from AI service.' });
    } else {
      console.error(`[${taskId}] [ERROR] Error message:`, error.message);
      await notifyVercel(taskId, 'failed', { error: error.message });
    }
  }
}

// 新增：专门用于调试发送给AI的base64图片的端点
app.post('/debug-send-to-ai', (req, res) => {
  const { imageBase64, prompt = "请分析这张图片" } = req.body;
  const taskId = `DEBUG_${Date.now()}`;
  
  console.log(`\n\n--- [${taskId}] DEBUG: SIMULATE SENDING TO AI ---`);
  
  if (imageBase64) {
    let base64ToSend;
    
    // 处理可能包含data URL前缀的base64
    if (imageBase64.startsWith('data:')) {
      const parts = imageBase64.split(',');
      if (parts.length === 2) {
        base64ToSend = parts[1]; // 纯base64部分
        console.log(`[${taskId}] [DEBUG] Detected data URL format, extracted pure base64`);
      } else {
        base64ToSend = imageBase64;
      }
    } else {
      base64ToSend = imageBase64;
    }
    
    // 🔥 重点：模拟发送给AI的过程，打印完整base64编码
    console.log(`\n======== [${taskId}] 🚀 SIMULATING SEND TO AI 🚀 ========`);
    console.log(`[${taskId}] [SIMULATION] 📤 This is what would be sent to AI service:`);
    console.log(`[${taskId}] [SIMULATION] Prompt: "${prompt}"`);
    console.log(`[${taskId}] [SIMULATION] Base64 length: ${base64ToSend.length} characters`);
    console.log(`[${taskId}] [SIMULATION] ⬇️⬇️⬇️ COMPLETE BASE64 THAT WOULD BE SENT TO AI ⬇️⬇️⬇️`);
    console.log(base64ToSend);
    console.log(`[${taskId}] [SIMULATION] ⬆️⬆️⬆️ END OF BASE64 THAT WOULD BE SENT TO AI ⬆️⬆️⬆️`);
    console.log(`======== [${taskId}] 🚀 END SIMULATION 🚀 ========\n`);
    
    res.json({ 
      success: true, 
      message: '模拟发送给AI的base64编码已打印到控制台',
      taskId,
      base64Length: base64ToSend.length,
      prompt
    });
  } else {
    console.log(`[${taskId}] [ERROR] No base64 image data received for simulation`);
    res.status(400).json({ 
      success: false, 
      message: 'No imageBase64 data provided for simulation' 
    });
  }
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
        await axios.post(webhookUrl, {
            taskId,
            status,
            ...data
        }, {
            headers: {
                'x-worker-secret': secret
            }
        });
        console.log(`[${taskId}] [SUCCESS] ✅ Successfully notified Vercel with status: ${status}`);
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
  console.log(`\n📝 Usage examples:`);
  console.log(`   curl -X POST http://localhost:${PORT}/process-image -H "Content-Type: application/json" -d '{"taskId":"test123","prompt":"分析图片","imageBase64":"your_base64_here"}'`);
  console.log(`   curl -X POST http://localhost:${PORT}/debug-send-to-ai -H "Content-Type: application/json" -d '{"imageBase64":"your_base64_here"}'`);
});
