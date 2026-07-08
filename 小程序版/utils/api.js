/**
 * 云函数调用封装 + 本地离线兜底
 */
const auth = require('./auth.js');

// ================================================================
// 深夜休息时段风控
// ================================================================
const QUIET_START = 23;
const QUIET_END = 7;
const QUIET_MSG = '🌙 夜色已深，该休息啦～\n\n充足的睡眠是肌肉恢复和脂肪代谢的黄金时间，比多练一小时更重要。\n\n先好好睡觉吧，天亮后我随时为你服务 💤';

function isQuietHours() {
  const hour = new Date().getHours();
  return hour >= QUIET_START || hour < QUIET_END;
}

// 本地模拟数据
const LOCAL_METRICS = {
  bmi: 26.0, bmr: 1678, tdee: 2600, recommended_intake: 2200,
  protein_g: 120, fat_g: 61, carb_g: 293,
};

const LOCAL_WORKOUT = {
  place: 'home', days: 7, fitness_level: 'beginner',
  schedule: [
    { day: 1, focus: '胸+三头', exercises: [
      { name: '靠墙俯卧撑', sets: 3, reps: 10, rest_seconds: 60, notes: '身体成直线' },
      { name: '跪姿俯卧撑', sets: 3, reps: 10, rest_seconds: 60, notes: '膝盖着地' },
      { name: '平板支撑', sets: 2, reps: 1, rest_seconds: 45, notes: '收紧腹部' },
    ]},
    { day: 2, focus: '背+二头', exercises: [
      { name: '臀桥', sets: 3, reps: 12, rest_seconds: 45, notes: '臀部发力上抬' },
      { name: '原地踏步', sets: 1, reps: 1, rest_seconds: 0, notes: '保持节奏5分钟' },
    ]},
    { day: 3, focus: '休息', exercises: [] },
    { day: 4, focus: '腿+肩', exercises: [
      { name: '深蹲', sets: 3, reps: 12, rest_seconds: 60, notes: '膝盖不过脚尖' },
      { name: '臀桥', sets: 3, reps: 12, rest_seconds: 45, notes: '顶峰收缩' },
    ]},
    { day: 5, focus: '核心+有氧', exercises: [
      { name: '平板支撑', sets: 3, reps: 1, rest_seconds: 45, notes: '身体成一直线' },
      { name: '原地踏步', sets: 1, reps: 1, rest_seconds: 0, notes: '保持节奏8分钟' },
    ]},
    { day: 6, focus: '休息', exercises: [] },
    { day: 7, focus: '休息', exercises: [] },
  ],
};

const LOCAL_MEALS = [
  {
    main_staple: '红薯 200g', dishes: [
      { name: '鸡胸肉', grams: 150, kcal: 177 },
      { name: '蒜蓉西兰花', grams: 120, kcal: 41 },
      { name: '凉拌黄瓜', grams: 100, kcal: 16 },
    ],
    total_kcal: 800, protein_g: 42, fat_g: 12, carb_g: 98,
  },
  {
    main_staple: '意面 180g', dishes: [
      { name: '卤牛肉', grams: 100, kcal: 115 },
      { name: '清炒菠菜', grams: 120, kcal: 28 },
    ],
    total_kcal: 750, protein_g: 38, fat_g: 15, carb_g: 105,
  },
  {
    main_staple: '杂粮饭 180g', dishes: [
      { name: '小炒黄牛肉', grams: 120, kcal: 192 },
      { name: '炒豆芽', grams: 100, kcal: 30 },
    ],
    total_kcal: 780, protein_g: 40, fat_g: 18, carb_g: 95,
  },
];

const DEFAULT_CREDITS = 200;
let mealIndex = 0;
let localCredits = DEFAULT_CREDITS;

// ================================================================
// 本地对话记忆（与云函数逻辑一致）
// ================================================================
const MAX_LOCAL_HISTORY = 20;

function getLocalHistory() {
  try {
    return wx.getStorageSync('conversationHistory') || [];
  } catch (e) {
    return [];
  }
}

function saveLocalTurn(userMsg, aiContent) {
  const history = getLocalHistory();
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: aiContent });
  const trimmed = history.slice(-MAX_LOCAL_HISTORY);
  wx.setStorageSync('conversationHistory', trimmed);
}

function getLocalWeeklyPlan() {
  try {
    const raw = wx.getStorageSync('weeklyPlan');
    return (raw && raw.days) ? raw : null;
  } catch (e) {
    return null;
  }
}

function getLocalCredits() {
  const app = getApp();
  if (app && app.globalData && app.globalData.credits !== undefined && app.globalData.credits !== null) {
    return app.globalData.credits;
  }
  return localCredits;
}

function setLocalCredits(val) {
  localCredits = val;
  updateCreditsDisplay(val);
}

function callCloudFunction(name, data = {}) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('cloud not ready'));
  }
  // 使用 Promise 链，超时 25s（AI 回复可能较慢）
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 25000)
  );
  const call = wx.cloud.callFunction({ name, data }).then(res => res.result);
  return Promise.race([call, timeout]);
}

// ======= AI对话 =======
async function aiChat(message, context = {}) {
  try {
    const result = await callCloudFunction('aiChat', { message, context });
    if (result && result.credits !== undefined) {
      updateCreditsDisplay(result.credits);
    }
    return result;
  } catch (err) {
    console.warn('云函数不可用，使用本地响应');
    return localAiResponse(message);
  }
}

// 积分变动时更新 app globalData
function updateCreditsDisplay(credits) {
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.credits = credits;
  }
}

// ======= 广告奖励 =======
async function rewardAd() {
  try {
    const result = await callCloudFunction('aiChat', { action: 'reward' });
    if (result && result.credits !== undefined) {
      updateCreditsDisplay(result.credits);
    }
    return result;
  } catch (err) {
    const c = getLocalCredits() + 10;
    setLocalCredits(c);
    return { type: 'text', content: `+10 积分！当前 ${c} 积分`, credits: c };
  }
}

function localAiResponse(message) {
  const msg = message.trim();

  // 深夜休息时段风控
  if (isQuietHours()) {
    const credits = getLocalCredits();
    return { type: 'text', content: QUIET_MSG, planUpdated: false, credits };
  }

  const history = getLocalHistory();
  const app = getApp();
  const profile = (app && app.globalData && app.globalData.userProfile) ? app.globalData.userProfile : null;
  const hasProfile = !!(profile && profile.height_cm);

  // 每次提问扣5分
  const c = Math.max(0, getLocalCredits() - 5);
  setLocalCredits(c);

  let result;

  // ---- 身体数据录入 / 更新 ----
  if (/身高|体重|年龄|公斤|kg|cm|减脂|增肌|塑形/.test(msg) && /\d/.test(msg)) {
    const parsed = parseLocalBodyData(msg);
    if (parsed) {
      const newProfile = {
        height_cm: parsed.height_cm,
        weight_kg: parsed.weight_kg,
        age: parsed.age,
        gender: parsed.gender,
        fitness_goal: parsed.fitness_goal,
        fitness_level: 'beginner',
        activity_level: 'moderate',
        place: parsed.place || (profile ? profile.place : 'home'),
        allergies: profile ? (profile.allergies || []) : [],
        likedFoods: profile ? (profile.likedFoods || []) : [],
      };
      app.globalData.userProfile = newProfile;
      app.globalData.isNewUser = false;

      const plan = generateLocalWeeklyPlan(newProfile);
      wx.setStorageSync('weeklyPlan', JSON.stringify(plan));

      const bmi = (newProfile.weight_kg / ((newProfile.height_cm / 100) ** 2)).toFixed(1);
      const planText = plan.days.map(d =>
        d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
      ).join('\n');

      result = {
        type: 'text',
        content: `已记录并生成本周计划 ✨\nBMI ${bmi}\n\n📋 本周计划（${newProfile.place === 'gym' ? '健身房' : '居家'}）：\n\n${planText}\n\n去「我的 → 本周训练计划」查看详情~`,
        planUpdated: true,
      };
      result.credits = getLocalCredits();
      saveLocalTurn(message, result.content);
      return result;
    }
    result = { type: 'text', content: '没太明白，试试：170 70 男 25 减脂 居家', planUpdated: false };
    result.credits = getLocalCredits();
    saveLocalTurn(message, result.content);
    return result;
  }

  // ---- 计划修改意图检测（AI自主判断的本地模拟） ----
  if (hasProfile && /太简单|太容易|太难|太累|加强|加重|减轻|降低|换动作|调整|改|更新计划|重新生成/.test(msg)) {
    const newPlan = generateLocalWeeklyPlan(profile);
    wx.setStorageSync('weeklyPlan', JSON.stringify(newPlan));

    const planText = newPlan.days.map(d =>
      d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
    ).join('\n');

    let reply = '已根据你的需求调整训练计划~';
    if (/太简单|太容易/.test(msg)) reply = '了解，帮你加强了训练强度~';
    if (/太难|太累/.test(msg)) reply = '好的，帮你降低了训练强度~';
    if (/换动作|调整/.test(msg)) reply = '已调整训练动作，看看新的安排~';

    result = {
      type: 'text',
      content: `${reply}\n\n📋 本周计划已更新（${profile.place === 'gym' ? '健身房' : '居家'}）：\n\n${planText}\n\n去「我的 → 本周训练计划」查看详情~`,
      planUpdated: true,
    };
    result.credits = getLocalCredits();
    saveLocalTurn(message, result.content);
    return result;
  }

  // ---- 体重更新 ----
  if (/体重.*\d|更新体重|称重/.test(msg)) {
    const weightMatch = msg.match(/(\d{2,3}(?:\.\d)?)/);
    if (weightMatch && profile) {
      const newWeight = parseFloat(weightMatch[1]);
      const oldWeight = profile.weight_kg;
      const changePercent = ((newWeight - oldWeight) / oldWeight * 100);
      const needUpdate = Math.abs(changePercent) > 2;

      profile.weight_kg = newWeight;
      app.globalData.userProfile = profile;

      if (needUpdate) {
        const newPlan = generateLocalWeeklyPlan(profile);
        wx.setStorageSync('weeklyPlan', JSON.stringify(newPlan));
        result = {
          type: 'text',
          content: `体重变化 ${Math.abs(changePercent).toFixed(1)}%，超过2%，已更新训练方案~`,
          planUpdated: true,
        };
      } else {
        result = {
          type: 'text',
          content: '体重变化平稳，继续执行原计划~',
          planUpdated: false,
        };
      }
      result.credits = getLocalCredits();
      saveLocalTurn(message, result.content);
      return result;
    }
  }

  // ---- 饮食 ----
  if (/吃|餐|食|换一换|换餐|换个/.test(msg)) {
    const allergies = profile ? (profile.allergies || []) : [];
    const likedFoods = profile ? (profile.likedFoods || []) : [];
    // 过滤忌口
    let safeMeals = LOCAL_MEALS.filter(m =>
      !m.dishes.some(d => allergies.some(a => d.name.includes(a)))
    );
    if (safeMeals.length === 0) safeMeals = LOCAL_MEALS;
    // 优先选包含喜欢食材的餐
    if (likedFoods.length > 0) {
      const matched = safeMeals.filter(m =>
        m.dishes.some(d => likedFoods.some(l => d.name.includes(l)))
      );
      if (matched.length > 0) safeMeals = matched;
    }
    const meal = safeMeals[mealIndex % safeMeals.length];
    mealIndex++;
    const pickedFood = likedFoods.length > 0
      ? likedFoods[Math.floor(Math.random() * likedFoods.length)]
      : null;
    result = {
      type: 'meal-card',
      content: pickedFood ? `今日围绕「${pickedFood}」搭配~` : '今日饮食方案',
      cardData: meal,
      planUpdated: false,
    };
    result.credits = getLocalCredits();
    saveLocalTurn(message, result.content);
    return result;
  }

  // ---- 查看计划 ----
  if (/训练|运动|练|计划/.test(msg)) {
    if (hasProfile) {
      const plan = getLocalWeeklyPlan();
      if (plan) {
        const planText = plan.days.map(d =>
          d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
        ).join('\n');
        result = { type: 'text', content: `📋 你的本周计划：\n\n${planText}\n\n去「我的 → 本周训练计划」查看详情~`, planUpdated: false };
      } else {
        result = { type: 'text', content: '还没有训练计划，先告诉我你的身体数据吧~', planUpdated: false };
      }
    } else {
      result = { type: 'text', content: '请先告诉我你的身体数据~\n例如：170 70 男 25 减脂 居家', planUpdated: false };
    }
    result.credits = getLocalCredits();
    saveLocalTurn(message, result.content);
    return result;
  }

  // ---- 通用回复 ----
  const genericReplies = [
    '云端连接后可自由对话，现在你可以：\n• 告诉我身体数据\n• "今天吃什么"\n• "训练计划"\n• "太简单了，帮我加强"',
  ];
  if (hasProfile) {
    genericReplies[0] = `收到~ 你可以：\n• 更新体重（如"体重72kg"）\n• 调整训练（如"太简单了"、"换动作"）\n• "今天吃什么"\n• "训练计划"`;
  }
  result = { type: 'text', content: genericReplies[0], planUpdated: false };
  result.credits = getLocalCredits();
  saveLocalTurn(message, result.content);
  return result;
}

// ======= 其他API =======
async function getDailyMeal() {
  try { return await callCloudFunction('dailyMeal', { action: 'get' }); }
  catch (e) { return { success: true, type: 'meal-card', cardData: LOCAL_MEALS[0] }; }
}

async function regenerateMeal() {
  try { return await callCloudFunction('dailyMeal', { action: 'regenerate' }); }
  catch (e) {
    mealIndex++;
    return { success: true, type: 'meal-card', cardData: LOCAL_MEALS[mealIndex % LOCAL_MEALS.length] };
  }
}

async function getWorkoutPlan() {
  try { return await callCloudFunction('workoutPlan', { action: 'get' }); }
  catch (e) { return { success: true, type: 'workout-card', cardData: LOCAL_WORKOUT }; }
}

async function userInit(profileData) {
  return callCloudFunction('userInit', { action: 'register', profile: profileData });
}

async function weeklyCheckin(weight) {
  return callCloudFunction('weeklyCheckin', { weight });
}

async function submitFeedback(content) {
  return callCloudFunction('userInit', { action: 'submitFeedback', content });
}

// ======= 每日三餐转盘 =======
async function getDailyMeals(isRetry = false) {
  try {
    const result = await callCloudFunction('aiChat', { action: 'meal_wheel', isRetry });
    return result;
  } catch (err) {
    // 深夜休息时段风控
    if (isQuietHours()) {
      return { error: QUIET_MSG };
    }
    // 本地兜底——检查是否有用户数据
    const app = getApp();
    const profile = (app && app.globalData && app.globalData.userProfile) ? app.globalData.userProfile : null;
    if (!profile || !profile.height_cm) {
      return { needProfile: true, message: '请先在「AI教练」页面录入你的身体数据（身高、体重、性别、年龄）。' };
    }
    // 本地兜底三餐（过滤忌口 + 优先喜欢食材）
    const allergies = profile.allergies || [];
    const likedFoods = profile.likedFoods || [];
    let dishesPool = ['番茄炒蛋','青椒肉丝','蒜蓉西兰花','清炒菠菜','卤牛肉','蒸蛋','凉拌黄瓜','小炒肉']
      .filter(d => !allergies.some(a => d.includes(a)));
    if (dishesPool.length === 0) dishesPool = ['番茄炒蛋','清炒菠菜','凉拌黄瓜'];
    // 喜欢食材优先：如果有喜欢的，优先展示含喜欢食材的菜
    if (likedFoods.length > 0) {
      const favored = dishesPool.filter(d => likedFoods.some(l => d.includes(l)));
      if (favored.length > 0) dishesPool = [...new Set([...favored, ...dishesPool])];
    }
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const makeMeal = (staple) => ({
      main_staple: staple + ' 180g',
      dishes: [
        { name: pick(dishesPool), grams: 120, kcal: 160, protein_g: 12, fat_g: 8, carb_g: 10 },
        { name: pick(dishesPool), grams: 100, kcal: 80, protein_g: 5, fat_g: 3, carb_g: 8 },
      ],
      total_kcal: 700 + Math.floor(Math.random() * 100),
      protein_g: 30 + Math.floor(Math.random() * 10),
      fat_g: 20 + Math.floor(Math.random() * 10),
      carb_g: 80 + Math.floor(Math.random() * 20),
    });
    const staples = ['红薯','意面','杂粮饭','玉米','全麦面包','饺子','燕麦','米粉'];
    const s1 = pick(staples); let s2 = pick(staples); while (s2 === s1) s2 = pick(staples);
    const s3 = pick(staples); while (s3 === s1 || s3 === s2) s3 = pick(staples);
    return {
      meals: [s1, s2, s3],
      details: {
        breakfast: makeMeal(s1),
        lunch: makeMeal(s2),
        dinner: makeMeal(s3),
      },
    };
  }
}

// 本地数据解析（云函数不可用时的兜底）
function parseLocalBodyData(text) {
  const nums = text.match(/\d{2,3}/g);
  if (!nums || nums.length < 2) return null;
  const h = parseInt(nums[0]), w = parseInt(nums[1]), a = nums[2] ? parseInt(nums[2]) : 25;
  if (h < 100 || w < 20) return null;
  return {
    height_cm: h, weight_kg: w, age: a,
    gender: /女/.test(text) ? 'female' : 'male',
    fitness_goal: /减脂|减肥/.test(text) ? 'fat_loss' : /增肌/.test(text) ? 'muscle_gain' : /塑形/.test(text) ? 'shape' : 'maintain',
    place: /健身房/.test(text) ? 'gym' : 'home',
  };
}

function generateLocalWeeklyPlan(profile) {
  const isHome = profile.place !== 'gym';
  const chest = isHome
    ? [{ name:'俯卧撑', sets:3, reps:12, weight:0, notes:'身体成直线' },{ name:'跪姿俯卧撑', sets:3, reps:10, weight:0, notes:'膝盖着地' }]
    : [{ name:'坐姿胸推', sets:3, reps:12, weight:20, notes:'肩胛收紧' },{ name:'哑铃卧推', sets:3, reps:10, weight:12, notes:'控制离心' }];
  const back = isHome
    ? [{ name:'臀桥', sets:3, reps:15, weight:0, notes:'臀部发力' },{ name:'平板支撑', sets:3, reps:1, weight:0, notes:'收紧核心' }]
    : [{ name:'高位下拉', sets:3, reps:12, weight:25, notes:'沉肩' },{ name:'坐姿划船', sets:3, reps:12, weight:20, notes:'挺胸收腹' }];
  const legs = isHome
    ? [{ name:'深蹲', sets:3, reps:15, weight:0, notes:'膝盖不过脚尖' },{ name:'弓步蹲', sets:3, reps:12, weight:0, notes:'重心稳定' }]
    : [{ name:'器械腿举', sets:3, reps:12, weight:40, notes:'膝盖不锁死' },{ name:'杠铃深蹲', sets:3, reps:10, weight:30, notes:'脊柱中立' }];
  const core = isHome
    ? [{ name:'仰卧起坐', sets:3, reps:15, weight:0, notes:'腹部发力' },{ name:'开合跳', sets:3, reps:30, weight:0, notes:'保持节奏' }]
    : [{ name:'器械卷腹', sets:3, reps:15, weight:10, notes:'腹部发力' },{ name:'椭圆机', sets:1, reps:1, weight:0, notes:'匀速20分钟' }];

  return { days: [
    { label:'Day1',day:1,focus:'胸+三头',rest:false,exercises:chest },
    { label:'Day2',day:2,focus:'背+二头',rest:false,exercises:back },
    { label:'Day3',day:3,focus:'休息',rest:true,exercises:[] },
    { label:'Day4',day:4,focus:'腿+肩',rest:false,exercises:legs },
    { label:'Day5',day:5,focus:'核心+有氧',rest:false,exercises:core },
    { label:'Day6',day:6,focus:'休息',rest:true,exercises:[] },
    { label:'Day7',day:7,focus:'休息',rest:true,exercises:[] },
  ], startDate: new Date().toISOString().slice(0, 10) };
}

module.exports = {
  callCloudFunction, aiChat, userInit, weeklyCheckin,
  getDailyMeal, regenerateMeal, getWorkoutPlan, rewardAd, getDailyMeals,
  submitFeedback,
};
