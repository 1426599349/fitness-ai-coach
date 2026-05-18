/**
 * 全局常量定义
 */

// AI消息类型
const MSG_TYPE = {
  TEXT: 'text',               // 纯文本
  METRICS: 'metrics-card',    // 身体指标卡片
  WORKOUT: 'workout-card',    // 训练计划卡片
  MEAL: 'meal-card',          // 饮食搭配卡片
  ONBOARDING: 'onboarding',   // 引导录入表单
  PLACE_CHOICE: 'place_choice', // 场所选择按钮
  ONBOARDING_FORM: 'onboarding_form', // 身体数据录入表单
  LOADING: 'loading',         // 加载态
};

// 角色
const ROLE = {
  USER: 'user',
  AI: 'ai',
};

// 对话状态机
const CONV_STATE = {
  GREETING: 'greeting',       // 打招呼
  ONBOARDING: 'onboarding',   // 引导录入
  READY: 'ready',             // 正常对话
};

// 健身目标
const FITNESS_GOALS = [
  { value: 'fat_loss', label: '减脂' },
  { value: 'muscle_gain', label: '增肌' },
  { value: 'shape', label: '塑形' },
  { value: 'maintain', label: '维持身材' },
];

// 体能等级
const FITNESS_LEVELS = [
  { value: 'beginner', label: '零基础' },
  { value: 'intermediate', label: '初级/中级' },
  { value: 'advanced', label: '进阶' },
];

// 快捷操作
const QUICK_ACTIONS = [
  { key: 'meal', label: '今天吃什么', icon: 'food' },
  { key: 'regenerate', label: '换一换', icon: 'refresh' },
  { key: 'workout', label: '训练计划', icon: 'sport' },
  { key: 'checkin', label: '更新体重', icon: 'scale' },
];

module.exports = {
  MSG_TYPE,
  ROLE,
  CONV_STATE,
  FITNESS_GOALS,
  FITNESS_LEVELS,
  QUICK_ACTIONS,
};
