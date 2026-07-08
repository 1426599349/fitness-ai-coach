/**
 * 共享 AI 调用客户端 — 支持 Tool Calling
 * 被 index.js（action handler）和 loop.js（agent）共用
 */
const AI_CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  url: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
};

/**
 * 调用 DeepSeek API
 * @param {Array} messages - 对话消息数组
 * @param {Object} opts - { temperature, maxTokens, tools, jsonMode }
 * @returns {Promise<{content: string, tool_calls: Array|null}>} AI 响应
 */
async function callAI(messages, opts = {}) {
  if (!AI_CONFIG.apiKey) {
    throw new Error('AI API Key 未配置，请在云函数环境变量中设置 DEEPSEEK_API_KEY');
  }
  const https = require('https');
  const http = require('http');
  const urlModule = require('url');
  const parsedUrl = urlModule.parse(AI_CONFIG.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const bodyObj = {
    model: AI_CONFIG.model,
    messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
    max_tokens: opts.maxTokens || 2000,
  };

  // 支持 Tool Calling
  if (opts.tools && opts.tools.length > 0) {
    bodyObj.tools = opts.tools;
    bodyObj.tool_choice = 'auto';
  }

  // JSON 模式（仅在无 tools 时使用）
  if (opts.jsonMode && !opts.tools) {
    bodyObj.response_format = { type: 'json_object' };
  }

  const body = JSON.stringify(bodyObj);

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
        'Accept': 'application/json',
      },
      timeout: 18000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || 'AI API error'));
            return;
          }
          const msg = json.choices[0].message;
          // 统一返回格式：content + tool_calls
          resolve({
            content: msg.content || '',
            tool_calls: msg.tool_calls || null,
          });
        } catch (e) {
          reject(new Error('AI 响应解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('AI 调用超时')); });
    req.write(body);
    req.end();
  });
}

module.exports = { callAI, AI_CONFIG };
