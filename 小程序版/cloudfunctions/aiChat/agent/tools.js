/**
 * Agent 工具定义 + 执行器
 * 5 个工具：update_body_data / generate_weekly_plan / generate_meal / record_weight / get_exercise_info
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const bodyMetrics = require('../skills/bodyMetrics.js');
const workoutPlanner = require('../skills/workoutPlanner.js');
const mealPlanner = require('../skills/mealPlanner.js');
const staplePicker = require('../skills/staplePicker.js');
const validator = require('../harness/validator.js');
const exercises = require('../data/exercises.js');
const { callAI } = require('./aiClient.js');

// ================================================================
// 工具定义（传给 DeepSeek API）
// ================================================================
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'update_body_data',
      description: '从用户自然语言中提取身体数据并保存。当用户提供或更新身高、体重、年龄、性别、健身目标、训练场所时调用。提取后自动计算 BMI 等指标。',
      parameters: {
        type: 'object',
        properties: {
          height_cm:  { type: 'number', description: '身高(cm)，范围50-250' },
          weight_kg:  { type: 'number', description: '体重(kg)，范围20-300' },
          age:        { type: 'integer', description: '年龄，范围10-120' },
          gender:     { type: 'string', enum: ['male', 'female'], description: '性别' },
          fitness_goal: { type: 'string', enum: ['fat_loss', 'muscle_gain', 'shape', 'maintain'], description: '健身目标：fat_loss=减脂, muscle_gain=增肌, shape=塑形, maintain=维持' },
          place:      { type: 'string', enum: ['home', 'gym'], description: '训练场所：home=居家, gym=健身房' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_weekly_plan',
      description: '生成或重新生成用户的 7 天训练计划（Day1-Day7）。当用户首次录入身体数据、要求调整强度/难度、换动作、觉得计划太简单或太难时调用。每次调用都会覆盖旧计划。',
      parameters: {
        type: 'object',
        properties: {
          feedback: {
            type: 'string',
            description: '用户的调整诉求，如"降低上肢强度""换掉俯卧撑""增加有氧""太难了需要减轻""太简单了加点难度"。无特殊要求时传空字符串或"首次生成"。',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_meal',
      description: '为用户生成一餐饮食方案。当用户问"吃什么""今日饮食""推荐一餐""换一换""换餐""餐单"时调用。自动过滤忌口，优先使用用户喜欢的食材。',
      parameters: {
        type: 'object',
        properties: {
          regenerate: {
            type: 'boolean',
            description: 'true=换一换（排除上次主食重新生成）；false或不传=正常生成今日饮食',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_weight',
      description: '记录用户最新体重。当用户报体重数字时调用，如"72kg"、"今天称了140斤"、"更新体重70"。记录后自动判断体重变化是否超过2%，超过则提醒需要更新训练计划。',
      parameters: {
        type: 'object',
        properties: {
          weight: { type: 'number', description: '体重数值' },
          unit:    { type: 'string', enum: ['kg', '斤'], description: '单位，默认 kg' },
        },
        required: ['weight'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exercise_info',
      description: '查询动作库，获取某肌群或动作的详细信息。当用户问"有哪些练胸的动作""俯卧撑怎么做""推荐几个居家练背的动作""腹肌怎么练"时调用。',
      parameters: {
        type: 'object',
        properties: {
          muscle: { type: 'string', description: '肌群名：胸/背/腿/肩/臂/腹/核心/有氧/臀/功能性/拉伸/小腿/颈/热身' },
          query:  { type: 'string', description: '动作名称关键词，如"俯卧撑""深蹲"' },
        },
      },
    },
  },
];

// ================================================================
// 工具分发器
// ================================================================
async function executeTool(name, args, ctx) {
  switch (name) {
    case 'update_body_data':      return executeUpdateBodyData(args, ctx);
    case 'generate_weekly_plan':  return executeGenerateWeeklyPlan(args, ctx);
    case 'generate_meal':         return executeGenerateMeal(args, ctx);
    case 'record_weight':         return executeRecordWeight(args, ctx);
    case 'get_exercise_info':     return executeGetExerciseInfo(args, ctx);
    default: return { error: `未知工具: ${name}` };
  }
}

// ================================================================
// 工具执行器
// ================================================================
const db = cloud.database();

/**
 * update_body_data — 提取并保存身体数据
 */
async function executeUpdateBodyData(args, ctx) {
  const db = cloud.database();
  const old = ctx.profile || {};

  // 合并新旧数据
  const profile = {
    height_cm: args.height_cm || old.height_cm || null,
    weight_kg: args.weight_kg || old.weight_kg || null,
    age: args.age || old.age || null,
    gender: args.gender || old.gender || 'male',
    fitness_goal: args.fitness_goal || old.fitness_goal || 'maintain',
    fitness_level: old.fitness_level || 'beginner',
    activity_level: old.activity_level || 'moderate',
    place: args.place || old.place || null,
    allergies: old.allergies || [],
    likedFoods: old.likedFoods || [],
  };

  // Harness 校验
  if (profile.height_cm && profile.weight_kg && profile.age) {
    const check = validator.validateBodyData({
      height_cm: profile.height_cm,
      weight_kg: profile.weight_kg,
      age: profile.age,
      gender: profile.gender,
    });
    if (!check.valid) {
      return { success: false, error: check.errors.join('；') };
    }
  }

  // 计算指标
  let metrics = null;
  if (profile.height_cm && profile.weight_kg && profile.age) {
    metrics = bodyMetrics.calculateMetrics(
      profile.height_cm, profile.weight_kg, profile.age,
      profile.gender, profile.fitness_goal, profile.activity_level,
    );
  }

  // 保存到云数据库
  try {
    await db.collection('user_states').doc(ctx.openid).set({
      data: {
        openid: ctx.openid,
        profile,
        metrics,
        credits: ctx.credits,
        convState: 'ready',
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    // doc.set 失败（已存在）→ update
    try {
      await db.collection('user_states').doc(ctx.openid).update({
        data: { profile, metrics, updatedAt: new Date() },
      });
    } catch (e2) {}
  }

  // 更新 ctx
  ctx.profile = profile;
  if (metrics) ctx.metrics = metrics;

  const hasFullBody = !!(profile.height_cm && profile.weight_kg && profile.age);
  const hasPlace = !!profile.place;

  let message = '身体数据已更新';
  if (metrics) {
    message += `。BMI ${metrics.bmi}，日消耗 ${metrics.tdee} kcal`;
  }
  if (hasFullBody && !hasPlace) {
    message += '。用户还未选择训练场所（居家/健身房），请引导用户选择。';
  }
  if (hasFullBody && hasPlace) {
    message += '。用户资料完整，如果没有训练计划请调用 generate_weekly_plan 生成。';
  }

  return {
    success: true,
    profileComplete: hasFullBody && hasPlace,
    hasBody: hasFullBody,
    hasPlace,
    profile,
    metrics,
    message,
  };
}

/**
 * generate_weekly_plan — 生成/重新生成 7 天训练计划
 */
async function executeGenerateWeeklyPlan(args, ctx) {
  const db = cloud.database();
  const profile = ctx.profile || {};

  if (!profile.height_cm || !profile.weight_kg) {
    return { success: false, error: '用户尚未录入完整身体数据，请先引导用户提供身高、体重等信息' };
  }
  if (!profile.place) {
    return { success: false, error: '用户尚未选择训练场所（居家/健身房），请引导用户选择' };
  }

  const feedback = args.feedback || '';

  let plan;
  try {
    plan = await generateWeeklyPlanWithAI(profile, feedback);
  } catch (e) {
    // AI 失败 → 规则引擎兜底
    plan = fallbackWeeklyPlan(profile);
  }

  // 保存到云数据库
  try {
    await db.collection('user_states').doc(ctx.openid).update({
      data: { weeklyPlan: plan, updatedAt: new Date() },
    });
  } catch (e) {
    try {
      await db.collection('user_states').doc(ctx.openid).set({
        data: { openid: ctx.openid, weeklyPlan: plan, updatedAt: new Date() },
      });
    } catch (e2) {}
  }

  // 标记
  ctx.planUpdated = true;

  // 生成可读摘要
  const summary = plan.days.map(d =>
    d.rest ? `${d.label} 休息` : `${d.label} ${d.focus}：${d.exercises.map(e => e.name).join('、')}`
  ).join('\n');

  return {
    success: true,
    planSummary: summary,
    days: plan.days,
    startDate: plan.startDate,
    place: profile.place,
  };
}

/**
 * generate_meal — 生成一餐饮食方案
 */
async function executeGenerateMeal(args, ctx) {
  const db = cloud.database();
  const profile = ctx.profile || {};
  const regenerate = args.regenerate || false;

  if (!profile.height_cm) {
    return { success: false, error: '用户尚未录入身体数据，请先引导用户提供身高、体重等信息' };
  }

  // 计算指标
  const metrics = ctx.metrics || bodyMetrics.calculateMetrics(
    profile.height_cm, profile.weight_kg || 60, profile.age || 25,
    profile.gender || 'male', profile.fitness_goal || 'maintain', 'moderate',
  );

  const targetKcal = metrics.recommended_intake;
  const allergies = profile.allergies || [];
  const likedFoods = profile.likedFoods || [];

  let meal;
  try {
    meal = await generateSingleMealWithAI(targetKcal, allergies, likedFoods, regenerate ? ctx.lastStaple : null);
  } catch (e) {
    // AI 失败 → 规则引擎兜底
    const staple = regenerate
      ? staplePicker.regenerateStaple(ctx.lastStaple, ctx.lastStaple)
      : staplePicker.generateDailyStaple(ctx.lastStaple);
    meal = mealPlanner.generateMeal(targetKcal, allergies, staple);
  }

  // 保存主食记录（用于换一换去重）
  if (meal.main_staple && !meal.error) {
    const stapleName = meal.main_staple.split(' ')[0];
    ctx.lastStaple = stapleName;
    try {
      await db.collection('user_states').doc(ctx.openid).update({ data: { lastStaple: stapleName } });
    } catch (e) {}
  }

  // 保存饮食日志
  if (!meal.error) {
    try {
      await db.collection('meal_logs').add({
        data: {
          openid: ctx.openid,
          date: new Date().toISOString().slice(0, 10),
          mealData: meal,
          createdAt: new Date(),
        },
      });
    } catch (e) {}
  }

  if (meal.error) {
    return { success: false, error: meal.error };
  }

  return {
    success: true,
    meal: {
      main_staple: meal.main_staple,
      dishes: meal.dishes,
      total_kcal: meal.total_kcal,
      protein_g: meal.protein_g,
      fat_g: meal.fat_g,
      carb_g: meal.carb_g,
    },
  };
}

/**
 * record_weight — 记录体重
 */
async function executeRecordWeight(args, ctx) {
  const db = cloud.database();
  const profile = ctx.profile || {};

  let weightKg = args.weight;
  if (args.unit === '斤') {
    weightKg = weightKg / 2;
  }

  const oldWeight = profile.weight_kg || weightKg;
  const changePercent = oldWeight > 0 ? ((weightKg - oldWeight) / oldWeight * 100) : 0;
  const shouldRegenerate = Math.abs(changePercent) > 2;

  // 保存体重记录
  try {
    await db.collection('weight_logs').add({
      data: {
        openid: ctx.openid,
        weight: Math.round(weightKg * 10) / 10,
        date: new Date().toISOString().slice(0, 10),
        createdAt: new Date(),
      },
    });
  } catch (e) {}

  // 更新用户体重
  profile.weight_kg = Math.round(weightKg * 10) / 10;
  ctx.profile = profile;
  try {
    await db.collection('user_states').doc(ctx.openid).update({
      data: { 'profile.weight_kg': profile.weight_kg, updatedAt: new Date() },
    });
  } catch (e) {}

  return {
    success: true,
    oldWeight: Math.round(oldWeight * 10) / 10,
    newWeight: Math.round(weightKg * 10) / 10,
    changePercent: Math.round(Math.abs(changePercent) * 10) / 10,
    shouldRegenerate,
    message: shouldRegenerate
      ? `体重变化 ${Math.abs(changePercent).toFixed(1)}%，超过 2%，建议调用 generate_weekly_plan 更新训练计划`
      : '体重变化平稳，无需调整计划',
  };
}

/**
 * get_exercise_info — 查询动作库
 */
async function executeGetExerciseInfo(args, ctx) {
  const profile = ctx.profile || {};
  const place = profile.place || 'home';
  const level = profile.fitness_level || 'beginner';

  // 从动作库筛选
  let pool = exercises.filterForPrompt(place, level);

  // 按肌群过滤
  if (args.muscle) {
    pool = pool.filter(e => e.muscle === args.muscle);
  }
  // 按名称关键词过滤
  if (args.query) {
    pool = pool.filter(e => e.name.includes(args.query));
  }

  // 按肌群分组
  const byMuscle = {};
  for (const ex of pool) {
    if (!byMuscle[ex.muscle]) byMuscle[ex.muscle] = [];
    const entry = { name: ex.name, level: ex.level, place: ex.place };
    if (ex.warning) entry.warning = ex.warning;
    byMuscle[ex.muscle].push(entry);
  }

  return {
    success: true,
    totalCount: pool.length,
    byMuscle,
    place,
  };
}

// ================================================================
// 内部 AI 调用辅助（工具内使用，不走 Agent tool calling）
// ================================================================

/**
 * AI 生成 7 天训练计划（JSON 模式）
 */
async function generateWeeklyPlanWithAI(profile, feedback = '') {
  const isHome = profile.place !== 'gym';
  const level = profile.fitness_level || 'beginner';
  const fb = feedback ? `\n用户反馈：${feedback}。请据此调整计划强度。` : '';

  // 从动作库筛选候选动作
  const candidatePool = exercises.filterForPrompt(isHome ? 'home' : 'gym', level);
  const byMuscle = {};
  const dangerNames = {};
  for (const ex of candidatePool) {
    if (!byMuscle[ex.muscle]) byMuscle[ex.muscle] = [];
    byMuscle[ex.muscle].push(ex.name);
    if (ex.warning) dangerNames[ex.name] = ex.warning;
  }
  const poolText = Object.entries(byMuscle)
    .map(([m, names]) => `${m}：${names.join('、')}`)
    .join('\n');
  const dangerRules = Object.keys(dangerNames).length > 0
    ? '\n\n【安全警告】以下动作必须在输出时追加警告文字：\n' +
      Object.entries(dangerNames).map(([n, w]) => `- ${n}：输出时 name 后加 "（注意：${w}）"`).join('\n')
    : '';

  const constraints = isHome
    ? '居家训练，只能用自重和哑铃/弹力带类动作。'
    : '健身房训练，可用杠铃/哑铃/绳索/器械。';

  const prompt = `你是专业健身教练。根据用户数据严格生成7天训练计划。

用户：${profile.gender === 'male' ? '男' : '女'}，${profile.age}岁，身高${profile.height_cm}cm，体重${profile.weight_kg}kg，体能${level}，目标${profile.fitness_goal === 'fat_loss' ? '减脂' : profile.fitness_goal === 'muscle_gain' ? '增肌' : '维持'}。
${constraints}${fb}

【候选动作库】只能从以下动作名中选，不要编造：
${poolText}${dangerRules}

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
  ], { temperature: 0.6, maxTokens: 3000, jsonMode: true });

  let json = resp.content.trim();
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
        exercises: (found.exercises || []).map(ex => {
          const baseName = ex.name.replace(/（注意：.*）/, '').trim();
          const warn = dangerNames[baseName];
          return {
            name: warn ? `${baseName}（注意：${warn}）` : baseName,
            sets: ex.sets || 3, reps: ex.reps || 10,
            weight: ex.weight || 0, notes: ex.notes || '保持标准动作',
          };
        }),
      };
    }
    return { label, day: i + 1, focus: i < 5 && i !== 2 ? '训练' : '休息', rest: i >= 5 || i === 2, exercises: [] };
  });

  const startDate = new Date().toISOString().slice(0, 10);
  return { days, startDate };
}

/**
 * 规则引擎兜底 — 7 天训练计划
 */
function fallbackWeeklyPlan(profile) {
  const isHome = profile.place !== 'gym';
  const level = profile.fitness_level || 'beginner';
  const pool = exercises.filterForPrompt(isHome ? 'home' : 'gym', level);

  function pick(muscles, count) {
    const candidates = pool.filter(e => muscles.some(m => e.muscle === m));
    const picked = [];
    const used = new Set();
    for (const e of candidates) {
      if (picked.length >= count) break;
      if (used.has(e.name)) continue;
      used.add(e.name);
      const ename = e.warning ? `${e.name}（注意：${e.warning}）` : e.name;
      picked.push({ name: ename, sets: 3, reps: isHome ? 12 : 10, weight: isHome ? 0 : 15, notes: '保持标准动作' });
    }
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
 * AI 生成单餐（JSON 模式）
 */
async function generateSingleMealWithAI(targetKcal, allergies, likedFoods, excludeStaple) {
  const allergyStr = allergies.length > 0 ? `\n忌口：${allergies.join('、')}，绝对不能出现。` : '';
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

  const resp = await callAI([
    { role: 'system', content: '你是营养师。只输出JSON，不要解释。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.9, maxTokens: 800, jsonMode: true });

  let jsonStr = resp.content.trim();
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

module.exports = { TOOL_DEFINITIONS, executeTool };
