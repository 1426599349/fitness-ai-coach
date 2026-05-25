const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID;
  const { weight } = event;
  if (!weight) return { success: false, error: '请提供体重' };

  let profile, userData;
  try {
    userData = await db.collection('user_states').doc(openid).get();
    profile = userData.data.profile;
  } catch (e) { return { success: false, error: '用户不存在' }; }

  const oldWeight = profile.weight_kg;
  const pct = ((weight - oldWeight) / oldWeight * 100);
  const needUpdate = Math.abs(pct) > 2;

  await db.collection('weight_logs').add({ data: { openid, weight, date: new Date().toISOString().slice(0, 10), createdAt: new Date() } });
  await db.collection('user_states').doc(openid).update({ data: { 'profile.weight_kg': weight, updatedAt: new Date() } });

  return {
    success: true, oldWeight, newWeight: weight,
    changePercent: Math.round(pct * 10) / 10,
    shouldRegenerate: needUpdate,
    message: needUpdate ? `体重变化 ${Math.abs(pct).toFixed(1)}%，超过2%，建议更新方案` : '体重变化平稳',
  };
};
