/**
 * Agent Loop — 核心循环逻辑
 * 接收用户消息 → 构建上下文 → 调用 AI（含 Tool Calling）→ 执行工具 → 循环 → 返回最终回复
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { callAI } = require('./aiClient.js');
const { buildSystemPrompt } = require('./systemPrompt.js');
const { TOOL_DEFINITIONS, executeTool } = require('./tools.js');

const MAX_ROUNDS = 5;       // 最大工具调用轮数
const MAX_HISTORY = 20;     // 最多保留最近 20 条对话

/**
 * Agent 主循环
 * @param {string} openid - 用户 openid
 * @param {string} userMessage - 用户消息
 * @returns {Promise<{type: string, content: string, planUpdated: boolean}>}
 */
async function agentLoop(openid, userMessage) {
  // —— 上下文对象（跨工具共享） ——
  const ctx = {
    openid,
    profile: null,
    metrics: null,
    credits: 200,
    planUpdated: false,
    lastStaple: null,
  };

  // —— 1. 加载用户状态 ——
  const userState = await loadUserState(openid);
  ctx.profile = userState.profile || null;
  ctx.metrics = userState.metrics || null;
  ctx.credits = userState.credits || 200;
  ctx.lastStaple = userState.lastStaple || null;

  // —— 2. 构建对话 messages ——
  const systemPrompt = buildSystemPrompt(userState);
  const history = (userState.conversationHistory || []).slice(-MAX_HISTORY);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  // —— 3. Agent 循环 ——
  let finalContent = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let resp;
    try {
      resp = await callAI(messages, {
        tools: TOOL_DEFINITIONS,
        temperature: 0.7,
        maxTokens: 2000,
      });
    } catch (e) {
      console.error(`[AgentLoop] Round ${round} AI error:`, e.message);
      finalContent = '我暂时无法回复，请稍后再试~';
      break;
    }

    // 无工具调用 → Agent 决定直接回复
    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      finalContent = resp.content || '';
      break;
    }

    // 有工具调用 → 将 assistant 消息（含 tool_calls）加入 messages
    messages.push({
      role: 'assistant',
      content: resp.content || null,
      tool_calls: resp.tool_calls,
    });

    // 逐个执行工具
    for (const tc of resp.tool_calls) {
      const toolName = tc.function.name;
      let toolArgs;
      try {
        toolArgs = JSON.parse(tc.function.arguments || '{}');
      } catch (e) {
        toolArgs = {};
      }

      console.log(`[AgentLoop] Round ${round} Tool: ${toolName}`, JSON.stringify(toolArgs).slice(0, 200));

      let toolResult;
      try {
        toolResult = await executeTool(toolName, toolArgs, ctx);
      } catch (e) {
        console.error(`[AgentLoop] Tool ${toolName} error:`, e.message);
        toolResult = { error: `工具执行失败: ${e.message}` };
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }

    // 最后一轮仍无 finalContent → 强制让 AI 回复
    if (round === MAX_ROUNDS - 1 && !finalContent) {
      try {
        const finalResp = await callAI(messages, {
          temperature: 0.7,
          maxTokens: 1000,
        });
        finalContent = finalResp.content || '已处理完毕~';
      } catch (e) {
        finalContent = '已处理完毕~';
      }
    }
  }

  if (!finalContent) {
    finalContent = '抱歉，我暂时无法处理这个请求，请稍后再试~';
  }

  // —— 4. 保存对话记忆 ——
  await saveConversationTurn(openid, userMessage, finalContent);

  // —— 5. 返回结果 ——
  return {
    type: 'text',
    content: finalContent,
    planUpdated: ctx.planUpdated,
  };
}

// ================================================================
// 上下文加载/保存（与旧版 index.js 逻辑一致）
// ================================================================

async function loadUserState(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    return res.data;
  } catch (e) {
    return {
      convState: 'greeting',
      profile: null,
      metrics: null,
      lastStaple: null,
      conversationHistory: [],
    };
  }
}

async function saveConversationTurn(openid, userMsg, aiContent) {
  let history = [];
  try {
    const res = await db.collection('user_states').doc(openid).get();
    history = res.data.conversationHistory || [];
  } catch (e) {}
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: aiContent });
  const trimmed = history.slice(-MAX_HISTORY);
  try {
    await db.collection('user_states').doc(openid).update({ data: { conversationHistory: trimmed } });
  } catch (e) {
    try {
      await db.collection('user_states').doc(openid).set({ data: { conversationHistory: trimmed } });
    } catch (e2) {}
  }
}

module.exports = { agentLoop };
