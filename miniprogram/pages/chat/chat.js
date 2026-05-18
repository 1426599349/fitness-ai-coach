/**
 * AI对话首页 — 核心逻辑 + 积分系统
 */
const api = require('../../utils/api.js');
const auth = require('../../utils/auth.js');
const C = require('../../utils/constants.js');
const app = getApp();

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
  },

  onLoad() {
    this.syncCredits();
    this.initChat();
    this.checkDailySignin();
  },

  onShow() {
    this.syncCredits();
    // 如果从个人中心清除了对话记录，重置聊天界面
    if (app.globalData.conversationState === 'greeting' && this.data.messages.length > 0) {
      this.setData({ messages: [], convState: C.CONV_STATE.GREETING, showQuickActions: false });
      this.sayGreeting();
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
      const newVal = Math.min(current + regen, 200);
      if (newVal > current) {
        this._saveCredits(newVal);
        this.setData({ credits: newVal });
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
    const newCredits = this.data.credits + 5;
    this.setData({ credits: newCredits, signedToday: true });
    this._saveCredits(newCredits);
    wx.showToast({ title: '签到成功 +5 积分', icon: 'success' });
  },

  // 初始化对话
  async initChat() {
    this.sayGreeting();
  },

  sayGreeting() {
    this.addAIMessage(
      '你好，我是你的智能营养管家 🥗\n\n' +
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
      app.globalData.credits = result.credits;
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
        }
        this.syncWeeklyPlan();
        break;
      case C.MSG_TYPE.WORKOUT:
        this.addAIMessage(result.content, C.MSG_TYPE.WORKOUT, result.cardData);
        this.syncWeeklyPlan();
        break;
      case C.MSG_TYPE.MEAL:
        this.addAIMessage(result.content, C.MSG_TYPE.MEAL, result.cardData);
        break;
      case C.MSG_TYPE.ONBOARDING:
        this.addAIMessage(result.content, C.MSG_TYPE.TEXT);
        this.syncWeeklyPlan();
        break;
      default:
        this.addAIMessage(result.content, C.MSG_TYPE.TEXT);
        if (this.data.convState === C.CONV_STATE.ONBOARDING) {
          this.setData({ convState: C.CONV_STATE.READY, showQuickActions: true });
        }
        this.syncWeeklyPlan();
    }
  },

  // 从云端拉取最新计划并缓存到本地
  async syncWeeklyPlan() {
    try {
      const res = await api.callCloudFunction('aiChat', { action: 'get_weekly_plan' });
      if (res && res.plan && res.plan.days) {
        wx.setStorageSync('weeklyPlan', JSON.stringify(res.plan));
      }
    } catch (e) {
      // 云端不可用时，检查本地是否已有
    }
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
