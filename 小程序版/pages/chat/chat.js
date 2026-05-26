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

  // 连击积分5次解锁自由对话
  _creditsTapCount: 0,
  _creditsTapTimer: null,
  onCreditsTap() {
    if (this._creditsTapTimer) clearTimeout(this._creditsTapTimer);
    this._creditsTapCount++;
    this._creditsTapTimer = setTimeout(() => { this._creditsTapCount = 0; }, 1500);
    if (this._creditsTapCount >= 5 && !this.data.showChatInput) {
      this._creditsTapCount = 0;
      clearTimeout(this._creditsTapTimer);
      this.setData({ showChatInput: true });
      wx.showToast({ title: '自由对话已解锁', icon: 'none' });
    }
  },

  onLoad() {
    this.syncCredits();
    this.initChat();
    this.checkDailySignin();
  },

  onShow() {
    this.syncCredits();
    // 从个人中心触发了清除对话 → 清空消息
    if (app.globalData.needClearChat) {
      app.globalData.needClearChat = false;
      this.setData({ messages: [], convState: C.CONV_STATE.GREETING, showQuickActions: false });
      this.sayGreeting();
      return;
    }
    // 页面被重建但 Storage 有历史消息 → 恢复
    if (this.data.messages.length === 0) {
      const saved = wx.getStorageSync('chatMessages');
      if (saved && saved.length > 0) {
        this.setData({ messages: saved });
        if (app.globalData.userProfile) {
          this.setData({ convState: C.CONV_STATE.READY, showQuickActions: true });
        }
      }
    }
  },

  // 积分持久化：Storage 为准，globalData 为缓存
  _loadCredits() {
    const stored = wx.getStorageSync('userCredits');
    if (stored !== undefined && stored !== null && stored !== '') {
      return stored;
    }
    return app.globalData.credits || 200;
  },
  _saveCredits(val) {
    wx.setStorageSync('userCredits', val);
    app.globalData.credits = val;
  },
  // 每5分钟恢复1点，上限200
  _regenCredits() {
    const now = Date.now();
    const lastTime = wx.getStorageSync('lastCreditRegenTime') || now;
    const elapsed = Math.floor((now - lastTime) / 1000 / 60); // 分钟
    const regen = Math.floor(elapsed / 5); // 每5分钟1点
    if (regen > 0) {
      const current = this._loadCredits();
      // 回复不超过200上限，但已有积分（含签到）不受影响
      const target = Math.min(current + regen, 200);
      const newVal = Math.max(current, target);
      if (newVal > current) {
        this._saveCredits(newVal);
        this.setData({ credits: newVal });
        // 同步到云端
        api.callCloudFunction('userInit', { action: 'syncCredits', credits: newVal }).catch(() => {});
      }
      wx.setStorageSync('lastCreditRegenTime', now);
    }
  },
  syncCredits() {
    this._regenCredits();
    const c = this._loadCredits();
    this.setData({ credits: c });
    app.globalData.credits = c;
  },

  // 每日签到
  checkDailySignin() {
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = wx.getStorageSync('lastSigninDate');
    if (lastDate === today) {
      this.setData({ signedToday: true });
    }
  },

  onDailySignin() {
    if (this.data.signedToday) {
      wx.showToast({ title: '今日已签到', icon: 'none' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    wx.setStorageSync('lastSigninDate', today);
    const newCredits = this.data.credits + 20;
    this.setData({ credits: newCredits, signedToday: true });
    this._saveCredits(newCredits);
    analytics.track(analytics.EVENTS.daily_signin);
    // 同步积分到云端
    api.callCloudFunction('userInit', { action: 'syncCredits', credits: newCredits }).catch(() => {});
    wx.showToast({ title: '签到成功 +20 积分', icon: 'success' });
  },

  // 初始化对话
  async initChat() {
    const saved = wx.getStorageSync('chatMessages');
    if (saved && saved.length > 0) {
      this.setData({ messages: saved });
      // 恢复对话状态
      if (app.globalData.userProfile) {
        this.setData({ convState: C.CONV_STATE.READY, showQuickActions: true });
      }
    } else {
      this.sayGreeting();
    }
  },

  sayGreeting() {
    this.addAIMessage(
      '你好，我是你的营养管家 🥗\n\n' +
      '请填写以下信息，我会为你定制专属计划：',
      C.MSG_TYPE.TEXT
    );
    this.addAIMessage('', C.MSG_TYPE.ONBOARDING_FORM);
    this.setData({ convState: C.CONV_STATE.ONBOARDING });
  },

  addAIMessage(content, type = C.MSG_TYPE.TEXT, cardData = null) {
    this.addMessage({
      id: this.genId(),
      role: C.ROLE.AI,
      type, content, cardData,
      time: this.getTime(),
    });
  },

  addUserMessage(content) {
    this.addMessage({
      id: this.genId(),
      role: C.ROLE.USER,
      type: C.MSG_TYPE.TEXT,
      content,
      time: this.getTime(),
    });
  },

  addMessage(msg) {
    const messages = [...this.data.messages, msg];
    this.setData({ messages, scrollToId: 'msg-' + msg.id });
    // 持久化最近 50 条消息，切换 Tab 不丢失
    const toSave = messages.slice(-50);
    wx.setStorageSync('chatMessages', toSave);
  },

  onInputChange(e) {
    this.setData({ inputText: e.detail.value });
  },

  // ========== 发送消息 ==========
  _directSend(text) {
    this.data.inputText = text;
    this.onSend();
  },

  async onSend() {
    const text = this.data.inputText ? this.data.inputText.trim() : '';
    this.setData({ inputText: '' });
    if (!text || this.data.aiThinking) return;

    if (this.checkMedicalRedline(text)) {
      this.addAIMessage(
        '你好，我是健身饮食助手，不提供医疗建议。如有健康问题，请咨询专业医生。',
        C.MSG_TYPE.TEXT
      );
      return;
    }

    this.addUserMessage(text);
    this.setData({ aiThinking: true });

    try {
      const result = await api.aiChat(text, { convState: this.data.convState });
      this.renderAIResponse(result);
    } catch (err) {
      console.error('AI响应失败:', err);
      this.addAIMessage('抱歉，我暂时无法响应，请稍后再试~', C.MSG_TYPE.TEXT);
    } finally {
      this.setData({ aiThinking: false });
      this.syncCredits();
    }
  },

  renderAIResponse(result) {
    // 更新积分
    if (result && result.credits !== undefined) {
      this._saveCredits(result.credits);
      this.setData({ credits: result.credits });
    }

    if (result.messages && Array.isArray(result.messages)) {
      this.addAIMessage(result.content, C.MSG_TYPE.TEXT);
      result.messages.forEach((msg) => {
        this.addAIMessage(msg.content, msg.type, msg.cardData);
      });
      if (this.data.convState === C.CONV_STATE.ONBOARDING) {
        this.setData({ convState: C.CONV_STATE.READY, showQuickActions: true });
      }
      this.syncWeeklyPlan();
      return;
    }

    switch (result.type) {
      case C.MSG_TYPE.METRICS:
        this.addAIMessage(result.content, C.MSG_TYPE.METRICS, result.cardData);
        if (this.data.convState === C.CONV_STATE.ONBOARDING) {
          this.setData({ convState: C.CONV_STATE.READY, showQuickActions: true });
          analytics.track(analytics.EVENTS.user_signup);
        }
        this.syncWeeklyPlan();
        break;
      case C.MSG_TYPE.WORKOUT:
        this.addAIMessage(result.content, C.MSG_TYPE.WORKOUT, result.cardData);
        this.syncWeeklyPlan();
        break;
      case C.MSG_TYPE.MEAL:
        this.addAIMessage(result.content, C.MSG_TYPE.MEAL, result.cardData);
        analytics.track(analytics.EVENTS.meal_generated);
        break;
      case C.MSG_TYPE.ONBOARDING:
        this.addAIMessage(result.content, C.MSG_TYPE.TEXT);
        this.syncWeeklyPlan();
        break;
      default:
        this.addAIMessage(result.content, C.MSG_TYPE.TEXT);
        if (this.data.convState === C.CONV_STATE.ONBOARDING) {
          this.setData({ convState: C.CONV_STATE.READY, showQuickActions: true });
          analytics.track(analytics.EVENTS.user_signup);
        }
        this.syncWeeklyPlan();
    }
  },

  // 从云端拉取最新计划并缓存到本地
  async syncWeeklyPlan() {
    try {
      const existing = wx.getStorageSync('weeklyPlan');
      const isUpdate = !!(existing && existing.days && existing.days.length > 0);
      const res = await api.callCloudFunction('aiChat', { action: 'get_weekly_plan' });
      if (res && res.plan && res.plan.days) {
        wx.setStorageSync('weeklyPlan', JSON.stringify(res.plan));
        analytics.track(isUpdate ? analytics.EVENTS.plan_updated : analytics.EVENTS.plan_generated);
      }
    } catch (e) {}
  },

  // ========== 快捷操作 ==========
  onQuickAction(e) {
    const key = e.currentTarget.dataset.key;
    const map = { meal: '今天吃什么', regenerate: '换一换', workout: '查看我的训练计划', checkin: '我要更新体重' };
    const text = map[key] || '';
    if (text) { this.setData({ inputText: text }); this.onSend(); }
  },

  onCardAction(e) {
    const { action, place } = e.detail;
    const map = { regenerate_meal: '换一换', update_weight: '我要更新体重', view_workout: '查看我的训练计划' };
    if (action === 'choose_place') {
      this.setData({ inputText: '我选择' + (place === 'gym' ? '健身房' : '居家') + '健身' });
      this.onSend();
      return;
    }
    if (action === 'submit_profile') {
      const d = e.detail.data;
      const goalLabel = d.fitness_goal === 'fat_loss' ? '减脂' : d.fitness_goal === 'muscle_gain' ? '增肌' : d.fitness_goal === 'shape' ? '塑形' : '维持';
      const text = `${d.height_cm} ${d.weight_kg} ${d.gender === 'female' ? '女' : '男'} ${d.age} ${goalLabel} ${d.place === 'gym' ? '健身房' : '居家'}`;
      this._directSend(text);
      return;
    }
    if (action === 'choose_place') {
      const p = this.data.pendingProfile;
      if (p) {
        const goalLabel = p.fitness_goal === 'fat_loss' ? '减脂' : p.fitness_goal === 'muscle_gain' ? '增肌' : p.fitness_goal === 'shape' ? '塑形' : '维持';
        const text = `${p.height_cm} ${p.weight_kg} ${p.gender === 'female' ? '女' : '男'} ${p.age} ${goalLabel} ${place === 'gym' ? '健身房' : '居家'}`;
        this.setData({ inputText: text, pendingProfile: null });
        this._directSend(text);
        return;
      }
      this.setData({ inputText: '我选择' + (place === 'gym' ? '健身房' : '居家') + '健身' });
      this.onSend();
      return;
    }
    const text = map[action] || '';
    if (text) { this.setData({ inputText: text }); this.onSend(); }
  },

  checkMedicalRedline(text) {
    const kw = ['治疗','治愈','康复','诊断','处方','药物','药品','疾病','病症','病理','手术','化疗'];
    return kw.some(k => text.includes(k));
  },

  genId() { return 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); },
  getTime() { const d = new Date(); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; },
});
