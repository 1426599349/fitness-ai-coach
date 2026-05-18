const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 内联动作库
const ACTIONS = {
  home: {
    beginner: [{ name: '深蹲', muscle: '腿', notes: '膝盖不过脚尖' },{ name: '靠墙俯卧撑', muscle: '胸', notes: '身体成直线' },{ name: '平板支撑', muscle: '核心', notes: '收紧腹部' },{ name: '原地踏步', muscle: '有氧', notes: '保持节奏' },{ name: '臀桥', muscle: '腿', notes: '臀部发力上抬' },{ name: '跪姿俯卧撑', muscle: '胸', notes: '膝盖着地' }],
    intermediate: [{ name: '标准俯卧撑', muscle: '胸', notes: '下落时胸部贴近地面' },{ name: '弓步蹲', muscle: '腿', notes: '前膝不超过脚尖' },{ name: '仰卧起坐', muscle: '核心', notes: '用腹部发力' },{ name: '开合跳', muscle: '有氧', notes: '落地轻盈' },{ name: '登山跑', muscle: '核心', notes: '保持核心稳定' },{ name: '深蹲', muscle: '腿', notes: '可手持哑铃' }],
    advanced: [{ name: '波比跳', muscle: '全身', notes: '全程核心收紧' },{ name: '单腿深蹲', muscle: '腿', notes: '扶墙辅助' },{ name: '钻石俯卧撑', muscle: '胸', notes: '双手拇指食指相触' },{ name: '保加利亚分腿蹲', muscle: '腿', notes: '后脚抬高' },{ name: '标准俯卧撑', muscle: '胸', notes: '可负重背包' }],
  },
  gym: {
    beginner: [{ name: '器械腿举', muscle: '腿', notes: '膝盖不锁死' },{ name: '坐姿胸推', muscle: '胸', notes: '肩胛收紧' },{ name: '高位下拉', muscle: '背', notes: '沉肩' },{ name: '坐姿划船', muscle: '背', notes: '挺胸收腹' },{ name: '椭圆机', muscle: '有氧', notes: '保持匀速' }],
    intermediate: [{ name: '杠铃深蹲', muscle: '腿', notes: '脊柱中立' },{ name: '哑铃卧推', muscle: '胸', notes: '手腕中立' },{ name: '引体向上', muscle: '背', notes: '辅助机辅助' },{ name: '罗马尼亚硬拉', muscle: '腿', notes: '髋部后移' },{ name: '坐姿哑铃推举', muscle: '肩', notes: '稳定发力' }],
    advanced: [{ name: '自由深蹲', muscle: '腿', notes: '充分热身' },{ name: '平板卧推', muscle: '胸', notes: '大重量需保护' },{ name: '负重引体向上', muscle: '背', notes: '负重背心' },{ name: '硬拉', muscle: '全身', notes: '脊柱中立' },{ name: '双杠臂屈伸', muscle: '臂', notes: '身体前倾练胸' }],
  },
};
const LIMITS = { beginner: { ex: 6, s: 3, r: 12 }, intermediate: { ex: 8, s: 4, r: 15 }, advanced: { ex: 10, s: 5, r: 20 } };
const SPLIT = [{ d: 1, f: '胸+三头', m: ['胸','臂'] },{ d: 2, f: '背+二头', m: ['背','臂'] },{ d: 3, f: '休息', m: [] },{ d: 4, f: '腿+肩', m: ['腿','肩'] },{ d: 5, f: '核心+有氧', m: ['核心','有氧'] },{ d: 6, f: '休息', m: [] },{ d: 7, f: '休息', m: [] }];

function genPlan(place, level) {
  const pool = (ACTIONS[place] || ACTIONS.home)[level] || ACTIONS.home.beginner;
  const lim = LIMITS[level] || LIMITS.beginner;
  const schedule = SPLIT.map(slot => {
    if (slot.f === '休息') return { day: slot.d, focus: '休息', exercises: [] };
    const used = new Set();
    const exercises = [];
    const n = Math.min(Math.floor(Math.random() * 3) + 3, lim.ex);
    for (let i = 0; i < n; i++) {
      const candidates = pool.filter(a => slot.m.some(m => a.muscle === m) && !used.has(a.name));
      const a = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : pool.filter(a => !used.has(a.name))[0] || pool[0];
      used.add(a.name);
      exercises.push({ name: a.name, sets: Math.floor(Math.random() * (lim.s - 1)) + 2, reps: Math.floor(Math.random() * 5) + 8, rest_seconds: [30,45,60,90][Math.floor(Math.random()*4)], notes: a.notes });
    }
    return { day: slot.d, focus: slot.f, exercises };
  });
  return { place, days: 7, fitness_level: level, schedule };
}

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID;
  const { action } = event;

  let profile;
  try { profile = (await db.collection('user_states').doc(openid).get()).data.profile; }
  catch (e) { return { success: false, error: '请先录入身体数据' }; }

  if (action === 'regenerate') {
    const plan = genPlan(profile.place || 'home', profile.fitness_level || 'beginner');
    await db.collection('workout_plans').add({ data: { openid, planData: plan, version: Date.now(), createdAt: new Date() } });
    return { success: true, type: 'workout-card', cardData: plan };
  }

  const exist = await db.collection('workout_plans').where({ openid }).orderBy('createdAt', 'desc').limit(1).get();
  if (exist.data.length > 0) return { success: true, type: 'workout-card', cardData: exist.data[0].planData };

  const plan = genPlan(profile.place || 'home', profile.fitness_level || 'beginner');
  await db.collection('workout_plans').add({ data: { openid, planData: plan, version: 1, createdAt: new Date() } });
  return { success: true, type: 'workout-card', cardData: plan };
};
