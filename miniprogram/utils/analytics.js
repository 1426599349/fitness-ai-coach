/**
 * 事件埋点 — 关键行为上报云数据库 analytics 集合
 * 从数据库直接查询留存率、任务完成率等
 */
const api = require('./api.js');

const EVENTS = {
  // 新用户完成首次录入
  user_signup: 'user_signup',
  // 当日签到
  daily_signin: 'daily_signin',
  // AI生成训练计划
  plan_generated: 'plan_generated',
  // 计划更新（体重变化/用户要求/AI自主）
  plan_updated: 'plan_updated',
  // 勾选完成某个训练动作
  exercise_done: 'exercise_done',
  // 生成饮食方案
  meal_generated: 'meal_generated',
  // 查看本周计划页
  view_weekly_plan: 'view_weekly_plan',
  // 浏览动作库
  view_exercise_lib: 'view_exercise_lib',
};

function track(eventName, extra = {}) {
  try {
    const app = getApp();
    if (!app || !app.globalData) return;
    api.callCloudFunction('userInit', {
      action: 'trackEvent',
      event: eventName,
      extra: JSON.stringify(extra),
    }).catch(() => {});
  } catch (e) {}
}

module.exports = { track, EVENTS };
