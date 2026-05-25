/**
 * AI对话首页 — 核心逻辑 + 积分系统
 */
const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');
const C = require('../../utils/constants.js');
const app = getApp();
const analytics = require('../../utils/analytics.js');

Page({
  data: {
    messages: [],
    inputText: '',
    aiThinking: false,
    showQuickActions: false,
    scrollToId: '',
    credits: 200,
    pendingProfile: null,
    quickActions: [
      { key: 'meal', label: '今天吃什么', icon: '🍽️' },
      { key: 'regenerate', label: '换一换', icon: '🔄' },
      { key: 'workout', label: '训练计划', icon: '💪' },
      { key: 'checkin', label: '更新体重', icon: '⚖️' },
    ],
    loadingHistory: false,
    convState: C.CONV_STATE.GREETING,
    signedToday: false,
    showChatInput: false,
  },

