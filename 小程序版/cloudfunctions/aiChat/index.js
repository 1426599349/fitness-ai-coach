/**
 * aiChat 云函数 — Agent 架构
 * 架构：Harness 前置 → Agent Loop（Tool Calling）→ 返回
 * 独立 action（reward/meal_wheel/get_weekly_plan/clear_history）保留直接路由
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const validator = require('./harness/validator.js');
const bodyMetrics = require('./skills/bodyMetrics.js');
const { callAI } = require('./agent/aiClient.js');
const { agentLoop } = require('./agent/loop.js');

// ================================================================
// 深夜休息时段风控
// ================================================================
const QUIET_START = 23;  // 23:00
const QUIET_END = 7;     // 07:00
const QUIET_MSG = '🌙 夜色已深，该休息啦～\n\n充足的睡眠是肌肉恢复和脂肪代谢的黄金时间，比多练一小时更重要。\n\n先好好睡觉吧，天亮后我随时为你服务 💤';

function isQuietHours() {
  const hour = new Date().getHours();
  return hour >= QUIET_START || hour < QUIET_END;
}

// ================================================================
// 直接 Action 路由（不走 Agent）
// ================================================================

/**
 * 广告奖励：+10 积分
 */
async function handleReward(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    const current = (res.data && res.data.credits) ? res.data.credits : 200;
    const newCredits = current + 10;
    await db.collection('user_states').doc(openid).update({ data: { credits: newCredits } });
    return { type: 'text', content: `+10 积分！当前 ${newCredits} 积分`, credits: newCredits };
  } catch (e) {
    return { type: 'text', content: '奖励发放失败，请重试', credits: 0 };
  }
}

/**
 * 获取本周计划
 */
async function handleGetWeeklyPlan(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    return { plan: res.data.weeklyPlan || null };
  } catch (e) {
    return { plan: null };
  }
}

/**
 * 清除对话记忆
 */
async function handleClearHistory(openid) {
  try {
    await db.collection('user_states').doc(openid).update({ data: { conversationHistory: [] } });
    return { success: true };
  } catch (e) {
    return { success: false, error: '清除失败' };
  }
}

/**
 * 三餐转盘：AI 智能生成三餐（早/午/晚），三顿主食不重复
 */
async function handleMealWheel(openid, isRetry = false) {
  let profile = {};
  let allergies = [];
  let userMetrics = null;
  let credits = 200;

  try {
    const res = await db.collection('user_states').doc(openid).get();
    profile = res.data.profile || {};
    allergies = profile.allergies || [];
    credits = res.data.credits || 200;
    if (profile.height_cm && profile.weight_kg) {
      userMetrics = bodyMetrics.calculateMetrics(
        profile.height_cm, profile.weight_kg, profile.age || 25,
        profile.gender || 'male', profile.fitness_goal || 'maintain', 'moderate',
      );
    }
  } catch (e) {}

  // 未录入数据
  if (!profile.height_cm) {
    return {
      needProfile: true,
      message: '请先在「AI教练」页面录入你的身体数据（身高、体重、性别、年龄），我才能为你个性化推荐三餐。',
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  // 积分检查
  if (credits < 10) {
    return { error: `积分不足！（当前 ${credits} 分，需要 10 分）`, credits };
  }
  const newCredits = credits - 10;
  try { await db.collection('user_states').doc(openid).update({ data: { credits: newCredits } }); } catch (e) {}

  // AI 生成三餐
  try {
    const meals = await generateMealsWithAI(userMetrics, profile, allergies);
    try {
      await db.collection('user_states').doc(openid).update({ data: { lastWheelDate: today } });
    } catch (e) {}
    return { meals: meals.names, details: meals.details, date: today, credits: newCredits };
  } catch (aiErr) {
    // AI 失败 → 本地兜底
    console.warn('AI 三餐生成失败，回退本地:', aiErr.message);
    const foods = require('./data/foods.json');
    const staples = foods.staples.map(s => s.name);
    const mains = foods.mainDishes;
    const sides = foods.sideDishes;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const s1 = pick(staples); let s2 = pick(staples); while (s2 === s1) s2 = pick(staples);
    let s3 = pick(staples); while (s3 === s1 || s3 === s2) s3 = pick(staples);

    const makeDetail = (stapleName) => ({
      main_staple: stapleName + ' 180g',
      dishes: [
        { name: pick(mains).name, grams: 120, kcal: 180, protein_g: 15, fat_g: 10, carb_g: 8 },
        { name: pick(sides).name, grams: 100, kcal: 60, protein_g: 3, fat_g: 1, carb_g: 10 },
      ],
      total_kcal: 700 + Math.floor(Math.random() * 100),
      protein_g: 30 + Math.floor(Math.random() * 10),
      fat_g: 20 + Math.floor(Math.random() * 10),
      carb_g: 80 + Math.floor(Math.random() * 20),
    });

    try { await db.collection('user_states').doc(openid).update({ data: { lastWheelDate: today } }); } catch (e) {}
    return {
      meals: [s1, s2, s3],
      details: { breakfast: makeDetail(s1), lunch: makeDetail(s2), dinner: makeDetail(s3) },
      date: today, credits: newCredits,
    };
  }
}

/**
 * AI 生成三餐（内部辅助）
 */
async function generateMealsWithAI(userMetrics, profile, allergies) {
  const bmi = userMetrics ? userMetrics.bmi : 22;
  const bmiLabel = bmi < 18.5 ? '偏瘦' : bmi < 24 ? '标准' : bmi < 28 ? '偏胖' : '超重';
  const tdee = userMetrics ? userMetrics.tdee : 2000;
  const goal = profile.fitness_goal === 'fat_loss' ? '减脂' : profile.fitness_goal === 'muscle_gain' ? '增肌' : '维持身材';
  const allergyStr = allergies.length > 0 ? `\n用户忌口：${allergies.join('、')}，绝对不能出现。` : '';
  const likedFoods = profile.likedFoods || [];
  const picked = likedFoods.length > 0
    ? likedFoods[Math.floor(Math.random() * likedFoods.length)]
    : null;
  const likeStr = picked
    ? `\n用户喜欢"${picked}"，三餐中至少一餐围绕它搭配。`
    : '';

  const prompt = `你是专业营养师。根据用户数据智能搭配一日三餐。

用户数据：${profile.gender === 'male' ? '男' : '女'}，${profile.age}岁，身高${profile.height_cm}cm，体重${profile.weight_kg}kg
BMI：${bmi}（${bmiLabel}）
每日消耗热量：${tdee} kcal
健身目标：${goal}${allergyStr}${likeStr}

要求：
1. 早/午/晚三餐，中式家常，好吃不极端
2. 根据用户身体状况自主决定每餐热量和营养配比（超重就控制碳水和脂肪，偏瘦就适当增加）
3. 每餐主食+2~3道配菜（至少1蔬菜、1蛋白质），三顿主食不重复
4. 拒绝极端健身餐，要生活化
5. 给出每道菜克数、热量、蛋白质g、脂肪g、碳水g

纯JSON：
{"breakfast":{"main_staple":"主食 克g","dishes":[{"name":"菜","grams":克,"kcal":卡,"protein_g":蛋,"fat_g":脂,"carb_g":碳}],"total_kcal":卡,"protein_g":蛋,"fat_g":脂,"carb_g":碳},"lunch":{同样结构},"dinner":{同样结构}}`;

  const resp = await callAI([
    { role: 'system', content: '你是专业营养师，只输出JSON，不输出任何解释。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.8, maxTokens: 2500, jsonMode: true });

  // 解析 JSON
  let jsonStr = resp.content.trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];

  const data = JSON.parse(jsonStr);

  const keys = ['breakfast', 'lunch', 'dinner'];
  const details = {};
  const mealNames = [];

  for (const key of keys) {
    if (data[key]) {
      mealNames.push(data[key].main_staple || key);
      details[key] = data[key];
    }
  }

  return { names: mealNames, details };
}

// ================================================================
// 主入口
// ================================================================
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { type: 'text', content: '请先登录' };
  }

  // ——— 直接 action 路由 ———
  if (event.action === 'reward')           return handleReward(openid);
  if (event.action === 'meal_wheel') {
    if (isQuietHours()) return { type: 'text', content: QUIET_MSG };
    return handleMealWheel(openid, event.isRetry || false);
  }
  if (event.action === 'get_weekly_plan')  return handleGetWeeklyPlan(openid);
  if (event.action === 'clear_history')    return handleClearHistory(openid);

  // ——— 对话消息 ———
  const message = (event.message || '').trim();
  if (!message) {
    return { type: 'text', content: '请输入内容~' };
  }

  // 深夜休息时段风控
  if (isQuietHours()) {
    return { type: 'text', content: QUIET_MSG };
  }

  // Harness 前置：医疗红线
  const redline = validator.checkMedicalRedline(message);
  if (redline.blocked) {
    return { type: 'text', content: redline.message };
  }

  // 积分检查
  let credits = 200;
  try {
    const res = await db.collection('user_states').doc(openid).get();
    credits = (res.data && res.data.credits !== undefined) ? res.data.credits : 200;
  } catch (e) {}

  if (credits < 5) {
    return {
      type: 'text',
      content: `积分不足！（当前 ${credits} 分）\n\n每日签到可领取 20 积分，积分每 5 分钟自动回复 1 点`,
      credits,
      needCredits: true,
    };
  }

  // 扣分
  const newCredits = credits - 5;
  try {
    await db.collection('user_states').doc(openid).update({ data: { credits: newCredits } });
  } catch (e) {
    try {
      await db.collection('user_states').doc(openid).set({ data: { openid, credits: newCredits } });
    } catch (e2) {}
  }

  // —— Agent Loop ——
  let result;
  try {
    result = await agentLoop(openid, message);
  } catch (e) {
    console.error('[aiChat] Agent loop error:', e.message);
    result = { type: 'text', content: '我暂时无法回复，请稍后再试~', planUpdated: false };
  }

  // 注入积分
  result.credits = newCredits;
  return result;
};
