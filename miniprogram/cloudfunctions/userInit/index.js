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
