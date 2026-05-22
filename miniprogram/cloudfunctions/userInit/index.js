/**
 * userInit 云函数 — 用户初始化/登录/档案管理
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action, profile, allergies } = event;

  switch (action) {
    case 'login':
      return handleLogin(openid);

    case 'register':
      return handleRegister(openid, profile);

    case 'getProfile':
      return handleGetProfile(openid);

    case 'updateAllergies':
      return handleUpdateAllergies(openid, allergies);

    case 'updateLikedFoods':
      return handleUpdateLikedFoods(openid, event.likedFoods);

    case 'submitFeedback':
      return handleSubmitFeedback(openid, event.content);

    case 'syncCredits':
      return handleSyncCredits(openid, event.credits);

    case 'trackEvent':
      return handleTrackEvent(openid, event.event, event.extra);

    case 'getAnalytics':
      return handleGetAnalytics();

    case 'updateProfile':
      return handleUpdateProfile(openid, profile);

    default:
      return { error: '未知操作' };
  }
};

async function handleLogin(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    return {
      openid,
      isNewUser: false,
      profile: res.data.profile || null,
      metrics: res.data.metrics || null,
      credits: res.data.credits || 0,
    };
  } catch (e) {
    return { openid, isNewUser: true, credits: 200 };
  }
}

async function handleRegister(openid, profile) {
  await db.collection('user_states').doc(openid).set({
    data: {
      openid,
      profile,
      credits: 200,  // 新人免费额度
      convState: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // 记录初始体重
  await db.collection('weight_logs').add({
    data: {
      openid,
      weight: profile.weight_kg,
      date: new Date().toISOString().slice(0, 10),
      createdAt: new Date(),
    },
  });

  return { success: true, credits: 200 };
}

async function handleGetProfile(openid) {
  try {
    const res = await db.collection('user_states').doc(openid).get();
    const weightLogs = await db.collection('weight_logs')
      .where({ openid })
      .orderBy('date', 'desc')
      .limit(14)
      .get();

    return {
      profile: res.data.profile,
      metrics: res.data.metrics,
      credits: res.data.credits || 0,
      weeklyPlan: res.data.weeklyPlan || null,
      weightHistory: weightLogs.data.map(r => ({ weight_kg: r.weight, date: r.date })),
    };
  } catch (e) {
    return { error: '用户不存在' };
  }
}

async function handleUpdateAllergies(openid, allergies) {
  await db.collection('user_states').doc(openid).update({
    data: { 'profile.allergies': allergies, updatedAt: new Date() },
  });
  return { success: true };
}

async function handleUpdateLikedFoods(openid, likedFoods) {
  await db.collection('user_states').doc(openid).update({
    data: { 'profile.likedFoods': likedFoods, updatedAt: new Date() },
  });
  return { success: true };
}

async function handleUpdateProfile(openid, profile) {
  await db.collection('user_states').doc(openid).update({
    data: { profile, updatedAt: new Date() },
  });
  return { success: true };
}

async function handleGetAnalytics() {
  const today = new Date().toISOString().slice(0, 10);
  const _ = db.command;

  // 累计用户数（去重）
  const usersRes = await db.collection('analytics')
    .where({ event: 'user_signup' })
    .count();
  const totalUsers = usersRes.total;

  // 今日签到数
  const signinRes = await db.collection('analytics')
    .where({ event: 'daily_signin', date: today })
    .count();

  // 今日活跃
  const activeRes = await db.collection('analytics')
    .where({ date: today })
    .count();

  // 累计计划生成
  const planRes = await db.collection('analytics')
    .where({ event: 'plan_generated' })
    .count();

  // 累计计划更新
  const updateRes = await db.collection('analytics')
    .where({ event: 'plan_updated' })
    .count();

  // 累计饮食
  const mealRes = await db.collection('analytics')
    .where({ event: 'meal_generated' })
    .count();

  // 累计完成
  const exRes = await db.collection('analytics')
    .where({ event: 'exercise_done' })
    .count();

  // 每日用户新增（最近14天）
  const signupByDay = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const cnt = await db.collection('analytics')
      .where({ event: 'user_signup', date: dateStr })
      .count();
    signupByDay.push({ date: dateStr.slice(5), count: cnt.total });
  }

  return {
    success: true,
    totalUsers,
    todaySignin: signinRes.total,
    todayActive: activeRes.total,
    plansGenerated: planRes.total,
    plansUpdated: updateRes.total,
    mealsGenerated: mealRes.total,
    exercisesDone: exRes.total,
    signupByDay,
  };
}

async function handleTrackEvent(openid, eventName, extra) {
  const today = new Date().toISOString().slice(0, 10);
  await db.collection('analytics').add({
    data: {
      _openid: openid,
      event: eventName,
      extra: extra || '',
      date: today,
      createdAt: db.serverDate(),
    },
  });
  return { success: true };
}

async function handleSyncCredits(openid, credits) {
  if (credits === undefined || credits === null) return { success: false };
  try {
    await db.collection('user_states').doc(openid).update({ data: { credits, updatedAt: new Date() } });
  } catch (e) {
    await db.collection('user_states').doc(openid).set({ data: { openid, credits } });
  }
  return { success: true };
}

async function handleSubmitFeedback(openid, content) {
  if (!content || !content.trim()) return { success: false, error: '内容为空' };
  await db.collection('feedbacks').add({
    data: {
      _openid: openid,
      content: content.trim(),
      createdAt: db.serverDate(),
      appVersion: '1.0.0',
      resolved: false,
    },
  });
  return { success: true };
}
