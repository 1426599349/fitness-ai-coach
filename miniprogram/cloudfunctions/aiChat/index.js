/**
 * aiChat 云函数 — AI对话核心引擎
 * 架构：MCP中控调度 + Skill能力调用 + Harness约束校验
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const bodyMetrics = require('./skills/bodyMetrics.js');
const workoutPlanner = require('./skills/workoutPlanner.js');
const mealPlanner = require('./skills/mealPlanner.js');
const staplePicker = require('./skills/staplePicker.js');
const validator = require('./harness/validator.js');
const exercises = require('./data/exercises.js');

// ================================================================
// DeepSeek API 配置
// ================================================================
const AI_CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  url: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  timeout: 15000,
};

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

  const body = JSON.stringify({
    model: AI_CONFIG.model,
    messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
    max_tokens: opts.maxTokens || 2000,
    response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
  });

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
          resolve(json.choices[0].message.content);
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

// ================================================================
// 对话记忆（每次对话喂给AI，实现上下文连续）
// ================================================================
const MAX_HISTORY = 20; // 最多保留最近20条消息

async function getConversationHistory(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    return res.data.conversationHistory || [];
  } catch (e) {
    return [];
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
    // 文档可能不存在，尝试 set
    try {
      await db.collection('user_states').doc(openid).set({ data: { conversationHistory: trimmed } });
    } catch (e2) {}
  }
}

function formatHistoryForPrompt(history) {
  if (!history || history.length === 0) return '';
  return '\n\n【对话记忆】以下是本次会话中用户之前说的话和你的回复，请结合记忆理解用户的连续意图：\n' +
    history.map(h => (h.role === 'user' ? '用户' : 'AI') + '：' + h.content).join('\n');
}

// ================================================================
// 对话状态机
// ================================================================
const STATE = {
  GREETING: 'greeting',
  ONBOARDING: 'onboarding',
  READY: 'ready',
};

exports.main = async (event, context) => {
  const { message, context: ctx = {} } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { type: 'text', content: '请先登录' };
  }

  // --- 广告奖励 ---
  if (event.action === 'reward') {
    return handleReward(openid);
  }

  // --- 三餐转盘 ---
  if (event.action === 'meal_wheel') {
    return handleMealWheel(openid, event.isRetry || false);
  }

  // --- 获取本周计划 ---
  if (event.action === 'get_weekly_plan') {
    return handleGetWeeklyPlan(openid);
  }

  // --- 清除对话记忆 ---
  if (event.action === 'clear_history') {
    try {
      await db.collection('user_states').doc(openid).update({ data: { conversationHistory: [] } });
      return { success: true };
    } catch (e) {
      return { success: false, error: '清除失败' };
    }
  }

  // --- 生成本周计划 ---
  if (event.action === 'generate_weekly_plan') {
    return handleWeeklyPlan(openid);
  }

  // --- 医疗红线 ---
  const redline = validator.checkMedicalRedline(message);
  if (redline.blocked) {
    return { type: 'text', content: redline.message };
  }

  // --- 加载用户状态 ---
  const userState = await loadUserState(openid);
  const intent = detectIntent(message, userState);

  // --- 统一初始化积分 ---
  ensureCredits(userState);

  // --- 积分校验 ---
  const credits = userState.credits;
  if (credits < 5) {
    return {
      type: 'text',
      content: `积分不足！（当前 ${credits} 分）\n\n每日签到可领取 5 积分，积分每 5 分钟自动回复 1 点`,
      credits: credits,
      needCredits: true,
    };
  }
  const newCredits = credits - 5;
  await db.collection('user_states').doc(openid).update({ data: { credits: newCredits } });
  userState.credits = newCredits;

  // --- 执行对应流程 ---
  let result;
  switch (intent) {
    case 'onboarding':
      result = await handleOnboarding(openid, message, userState);
      break;
    case 'meal':
      result = await handleMeal(openid, userState);
      break;
    case 'regenerate_meal':
      result = await handleRegenerateMeal(openid, userState);
      break;
    case 'workout':
      result = await handleWorkout(openid, userState);
      break;
    case 'modify_plan':
      result = await handleModifyPlan(openid, message, userState);
      break;
    case 'checkin':
      result = await handleCheckin(openid, message, userState);
      break;
    default:
      result = await handleGeneralChat(openid, message, userState);
  }

  // 注入剩余积分
  result.credits = userState.credits || 0;

  // 保存对话记忆：用户消息 + AI 回复（非查询类action才保存）
  if (message && result.content && !event.action) {
    await saveConversationTurn(openid, message, result.content);
  }

  return result;
};

/**
 * 广告奖励：+10积分
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
 * 生成本周训练计划——AI 严格按周一到周日
 */
async function handleGetWeeklyPlan(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    return { plan: res.data.weeklyPlan || null };
  } catch (e) {
    return { plan: null };
  }
}

async function handleWeeklyPlan(openid) {
  let profile = {};
  try {
    const res = await db.collection('user_states').doc(openid).get();
    profile = res.data.profile || {};
  } catch (e) {}

  if (!profile.height_cm) {
    return { error: '请先录入身体数据' };
  }

  try {
    const plan = await generateWeeklyPlanWithAI(profile);
    // 缓存到用户状态
    try {
      await db.collection('user_states').doc(openid).update({ data: { weeklyPlan: plan } });
    } catch (e) {}
    return { plan };
  } catch (e) {
    console.warn('AI周计划失败:', e.message);
    return { plan: fallbackWeeklyPlan(profile) };
  }
}

async function generateWeeklyPlanWithAI(profile, feedback = '') {
  const isHome = profile.place !== 'gym';
  const level = profile.fitness_level || 'beginner';
  const fb = feedback ? `\n用户反馈：${feedback}。请据此调整计划强度。` : '';

  // 从动作库筛选候选动作
  const candidatePool = exercises.filterForPrompt(isHome ? 'home' : 'gym', level);
  // 按肌群分组
  const byMuscle = {};
  for (const ex of candidatePool) {
    if (!byMuscle[ex.muscle]) byMuscle[ex.muscle] = [];
    byMuscle[ex.muscle].push(ex.name);
  }
  const poolText = Object.entries(byMuscle)
    .map(([m, names]) => `${m}：${names.join('、')}`)
    .join('\n');

  const constraints = isHome
    ? '居家训练，只能用自重和哑铃/弹力带类动作。'
    : '健身房训练，可用杠铃/哑铃/绳索/器械。';

  const prompt = `你是专业健身教练。根据用户数据严格生成7天训练计划（从任何一天开始均可）。

用户：${profile.gender === 'male' ? '男' : '女'}，${profile.age}岁，身高${profile.height_cm}cm，体重${profile.weight_kg}kg，体能${level}，目标${profile.fitness_goal === 'fat_loss' ? '减脂' : profile.fitness_goal === 'muscle_gain' ? '增肌' : '维持'}。
${constraints}${fb}

【候选动作库】只能从以下动作名中选，不要编造：
${poolText}

铁律：
1. 必须输出7天，label必须是"Day1""Day2""Day3""Day4""Day5""Day6""Day7"
2. Day3/Day6/Day7为休息日，focus写"休息"，exercises为空数组[]
3. Day1/2/4/5为训练日：Day1胸+三头、Day2背+二头、Day4腿+肩、Day5核心+有氧
4. 训练日exercises给3-5个动作，每个动作name必须从【候选动作库】精确复制
5. 每个动作：name/sets/reps/weight/notes，居家weight=0
6. 纯JSON，不要markdown

JSON结构：
{"days":[
{"label":"Day1","focus":"胸+三头","exercises":[{"name":"标准俯卧撑","sets":3,"reps":12,"weight":0,"notes":"身体成直线"}]},
{"label":"Day2","focus":"背+二头","exercises":[...]},
{"label":"Day3","focus":"休息","exercises":[]},
{"label":"Day4","focus":"腿+肩","exercises":[...]},
{"label":"Day5","focus":"核心+有氧","exercises":[...]},
{"label":"Day6","focus":"休息","exercises":[]},
{"label":"Day7","focus":"休息","exercises":[]}
]}`;

  const resp = await callAI([
    { role: 'system', content: '你是健身教练。只输出JSON，不解释。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.6, maxTokens: 3000, jsonMode: false });

  let json = resp.trim();
  const m = json.match(/\{[\s\S]*\}/);
  if (m) json = m[0];
  const plan = JSON.parse(json);

  // 确保7天
  const labels = ['Day1','Day2','Day3','Day4','Day5','Day6','Day7'];
  const days = labels.map((label, i) => {
    const found = (plan.days || []).find(d => d.label === label);
    if (found) {
      return {
        label, day: i + 1,
        focus: found.focus || (found.exercises && found.exercises.length > 0 ? '训练' : '休息'),
        rest: !found.exercises || found.exercises.length === 0 || found.focus === '休息',
        exercises: (found.exercises || []).map(ex => ({
          name: ex.name, sets: ex.sets || 3, reps: ex.reps || 10,
          weight: ex.weight || 0, notes: ex.notes || '保持标准动作',
        })),
      };
    }
    return { label, day: i + 1, focus: i < 5 && i !== 2 ? '训练' : '休息', rest: i >= 5 || i === 2, exercises: [] };
  });

  const startDate = new Date().toISOString().slice(0, 10);
  return { days, startDate };
}

function fallbackWeeklyPlan(profile) {
  const isHome = profile.place !== 'gym';
  const level = profile.fitness_level || 'beginner';
  // 从动作库筛选
  const pool = exercises.filterForPrompt(isHome ? 'home' : 'gym', level);

  function pick(muscles, count) {
    const candidates = pool.filter(e => muscles.some(m => e.muscle === m));
    const picked = [];
    const used = new Set();
    for (const e of candidates) {
      if (picked.length >= count) break;
      if (used.has(e.name)) continue;
      used.add(e.name);
      picked.push({ name: e.name, sets: 3, reps: isHome ? 12 : 10, weight: isHome ? 0 : 15, notes: '保持标准动作' });
    }
    // 保底
    if (picked.length === 0) {
      picked.push({ name: isHome ? '标准俯卧撑' : '杠铃平板卧推', sets: 3, reps: 10, weight: isHome ? 0 : 20, notes: '保持标准动作' });
    }
    return picked;
  }

  return { days: [
    { label:'Day1',day:1,focus:'胸+三头',rest:false,exercises:pick(['胸','臂'], 3)},
    { label:'Day2',day:2,focus:'背+二头',rest:false,exercises:pick(['背','臂'], 3)},
    { label:'Day3',day:3,focus:'休息',rest:true,exercises:[]},
    { label:'Day4',day:4,focus:'腿+肩',rest:false,exercises:pick(['腿','肩'], 3)},
    { label:'Day5',day:5,focus:'核心+有氧',rest:false,exercises:pick(['腹','核心','有氧','功能性'], 3)},
    { label:'Day6',day:6,focus:'休息',rest:true,exercises:[]},
    { label:'Day7',day:7,focus:'休息',rest:true,exercises:[]},
  ], startDate: new Date().toISOString().slice(0, 10) };
}

/**
 * 三餐转盘：AI 智能生成三餐，三顿不重复
 */
async function handleMealWheel(openid, isRetry = false) {
  let profile = {};
  let allergies = [];
  let targetKcal = 2000;
  let credits = 200;
  try {
    const res = await db.collection('user_states').doc(openid).get();
    profile = res.data.profile || {};
    allergies = profile.allergies || [];
    credits = res.data.credits || 200;
    if (profile.height_cm) {
      userMetrics = bodyMetrics.calculateMetrics(
        profile.height_cm, profile.weight_kg, profile.age,
        profile.gender, profile.fitness_goal, 'moderate',
      );
    }
  } catch (e) {}

  // 未录入数据，强制要求先录入
  if (!profile.height_cm) {
    return { needProfile: true, message: '请先在「AI教练」页面录入你的身体数据（身高、体重、性别、年龄），我才能为你个性化推荐三餐。' };
  }

  const today = new Date().toISOString().slice(0, 10);

  // 重转消耗10积分
  if (isRetry) {
    if (credits < 10) {
      return { error: `积分不足！（当前 ${credits} 分，需要 10 分）`, credits };
    }
    const newCredits = credits - 10;
    try { await db.collection('user_states').doc(openid).update({ data: { credits: newCredits } }); } catch (e) {}
    credits = newCredits;
  }

  try {
    const meals = await generateMealsWithAI(userMetrics, profile, allergies);
    try {
      await db.collection('user_states').doc(openid).update({ data: { lastWheelDate: today } });
    } catch (e) {}
    return { meals: meals.names, details: meals.details, date: today, credits };
  } catch (aiErr) {
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
      date: today, credits,
    };
  }
}

/**
 * 调用 AI 生成三餐
 */
async function generateMealsWithAI(userMetrics, profile, allergies) {
  const bmi = userMetrics.bmi;
  const bmiLabel = bmi < 18.5 ? '偏瘦' : bmi < 24 ? '标准' : bmi < 28 ? '偏胖' : '超重';
  const tdee = userMetrics.tdee;
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

  const aiResponse = await callAI([
    { role: 'system', content: '你是专业营养师，只输出JSON，不输出任何解释。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.8, jsonMode: false });

  // 解析 AI 输出
  let jsonStr = aiResponse.trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];

  const data = JSON.parse(jsonStr);

  // 构建返回数据
  const names = ['早餐', '午餐', '晚餐'];
  const keys = ['breakfast', 'lunch', 'dinner'];
  const details = {};
  const mealNames = [];

  for (const key of keys) {
    if (data[key]) {
      mealNames.push(data[key].staple || key);
      details[key] = data[key];
    }
  }

  return { names: mealNames, details };
}

// ================================================================
// 积分辅助
// ================================================================
function ensureCredits(userState) {
  // 配置：默认积分常量
  const DEFAULT_CREDITS = 200;
  if (!userState.credits && userState.credits !== 0) {
    userState.credits = DEFAULT_CREDITS;
  }
  return userState.credits;
}

// ================================================================
// 意图识别
// ================================================================
function detectIntent(message, userState) {
  const msg = message.toLowerCase().trim();

  // 如果用户尚未完成初始化
  if (userState.convState === STATE.GREETING || userState.convState === STATE.ONBOARDING) {
    // 尝试从输入中提取身体数据
    return 'onboarding';
  }

  // 明确的功能意图（精确匹配，不会误判）
  if (/^换一换$|^换个$|^换餐$|^再来/.test(msg)) return 'regenerate_meal';
  if (/^今天吃什么$|^今日饮食$|^餐单$/.test(msg)) return 'meal';
  if (/^训练计划$|^健身方案$/.test(msg)) return 'workout';
  if (/^更新体重/.test(msg)) return 'checkin';

  // 身体数据
  if (/身高|体重|年龄|公斤|kg|cm|减脂|增肌|塑形/.test(message) && /\d/.test(message)) return 'onboarding';

  // 其他所有对话交给 AI 判断处理
  return 'general';
}

// ================================================================
// 流程处理函数
// ================================================================

/**
 * 新用户引导录入 → 测算 → 生成方案
 */
async function handleOnboarding(openid, message, userState) {
  const old = userState.profile || {};
  const hasBody = !!(old.height_cm);      // 是否已录身体数据
  const hasPlace = !!(old.place);          // 是否已选场所

  // ===== Phase 1: 没有身体数据 → 无论如何先引导录入 =====
  if (!hasBody) {
    // 先尝试简单正则解析（表单提交格式："170 70 男 25 减脂"）
    let extracted = quickParse(message);
    // 正则失败再用 AI
    if (!extracted || !extracted.height_cm) {
      try {
        extracted = await extractBodyDataWithAI(message, userState.profile);
      } catch (e) {
        extracted = null;
      }
    }

    // 如果提取到身体数据，保存
    if (extracted && extracted.height_cm) {
      const profile = {
        height_cm: extracted.height_cm,
        weight_kg: extracted.weight_kg || 60,
        age: extracted.age || 25,
        gender: extracted.gender || 'male',
        fitness_goal: extracted.fitness_goal || 'maintain',
        fitness_level: 'beginner',
        activity_level: 'moderate',
        place: extracted.place || null,
        allergies: [],
        likedFoods: [],
      };

      // 如果用户同时选了场所，直接完成
      if (profile.place) {
        await saveUserProfile(openid, profile);
        userState.profile = profile;
        return completeOnboarding(openid, profile, userState);
      }

      // 否则追问场所
      await saveUserProfile(openid, profile);
      userState.profile = profile;
      return {
        type: 'text',
        content: `已记录你的身体数据 ✨\n身高${profile.height_cm}cm，体重${profile.weight_kg}kg\n\n接下来请选择健身场景：`,
        messages: [buildPlaceChoice()],
      };
    }

    // 用户可能说了场所但没身体数据 → 先存场所再引导
    if (extracted && extracted.place && !extracted.height_cm) {
      await savePlaceOnly(openid, extracted.place);
      return {
        type: 'text',
        content: `好的，${extracted.place === 'gym' ? '健身房' : '居家'}模式已记录。\n\n现在请告诉我你的身体数据~\n比如："我28岁，170cm，75kg，想减脂"`,
      };
    }

    // 什么都没提取到
    return {
      type: 'text',
      content: '请先告诉我你的身体数据~\n比如："我28岁，170cm，75kg，男生，想减脂"',
    };
  }

  // ===== Phase 2: 有身体数据但没选场所 → 强制选场所 =====
  if (!hasPlace) {
    // 检查用户是否在选场所
    let extracted;
    try {
      extracted = await extractBodyDataWithAI(message, userState.profile);
    } catch (e) {
      extracted = null;
    }

    if (extracted && extracted.place) {
      // 用户选了场所 → 保存 → 完成流程
      const profile = { ...old, place: extracted.place };
      await db.collection('user_states').doc(openid).update({ data: { profile } });
      return completeOnboarding(openid, profile, userState);
    }

    // 用户可能更新了身体数据但没选场所
    if (extracted && (extracted.height_cm || extracted.weight_kg)) {
      const profile = {
        ...old,
        height_cm: extracted.height_cm || old.height_cm,
        weight_kg: extracted.weight_kg || old.weight_kg,
        age: extracted.age || old.age,
        gender: extracted.gender || old.gender,
        fitness_goal: extracted.fitness_goal || old.fitness_goal,
        place: null,
      };
      await db.collection('user_states').doc(openid).update({ data: { profile } });
      return { type: 'text', content: '数据已更新~ 请选择健身场景：', messages: [buildPlaceChoice()] };
    }

    // 还在等用户选场所
    return { type: 'text', content: '请选择你的健身场景：', messages: [buildPlaceChoice()] };
  }

  // ===== Phase 3: 两者都有 → 更新数据 + 重新生成计划 =====
  let extracted;
  try {
    extracted = await extractBodyDataWithAI(message, userState.profile);
  } catch (e) {
    extracted = null;
  }

  if (extracted && (extracted.height_cm || extracted.weight_kg || extracted.fitness_goal || extracted.place)) {
    const profile = {
      ...old,
      height_cm: extracted.height_cm || old.height_cm,
      weight_kg: extracted.weight_kg || old.weight_kg,
      age: extracted.age || old.age,
      gender: extracted.gender || old.gender,
      fitness_goal: extracted.fitness_goal || old.fitness_goal,
      place: extracted.place || old.place,
    };
    await db.collection('user_states').doc(openid).update({ data: { profile } });
    return completeOnboarding(openid, profile, userState);
  }

  // 用户说了无关的话 → 通用回复
  return {
    type: 'text',
    content: '你可以更新身体数据（比如"体重72kg"），或告诉我你想调整训练计划~',
  };
}

/**
 * Place 选择卡片（复用聊天框按钮）
 */
function buildPlaceChoice() {
  return { type: 'place_choice', content: '🏠 居家健身 还是 🏋️ 健身房？' };
}

// 快速解析表单格式："170 70 男 25 减脂"
function quickParse(text) {
  const nums = text.match(/\d{2,3}/g);
  if (!nums || nums.length < 2) return null;
  const h = parseInt(nums[0]), w = parseInt(nums[1]), a = nums[2] ? parseInt(nums[2]) : 25;
  if (h < 100 || w < 20) return null;
  return {
    height_cm: h,
    weight_kg: w,
    age: a,
    gender: /女/.test(text) ? 'female' : 'male',
    fitness_goal: /减脂|减肥/.test(text) ? 'fat_loss' : /增肌/.test(text) ? 'muscle_gain' : /塑形/.test(text) ? 'shape' : 'maintain',
    place: /健身房/.test(text) ? 'gym' : /居家|家里|在家/.test(text) ? 'home' : null,
  };
}

/**
 * 完成引导：计算指标 + 生成计划
 */
async function completeOnboarding(openid, profile, userState) {

  const metrics = bodyMetrics.calculateMetrics(
    profile.height_cm, profile.weight_kg, profile.age,
    profile.gender, profile.fitness_goal, profile.activity_level || 'moderate',
  );
  await db.collection('user_states').doc(openid).update({ data: { metrics, updatedAt: new Date() } }).catch(() => {});

  // 生成周计划
  let plan = null;
  try { plan = await generateWeeklyPlanWithAI(profile); }
  catch (e) { plan = fallbackWeeklyPlan(profile); }
  await db.collection('user_states').doc(openid).update({ data: { weeklyPlan: plan } }).catch(() => {});

  userState.profile = profile;
  userState.metrics = metrics;
  userState.convState = STATE.READY;

  const planText = plan.days.map(d =>
    d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
  ).join('\n');

  return {
    type: 'text',
    content: `已更新！✨\nBMI ${metrics.bmi}，每日消耗 ${metrics.tdee} kcal\n\n📋 本周计划（${profile.place === 'gym' ? '健身房' : '居家'}）：\n\n${planText}\n\n去「我的 → 本周训练计划」查看详情~`,
    planUpdated: true,
  };
}

/**
 * AI 从自然语言中提取身体数据
 */
async function extractBodyDataWithAI(message, existingProfile) {
  const old = existingProfile || {};
  const prompt = `从用户输入中提取身体数据，返回JSON。如果某项没提到就不填。
已知数据：${old.height_cm ? `身高${old.height_cm}cm ` : ''}${old.weight_kg ? `体重${old.weight_kg}kg ` : ''}${old.age ? `年龄${old.age}岁 ` : ''}${old.gender ? `性别${old.gender}` : ''}

用户说："${message}"

纯JSON：{"height_cm":数字或null,"weight_kg":数字或null,"age":数字或null,"gender":"male"或"female"或null,"fitness_goal":"fat_loss"或"muscle_gain"或"shape"或"maintain"或null,"place":"home"或"gym"或null}`;

  const resp = await callAI([
    { role: 'system', content: '只输出JSON，不解释。' },
    { role: 'user', content: prompt },
  ], { temperature: 0, maxTokens: 200, jsonMode: false });

  let json = resp.trim();
  const m = json.match(/\{[\s\S]*\}/);
  if (m) json = m[0];
  return JSON.parse(json);
}

/**
 * 每日饮食 — AI 智能生成
 */
async function handleMeal(openid, userState) {
  if (!userState.profile) {
    return { type: 'text', content: '请先录入身体数据~' };
  }

  const metrics = userState.metrics || bodyMetrics.calculateMetrics(
    userState.profile.height_cm, userState.profile.weight_kg,
    userState.profile.age, userState.profile.gender,
    userState.profile.fitness_goal, 'moderate',
  );

  try {
    const meal = await generateSingleMealWithAI(metrics.recommended_intake, userState.profile.allergies || [], userState.profile.likedFoods || [], userState.lastStaple);
    await saveMealLog(openid, meal);
    await db.collection('user_states').doc(openid).update({ data: { lastStaple: meal.main_staple.split(' ')[0] } });
    return buildMealCard(meal);
  } catch (e) {
    // 回退规则引擎
    const staple = staplePicker.generateDailyStaple(userState.lastStaple);
    const meal = mealPlanner.generateMeal(metrics.recommended_intake, userState.profile.allergies || [], staple);
    if (!meal.error) {
      await saveMealLog(openid, meal);
      await db.collection('user_states').doc(openid).update({ data: { lastStaple: staple.name } });
    }
    return buildMealCard(meal);
  }
}

async function handleRegenerateMeal(openid, userState) {
  if (!userState.profile) {
    return { type: 'text', content: '请先录入身体数据~' };
  }

  const metrics = userState.metrics || bodyMetrics.calculateMetrics(
    userState.profile.height_cm, userState.profile.weight_kg,
    userState.profile.age, userState.profile.gender,
    userState.profile.fitness_goal, 'moderate',
  );

  try {
    const meal = await generateSingleMealWithAI(metrics.recommended_intake, userState.profile.allergies || [], userState.profile.likedFoods || [], userState.lastStaple);
    await saveMealLog(openid, meal);
    await db.collection('user_states').doc(openid).update({ data: { lastStaple: meal.main_staple.split(' ')[0] } });
    return buildMealCard(meal);
  } catch (e) {
    const staple = staplePicker.regenerateStaple(userState.lastStaple, userState.lastStaple);
    const meal = mealPlanner.generateMeal(metrics.recommended_intake, userState.profile.allergies || [], staple);
    if (!meal.error) {
      await saveMealLog(openid, meal);
      await db.collection('user_states').doc(openid).update({ data: { lastStaple: staple.name } });
    }
    return buildMealCard(meal);
  }
}

/**
 * AI 生成单餐
 */
async function generateSingleMealWithAI(targetKcal, allergies, likedFoods, excludeStaple) {
  const allergyStr = allergies.length > 0 ? `\n忌口：${allergies.join('、')}，绝对不能出现。` : '';
  // 随机选一种喜欢食材作为今日主题
  const picked = likedFoods && likedFoods.length > 0
    ? likedFoods[Math.floor(Math.random() * likedFoods.length)]
    : null;
  const likeStr = picked
    ? `\n用户喜欢"${picked}"，请围绕它作为今日饮食主题，主菜优先基于它搭配。`
    : '';
  const excludeStr = excludeStaple ? `\n不要选择"${excludeStaple}"作为主食。` : '';
  const min = Math.round(targetKcal * 0.33);
  const max = Math.round(targetKcal * 0.50);

  const prompt = `生成一餐中式家常饮食。

规则：
1. 1种主食 + 2-3道配菜（至少1蔬菜、1蛋白质）
2. 总热量 ${min}-${max} kcal
3. 生活化家常菜，不要专业健身餐${allergyStr}${likeStr}${excludeStr}

纯JSON：
{ "main_staple":"主食名 克数g", "dishes":[{"name":"菜名","grams":克,"kcal":热,"protein_g":蛋,"fat_g":脂,"carb_g":碳}], "total_kcal":数字, "protein_g":数字, "fat_g":数字, "carb_g":数字 }`;

  const aiResponse = await callAI([
    { role: 'system', content: '你是营养师。只输出JSON，不要解释。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.9, jsonMode: false });

  let jsonStr = aiResponse.trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];

  const meal = JSON.parse(jsonStr);
  return {
    main_staple: meal.main_staple,
    dishes: meal.dishes,
    total_kcal: meal.total_kcal,
    protein_g: meal.protein_g,
    fat_g: meal.fat_g,
    carb_g: meal.carb_g,
  };
}

/**
 * 训练计划
 */
async function handleWorkout(openid, userState) {
  if (!userState.profile) {
    return { type: 'text', content: '请先录入身体数据~' };
  }

  // 尝试获取已有方案
  const existing = await db.collection('workout_plans')
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  let workout;
  if (existing.data.length > 0) {
    workout = existing.data[0].planData;
  } else {
    workout = workoutPlanner.generateWorkoutPlan(
      userState.profile.place || 'home',
      userState.profile.fitness_level || 'beginner',
      7,
    );
    await saveWorkoutPlan(openid, workout);
  }

  const planText = workout.days.map(d =>
    d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
  ).join('\n');
  return {
    type: 'text',
    content: `📋 本周计划：\n\n${planText}\n\n去「我的 → 本周训练计划」查看详情~`,
  };
}

/**
 * 调整计划——AI重生成 + 同步存储
 */
async function handleModifyPlan(openid, message, userState) {
  if (!userState.profile) {
    return { type: 'text', content: '请先录入身体数据~' };
  }

  let plan;
  try {
    plan = await generateWeeklyPlanWithAI(userState.profile, message);
  } catch (e) {
    plan = fallbackWeeklyPlan(userState.profile);
  }

  // 同步存储
  await db.collection('user_states').doc(openid).update({ data: { weeklyPlan: plan } }).catch(() => {});

  const planText = plan.days.map(d =>
    d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
  ).join('\n');

  return {
    type: 'text',
    content: `已根据你的反馈调整计划 ✨\n\n📋 本周计划（${userState.profile.place === 'gym' ? '健身房' : '居家'}）：\n\n${planText}\n\n去「我的 → 本周训练计划」查看详情~`,
    planUpdated: true,
  };
}

/**
 * 体重更新
 */
async function handleCheckin(openid, message, userState) {
  // 尝试从消息中提取体重
  const weightMatch = message.match(/(\d{2,3}(?:\.\d)?)\s*(?:kg|公斤|斤)?/);
  if (!weightMatch) {
    return { type: 'text', content: '请输入你的最新体重，例如：72 或 72kg' };
  }

  let newWeight = parseFloat(weightMatch[1]);
  // 如果是"斤"，转换为kg
  if (message.includes('斤')) newWeight = newWeight / 2;

  const oldWeight = userState.profile ? userState.profile.weight_kg : newWeight;
  const changePercent = oldWeight > 0 ? ((newWeight - oldWeight) / oldWeight * 100) : 0;
  const needUpdate = Math.abs(changePercent) > 2;

  // 保存体重记录
  await db.collection('weight_logs').add({
    data: { openid, weight: newWeight, date: new Date().toISOString().slice(0, 10), createdAt: new Date() },
  });

  // 更新用户体重
  await db.collection('user_states').doc(openid).update({
    data: { 'profile.weight_kg': newWeight },
  });

  let response = {
    type: 'text',
    content: needUpdate
      ? `体重变化 ${Math.abs(changePercent).toFixed(1)}%，超过2%，已为你更新训练方案！`
      : '体重变化平稳，继续执行原计划~',
    planUpdated: false,
  };

  // 如果需要更新方案
  if (needUpdate && userState.profile) {
    const updatedProfile = { ...userState.profile, weight_kg: newWeight };
    const workout = workoutPlanner.generateWorkoutPlan(
      updatedProfile.place || 'home',
      updatedProfile.fitness_level || 'beginner',
      7,
    );
    await saveWorkoutPlan(openid, workout);
    // 同步更新 weeklyPlan 字段，本周计划页面才能读到
    await db.collection('user_states').doc(openid).update({ data: { weeklyPlan: workout } }).catch(() => {});
    response.content += '\n\n📋 本周计划已同步更新，去「我的 → 本周训练计划」查看~';
    response.planUpdated = true;
  }

  return response;
}

/**
 * 通用对话 — AI 全权判断：聊天 / 改计划 / 提建议
 */
async function handleGeneralChat(openid, message, userState) {
  if (!userState.profile) {
    return { type: 'text', content: '请先告诉我你的身体数据~\n例如：170 75 男 28 减脂' };
  }

  const profile = userState.profile;
  const metrics = userState.metrics || bodyMetrics.calculateMetrics(
    profile.height_cm, profile.weight_kg, profile.age,
    profile.gender, profile.fitness_goal, 'moderate',
  );

  // 获取当前计划摘要
  let currentPlanText = '暂无';
  try {
    const planRes = await db.collection('user_states').doc(openid).get();
    if (planRes.data && planRes.data.weeklyPlan && planRes.data.weeklyPlan.days) {
      currentPlanText = planRes.data.weeklyPlan.days.map(d =>
        d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${(d.exercises||[]).map(e => e.name).join('、')}`
      ).join(' | ');
    }
  } catch (e) {}

  // 加载对话记忆
  const history = await getConversationHistory(openid);
  const historyText = formatHistoryForPrompt(history);

  // 从动作库筛选候选动作
  const candidatePool = exercises.filterForPrompt(profile.place || 'home', profile.fitness_level || 'beginner');
  const byMuscle = {};
  for (const ex of candidatePool) {
    if (!byMuscle[ex.muscle]) byMuscle[ex.muscle] = [];
    byMuscle[ex.muscle].push(ex.name);
  }
  const poolText = Object.entries(byMuscle)
    .map(([m, names]) => `${m}：${names.join('、')}`)
    .join('\n');

  try {
    const aiResponse = await callAI([
      {
        role: 'system',
        content: `你是智能健身管家"小养"。你有长期记忆，能结合用户之前说过的话做连续判断。输出纯JSON，不要markdown。

用户档案：${profile.gender === 'male' ? '男' : '女'} ${profile.age}岁 ${profile.height_cm}cm ${profile.weight_kg}kg 目标${profile.fitness_goal === 'fat_loss' ? '减脂' : profile.fitness_goal === 'muscle_gain' ? '增肌' : '保持'} ${profile.place === 'gym' ? '健身房' : '居家'} 日需${metrics.recommended_intake}kcal

当前训练计划：${currentPlanText}${historyText}

【候选动作库】只能从以下动作中选择name，不要编造：
${poolText}

你的核心职责：自主判断用户意图。
- 如果用户只是闲聊/咨询/问建议 → 只回复，plan 填 null
- 如果用户想换动作/改难度/调整计划/体重变了/目标变了/训练场所变了/觉得太简单或太难 → 生成新的完整7天计划，plan 填计划对象

输出JSON格式：
{"reply":"你的回复（亲切带emoji，150字内）","plan":null}

当需要更新计划时：
{"reply":"已根据你的需求调整~","plan":{"days":[
  {"label":"Day1","focus":"胸+三头","exercises":[{"name":"标准俯卧撑","sets":3,"reps":12,"weight":0,"notes":"身体成直线"}]},
  {"label":"Day2","focus":"背+二头","exercises":[...]},
  {"label":"Day3","focus":"休息","exercises":[]},
  {"label":"Day4","focus":"腿+肩","exercises":[...]},
  {"label":"Day5","focus":"核心+有氧","exercises":[...]},
  {"label":"Day6","focus":"休息","exercises":[]},
  {"label":"Day7","focus":"休息","exercises":[]}
]}}

铁律：
- 每个动作的name必须从【候选动作库】中精确复制，一个字不能改
- 训练日exercises必须有3-5个动作（name/sets/reps/weight/notes）
- 休息日focus写"休息"，exercises为[]
- 结合对话记忆理解用户连续意图`,
      },
      { role: 'user', content: message },
    ], { temperature: 0.7, maxTokens: 2000 });

    // 解析JSON响应
    let jsonStr = aiResponse.trim();
    const m = jsonStr.match(/\{[\s\S]*\}/);
    if (m) jsonStr = m[0];
    const data = JSON.parse(jsonStr);

    // AI 自主决定更新计划
    if (data.plan && data.plan.days && data.plan.days.length > 0) {
      const labels = ['Day1','Day2','Day3','Day4','Day5','Day6','Day7'];
      const days = labels.map((label, i) => {
        const found = data.plan.days.find(d => d.label === label);
        if (found) {
          return {
            label, day: i + 1,
            focus: found.focus || (found.exercises && found.exercises.length ? '训练' : '休息'),
            rest: !found.exercises || !found.exercises.length || found.focus === '休息',
            exercises: (found.exercises || []).map(e => ({
              name: e.name, sets: e.sets || 3, reps: e.reps || 10,
              weight: e.weight || 0, notes: e.notes || '',
            })),
          };
        }
        return { label, day: i + 1, focus: i < 5 && i !== 2 ? '训练' : '休息', rest: i >= 5 || i === 2, exercises: [] };
      });

      const startDate = new Date().toISOString().slice(0, 10);
      await db.collection('user_states').doc(openid).update({ data: { weeklyPlan: { days, startDate } } });

      const planText = days.map(d => d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`).join('\n');
      return {
        type: 'text',
        content: (data.reply || '已更新') + '\n\n📋 计划已同步：\n' + planText,
        planUpdated: true,
      };
    }

    return { type: 'text', content: data.reply || aiResponse, planUpdated: false };
  } catch (e) {
    return { type: 'text', content: '我暂时无法回复，请稍后再试~', planUpdated: false };
  }
}

// ================================================================
// 数据解析与存储
// ================================================================


async function savePlaceOnly(openid, place) {
  try {
    await db.collection('user_states').doc(openid).get().then(async (res) => {
      await db.collection('user_states').doc(openid).update({
        data: { 'profile.place': place, updatedAt: new Date() },
      });
    }).catch(async () => {
      await db.collection('user_states').doc(openid).set({
        data: { openid, profile: { place }, convState: 'onboarding', createdAt: new Date() },
      });
    });
  } catch (e) {}
}

async function loadUserState(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    return res.data;
  } catch (e) {
    return {
      convState: STATE.GREETING,
      profile: null,
      metrics: null,
      lastStaple: null,
    };
  }
}

async function saveUserProfile(openid, profile) {
  await db.collection('user_states').doc(openid).set({
    data: {
      openid,
      profile,
      credits: 200,  // 新人免费额度
      convState: STATE.READY,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function updateUserState(openid, convState, profile, metrics) {
  // 仅更新，保留已有credits
  const existing = await db.collection('user_states').doc(openid).get().catch(() => null);
  const credits = (existing && existing.data && existing.data.credits) ? existing.data.credits : 200;
  await db.collection('user_states').doc(openid).set({
    data: {
      openid,
      profile,
      metrics,
      credits,
      convState,
      updatedAt: new Date(),
    },
  });
}

async function saveWorkoutPlan(openid, planData) {
  await db.collection('workout_plans').add({
    data: { openid, planData, version: 1, createdAt: new Date() },
  });
}

async function saveMealLog(openid, mealData) {
  await db.collection('meal_logs').add({
    data: {
      openid,
      date: new Date().toISOString().slice(0, 10),
      mealData,
      createdAt: new Date(),
    },
  });
}

// ================================================================
// 构建前端卡片响应
// ================================================================

function buildMetricsCard(metrics) {
  return {
    type: 'metrics-card',
    content: `BMI: ${metrics.bmi}，推荐每日摄入 ${metrics.recommended_intake} kcal`,
    cardData: metrics,
  };
}

function buildWorkoutCard(workout) {
  return {
    type: 'workout-card',
    content: `为你生成了${workout.days}天${workout.place === 'home' ? '居家' : '健身房'}训练计划`,
    cardData: workout,
  };
}

function buildMealCard(meal) {
  return {
    type: 'meal-card',
    content: `今日主食：${meal.main_staple}，总热量 ${meal.total_kcal} kcal`,
    cardData: meal,
  };
}

function buildMetricsResponse(userState) {
  const metrics = userState.metrics || bodyMetrics.calculateMetrics(
    userState.profile.height_cm, userState.profile.weight_kg,
    userState.profile.age, userState.profile.gender,
    userState.profile.fitness_goal, 'moderate',
  );
  return {
    type: 'metrics-card',
    content: `当前指标：BMI ${metrics.bmi}，推荐每日 ${metrics.recommended_intake} kcal`,
    cardData: metrics,
  };
}
