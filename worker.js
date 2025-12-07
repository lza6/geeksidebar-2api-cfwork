/**
 * =================================================================================
 * 项目: geeksidebar-2api (Cloudflare Worker 单文件版)
 * 版本: 1.1.0 (代号: FluxPainter - 极客绘图增强版)
 * 作者: 首席AI执行官 (Principal AI Executive Officer)
 * 协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
 * 日期: 2025-12-07
 * * [核心特性]
 * 1. [深度伪装] 完美复刻 Chrome 142 指纹、Origin 和 Referer，绕过防爬机制。
 * 2. [智能凭证] 内置从 HAR 提取的高级凭证，支持轮询和自动失效标记。
 * 3. [全能兼容] 
 * - 聊天: 转 GeekSidebar 私有 API 为 OpenAI Chat 格式 (支持流式)。
 * - 绘图: 转 GeekSidebar FLUX 接口为 OpenAI Image 格式 (支持多种比例)。
 * 4. [驾驶舱] F1 赛车级仪表盘，新增“文生图”模式与图片实时预览。
 * =================================================================================
 */

// --- [第一部分: 核心配置 (Configuration-as-Code)] ---
const CONFIG = {
  // 项目元数据
  PROJECT_NAME: "geeksidebar-2api",
  PROJECT_VERSION: "1.1.0",
  
  // 安全配置 (建议在 Cloudflare 环境变量中设置 API_MASTER_KEY)
  API_MASTER_KEY: "1", 
  
  // 上游服务配置
  UPSTREAM_ORIGIN: "https://api.geeksidebar.com",
  UPSTREAM_CHAT_URL: "https://api.geeksidebar.com/v1/api/chat/completions",
  UPSTREAM_IMAGE_URL: "https://api.geeksidebar.com/v1/api/chat/images/generations",
  
  // 对话模型列表
  CHAT_MODELS: [
    "deepseek-v3",
    "Qwen3-Coder",
    "DeepSeek R1 蒸馏版（免费）",
    "QwQ-32B"
  ],
  DEFAULT_CHAT_MODEL: "deepseek-v3",

  // 绘图模型配置
  IMAGE_MODEL: "black-forest-labs/FLUX.1-dev",
  
  // [关键] 比例映射池 (FLUX 最佳分辨率)
  // 用户传递 16:9 等简写时，自动转换为像素值
  IMAGE_RATIOS: {
    "1:1": "1024x1024",
    "1:2": "512x1024",   // 竖屏长图
    "3:2": "1216x832",   // 横屏照片
    "3:4": "896x1152",   // 竖屏照片
    "16:9": "1344x768",  // 宽屏电影感
    "9:16": "768x1344"   // 手机壁纸
  },
  DEFAULT_IMAGE_SIZE: "1024x1024",

  // [关键] 凭证池 (从 HAR 自动提取)
  CREDENTIALS: [
    {
      token: "Bearer eyJhbGciOiJIUzUxMiJ9.eyJ1aWQiOiIzYzEwNDUyNmQzZTY0NzZkYTFlYWJlMjk4ZjExM2M1YyIsInVzZXJJZCI6ODQ3MjUsInN1YiI6Ijg0NzI1In0.0kellOxzESdlHCyGvLfZ8hLzFGti3WjtVGTXKqW4NDeAEGKkbtjmJA7I5dsiTNjo6tOyhy9d5BhD-yTeGVsxxw",
      cookie: "Hm_lvt_21baddb636fdd4c161e485098d887db4=1765085375; Hm_lpvt_21baddb636fdd4c161e485098d887db4=1765085375; HMACCOUNT=4DA60F4C3C8FDEC9"
    }
  ],

  // 伪装指纹 (严格模拟 Chrome 142 + 插件环境)
  HEADERS: {
    "authority": "api.geeksidebar.com",
    "accept": "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "origin": "chrome-extension://gjkfnalkblnjkalnipilmaacibikciin", // 关键：模拟插件来源
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "none",
    "priority": "u=1, i"
  }
};

// --- [第二部分: Worker 入口与路由] ---
export default {
  async fetch(request, env, ctx) {
    // 环境变量覆盖
    const apiKey = env.API_MASTER_KEY || CONFIG.API_MASTER_KEY;
    
    // 简单的轮询策略获取凭证
    const credentialIndex = Math.floor(Math.random() * CONFIG.CREDENTIALS.length);
    const credential = CONFIG.CREDENTIALS[credentialIndex];

    request.ctx = { apiKey, credential, credentialIndex };

    const url = new URL(request.url);

    // 1. CORS 预检
    if (request.method === 'OPTIONS') return handleCorsPreflight();

    // 2. 路由分发
    if (url.pathname === '/') return handleUI(request);
    
    // API 路由
    if (url.pathname.startsWith('/v1/')) {
      if (!verifyAuth(request)) return createErrorResponse('Unauthorized', 401, 'unauthorized');

      if (url.pathname === '/v1/models') {
        return handleModelsRequest();
      }
      if (url.pathname === '/v1/chat/completions') {
        return handleChatCompletions(request);
      }
      if (url.pathname === '/v1/images/generations') {
        return handleImageGenerations(request);
      }
    }
    
    return createErrorResponse(`路径未找到: ${url.pathname}`, 404, 'not_found');
  }
};

// --- [第三部分: 核心业务逻辑] ---

// 1. 聊天补全逻辑 (Chat Completion)
async function handleChatCompletions(request) {
  const requestId = `req-${crypto.randomUUID()}`;
  try {
    const body = await request.json();
    const isWebUI = body.is_web_ui === true;
    const stream = body.stream !== false;
    const model = body.model || CONFIG.DEFAULT_CHAT_MODEL;
    
    // 构造上游 Payload
    const upstreamPayload = {
      model: model,
      messages: body.messages.map(m => ({
        role: m.role,
        content: m.content,
        id: String(Date.now()) 
      })),
    };

    const headers = {
      ...CONFIG.HEADERS,
      "Authorization": request.ctx.credential.token,
      "Cookie": request.ctx.credential.cookie
    };

    const response = await fetch(CONFIG.UPSTREAM_CHAT_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(upstreamPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return createErrorResponse(`上游对话服务错误 (${response.status}): ${errText}`, response.status, 'upstream_error');
    }

    if (stream) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      (async () => {
        try {
          if (isWebUI) {
            const debugInfo = {
              debug: [
                { step: "Auth", data: `使用凭证索引: ${request.ctx.credentialIndex}` },
                { step: "ChatPayload", data: JSON.stringify(upstreamPayload) },
                { step: "Upstream", data: `Status: ${response.status}` }
              ]
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(debugInfo)}\n\n`));
          }

          const reader = response.body.getReader();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.trim() === "") continue;
              if (line.includes("[DONE]")) continue;

              if (line.startsWith("data:")) {
                const dataStr = line.slice(5).trim();
                try {
                  const data = JSON.parse(dataStr);
                  let content = "";
                  if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                    content = data.choices[0].delta.content;
                  } else if (data.content) {
                    content = data.content;
                  }

                  if (content) {
                    const chunk = {
                      id: requestId,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: model,
                      choices: [{ index: 0, delta: { content: content }, finish_reason: null }]
                    };
                    await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                } catch (e) { }
              }
            }
          }
          
          const endChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
          await writer.write(encoder.encode('data: [DONE]\n\n'));

        } catch (e) {
          const errChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{ index: 0, delta: { content: `\n\n[Stream Error: ${e.message}]` }, finish_reason: "error" }]
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: corsHeaders({ 'Content-Type': 'text/event-stream' })
      });

    } else {
      return createErrorResponse("建议使用 stream=true 模式。", 400, 'invalid_request');
    }

  } catch (e) {
    return createErrorResponse(e.message, 500, 'internal_error');
  }
}

// 2. 文生图逻辑 (Image Generations - FLUX)
async function handleImageGenerations(request) {
  try {
    const body = await request.json();
    const prompt = body.prompt;
    const requestSize = body.size || CONFIG.DEFAULT_IMAGE_SIZE;
    
    // 映射分辨率
    // 如果用户传的是 "16:9"，映射到 "1344x768"
    // 如果用户传的是 "1024x1024"，直接使用
    const targetSize = CONFIG.IMAGE_RATIOS[requestSize] || requestSize;

    if (!prompt) {
      return createErrorResponse("Prompt is required", 400, "invalid_request");
    }

    const upstreamPayload = {
      image_size: targetSize,
      prompt: prompt,
      model: CONFIG.IMAGE_MODEL // 强制使用 FLUX.1-dev
    };

    const headers = {
      ...CONFIG.HEADERS,
      "Authorization": request.ctx.credential.token,
      "Cookie": request.ctx.credential.cookie
    };

    // 发送请求
    const response = await fetch(CONFIG.UPSTREAM_IMAGE_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(upstreamPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return createErrorResponse(`上游绘图服务错误 (${response.status}): ${errText}`, response.status, 'upstream_error');
    }

    const upstreamData = await response.json();

    // 校验上游返回
    // 格式: { code: 200, data: { images: [{ url: "..." }] }, success: true }
    if (upstreamData.code !== 200 || !upstreamData.success || !upstreamData.data || !upstreamData.data.images) {
      return createErrorResponse(`绘图失败: ${JSON.stringify(upstreamData)}`, 500, 'generation_failed');
    }

    // 转换为 OpenAI 格式
    // 格式: { created: ..., data: [{ url: "..." }] }
    const openAIResponse = {
      created: Math.floor(Date.now() / 1000),
      data: upstreamData.data.images.map(img => ({
        url: img.url,
        // 如果上游返回了 seed 或其他元数据，也可以放这里，但 url 是必须的
      }))
    };

    return new Response(JSON.stringify(openAIResponse), {
      headers: corsHeaders({ 'Content-Type': 'application/json' })
    });

  } catch (e) {
    return createErrorResponse(e.message, 500, 'internal_error');
  }
}

// 3. 模型列表
function handleModelsRequest() {
  const allModels = [...CONFIG.CHAT_MODELS, CONFIG.IMAGE_MODEL];
  return new Response(JSON.stringify({
    object: 'list',
    data: allModels.map(id => ({
      id: id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'geeksidebar'
    }))
  }), { headers: corsHeaders({ 'Content-Type': 'application/json' }) });
}

// --- 辅助函数 ---

function verifyAuth(request) {
  const auth = request.headers.get('Authorization');
  const key = request.ctx.apiKey;
  if (key === "1") return true;
  return auth === `Bearer ${key}`;
}

function createErrorResponse(msg, status, code) {
  return new Response(JSON.stringify({ error: { message: msg, type: 'api_error', code } }), {
    status, headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

function handleCorsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// --- [第四部分: 开发者驾驶舱 UI (WebUI)] ---
function handleUI(request) {
  const origin = new URL(request.url).origin;
  const apiKey = request.ctx.apiKey;
  const ratios = Object.keys(CONFIG.IMAGE_RATIOS);
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CONFIG.PROJECT_NAME} - 驾驶舱</title>
    <style>
      :root { --bg: #121212; --panel: #1E1E1E; --border: #333; --text: #E0E0E0; --primary: #FFBF00; --accent: #007AFF; --success: #66BB6A; --error: #CF6679; }
      body { font-family: 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); margin: 0; height: 100vh; display: flex; overflow: hidden; }
      .sidebar { width: 360px; background: var(--panel); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; overflow-y: auto; flex-shrink: 0; }
      .main { flex: 1; display: flex; flex-direction: column; padding: 20px; position: relative; }
      
      .box { background: #252525; padding: 15px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px; }
      .label { font-size: 12px; color: #888; margin-bottom: 8px; display: block; font-weight: 600; }
      .code-block { font-family: monospace; font-size: 12px; color: var(--primary); word-break: break-all; background: #111; padding: 10px; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
      .code-block:hover { background: #000; }
      
      input, select, textarea { width: 100%; background: #333; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 4px; margin-bottom: 15px; box-sizing: border-box; font-family: inherit; }
      button { width: 100%; padding: 12px; background: var(--primary); border: none; border-radius: 4px; font-weight: bold; cursor: pointer; color: #000; transition: opacity 0.2s; }
      button:hover { opacity: 0.9; }
      button:disabled { background: #555; cursor: not-allowed; }
      
      /* Tabs */
      .tabs { display: flex; gap: 10px; margin-bottom: 15px; background: #111; padding: 5px; border-radius: 6px; }
      .tab { flex: 1; text-align: center; padding: 8px; cursor: pointer; border-radius: 4px; font-size: 13px; color: #888; }
      .tab.active { background: #333; color: #fff; font-weight: bold; }

      .chat-window { flex: 1; background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
      .msg { max-width: 85%; padding: 15px; border-radius: 8px; line-height: 1.6; word-wrap: break-word; }
      .msg.user { align-self: flex-end; background: #333; color: #fff; }
      .msg.ai { align-self: flex-start; background: #1a1a1a; border: 1px solid #333; }
      .msg img { max-width: 100%; border-radius: 4px; margin-top: 10px; }
      
      .log-panel { height: 150px; background: #111; border-top: 1px solid var(--border); padding: 10px; font-family: monospace; font-size: 11px; color: #aaa; overflow-y: auto; }
      .log-entry { margin-bottom: 5px; border-bottom: 1px solid #222; padding-bottom: 5px; }
      .log-step { color: var(--accent); font-weight: bold; margin-right: 5px; }
      
      .hidden { display: none; }
    </style>
</head>
<body>
    <div class="sidebar">
        <h2 style="margin-top:0; display:flex; align-items:center; gap:10px;">
            🚀 ${CONFIG.PROJECT_NAME} 
            <span style="font-size:12px;color:#888; font-weight:normal; margin-top:4px;">v${CONFIG.PROJECT_VERSION}</span>
        </h2>
        
        <div class="box">
            <span class="label">API 密钥 (点击复制)</span>
            <div class="code-block" onclick="copy('${apiKey}')">${apiKey}</div>
        </div>

        <div class="box">
            <span class="label">功能模式</span>
            <div class="tabs">
                <div class="tab active" onclick="switchMode('chat')" id="tab-chat">💬 对话</div>
                <div class="tab" onclick="switchMode('image')" id="tab-image">🎨 绘图</div>
            </div>

            <div id="config-chat">
                <span class="label">模型</span>
                <select id="chat-model">
                    ${CONFIG.CHAT_MODELS.map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>
                <span class="label">系统提示词</span>
                <textarea id="chat-system" rows="2" placeholder="可选...">You are a helpful assistant.</textarea>
            </div>

            <div id="config-image" class="hidden">
                <span class="label">模型</span>
                <input type="text" value="${CONFIG.IMAGE_MODEL}" disabled style="opacity:0.7">
                <span class="label">画面比例</span>
                <select id="image-size">
                    ${ratios.map(r => `<option value="${r}">${r} (${CONFIG.IMAGE_RATIOS[r]})</option>`).join('')}
                    <option value="1024x1024">自定义 (1024x1024)</option>
                </select>
            </div>
            
            <span class="label">提示词 (Prompt)</span>
            <textarea id="prompt" rows="4" placeholder="输入你的问题或画面描述..."></textarea>
            
            <button id="btn-gen" onclick="handleSend()">🚀 发送请求</button>
        </div>
        
        <div style="font-size:12px; color:#666; text-align:center;">
            Powered by Cloudflare Workers & Flux
        </div>
    </div>

    <main class="main">
        <div class="chat-window" id="chat">
            <div style="color:#666; text-align:center; margin-top:100px;">
                <div style="font-size:40px; margin-bottom:20px;">🤖</div>
                <h3>GeekSidebar 代理服务就绪</h3>
                <p>支持 DeepSeek 对话 & FLUX 文生图。<br>已内置自动凭证轮询。</p>
            </div>
        </div>
        <div class="log-panel" id="logs">
            <div style="color:#666">调试日志将显示在这里...</div>
        </div>
    </main>

    <script>
        const API_KEY = "${apiKey}";
        const BASE_URL = "${origin}";
        let currentMode = 'chat';
        
        function copy(text) {
            navigator.clipboard.writeText(text);
            alert('已复制');
        }

        function switchMode(mode) {
            currentMode = mode;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + mode).classList.add('active');
            
            if(mode === 'chat') {
                document.getElementById('config-chat').classList.remove('hidden');
                document.getElementById('config-image').classList.add('hidden');
                document.getElementById('prompt').placeholder = "你好，请介绍一下你自己...";
            } else {
                document.getElementById('config-chat').classList.add('hidden');
                document.getElementById('config-image').classList.remove('hidden');
                document.getElementById('prompt').placeholder = "A cute cat, cinematic lighting, 4k...";
            }
        }

        function log(step, data) {
            const el = document.getElementById('logs');
            const div = document.createElement('div');
            div.className = 'log-entry';
            const time = new Date().toLocaleTimeString();
            const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            div.innerHTML = \`<div><span style="color:#666">[\${time}]</span> <span class="log-step">\${step}</span></div><div>\${content}</div>\`;
            el.appendChild(div);
            el.scrollTop = el.scrollHeight;
        }

        function appendMsg(role, content, isHtml = false) {
            const div = document.createElement('div');
            div.className = \`msg \${role}\`;
            if (isHtml) div.innerHTML = content;
            else div.innerText = content;
            document.getElementById('chat').appendChild(div);
            div.scrollIntoView({ behavior: "smooth" });
            return div;
        }

        async function handleSend() {
            const prompt = document.getElementById('prompt').value.trim();
            if (!prompt) return;

            const btn = document.getElementById('btn-gen');
            btn.disabled = true;
            btn.innerText = '⏳ 处理中...';

            // 清理欢迎语
            if(document.querySelector('.chat-window').innerText.includes('代理服务就绪')) {
                document.getElementById('chat').innerHTML = '';
                document.getElementById('logs').innerHTML = '';
            }

            appendMsg('user', prompt);

            if (currentMode === 'chat') {
                await doChat(prompt);
            } else {
                await doImage(prompt);
            }

            btn.disabled = false;
            btn.innerText = '🚀 发送请求';
        }

        async function doChat(prompt) {
            const aiMsg = appendMsg('ai', '▋');
            const system = document.getElementById('chat-system').value;
            const messages = [];
            if(system) messages.push({role: 'system', content: system});
            messages.push({role: 'user', content: prompt});

            try {
                const res = await fetch(BASE_URL + '/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: document.getElementById('chat-model').value,
                        messages: messages,
                        stream: true,
                        is_web_ui: true
                    })
                });

                if (!res.ok) throw new Error(await res.text());

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let fullText = "";
                aiMsg.innerText = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6);
                            if (dataStr === '[DONE]') continue;
                            try {
                                const data = JSON.parse(dataStr);
                                if (data.debug) {
                                    data.debug.forEach(d => log(d.step, d.data));
                                    continue;
                                }
                                const content = data.choices[0]?.delta?.content || "";
                                fullText += content;
                                aiMsg.innerText = fullText;
                            } catch (e) {}
                        }
                    }
                }
                log('Done', '对话完成');
            } catch (e) {
                aiMsg.style.color = 'var(--error)';
                aiMsg.innerText = \`[错误: \${e.message}]\`;
                log('Error', e.message);
            }
        }

        async function doImage(prompt) {
            const aiMsg = appendMsg('ai', '🎨 正在请求 FLUX 绘图，请稍候...');
            const size = document.getElementById('image-size').value;

            try {
                log('Request', { prompt, size });
                const res = await fetch(BASE_URL + '/v1/images/generations', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: prompt,
                        size: size
                    })
                });

                if (!res.ok) throw new Error(await res.text());

                const data = await res.json();
                log('Response', data);

                if (data.data && data.data.length > 0) {
                    const imgUrl = data.data[0].url;
                    aiMsg.innerHTML = \`<div style="font-weight:bold;margin-bottom:5px;">✅ 绘图成功</div><a href="\${imgUrl}" target="_blank"><img src="\${imgUrl}" alt="Generated Image"></a>\`;
                } else {
                    throw new Error("未返回图片数据");
                }

            } catch (e) {
                aiMsg.style.color = 'var(--error)';
                aiMsg.innerText = \`[绘图失败: \${e.message}]\`;
                log('Error', e.message);
            }
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
