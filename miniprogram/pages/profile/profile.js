/**
 * 个人中心页面
 */
const auth = require('../../utils/auth.js');
const api = require('../../utils/api.js');

const GOAL_MAP = { fat_loss: '减脂', muscle_gain: '增肌', shape: '塑形', maintain: '维持' };
const GOAL_REVERSE = { '减脂': 'fat_loss', '增肌': 'muscle_gain', '塑形': 'shape', '维持': 'maintain' };

Page({
  data: {
    profile: null,
    metrics: null,
    weightHistory: [],
    goalLabel: '',
  },

  onShow() {
    this.loadProfile();
  },

  loadProfile() {
    const profile = auth.getUserProfile();
    if (profile) {
      this.setData({
        profile: profile,
        metrics: profile.metrics || null,
        weightHistory: this._processWeightHistory(profile.weightHistory || []),
        goalLabel: GOAL_MAP[profile.fitness_goal] || '维持',
      });
      if (profile.height_cm) this._recalcMetrics(profile);
    }

    api.callCloudFunction('userInit', { action: 'getProfile' })
      .then((res) => {
        if (res && res.profile) {
          auth.updateUserProfile(res.profile);
          const p = res.profile;
          this.setData({
            profile: p,
            metrics: res.metrics || null,
            weightHistory: this._processWeightHistory(res.weightHistory || []),
            goalLabel: GOAL_MAP[p.fitness_goal] || '维持',
          });
          if (p.height_cm) this._recalcMetrics(p);
        }
      })
      .catch(() => {});
  },

  _recalcMetrics(profile) {
    const h = profile.height_cm, w = profile.weight_kg, a = profile.age;
    const g = profile.gender, goal = profile.fitness_goal;
    const bmi = (w / ((h / 100) ** 2)).toFixed(1);
    let bmr = g === 'male' ? 10 * w + 6.25 * h - 5 * a + 5 : 10 * w + 6.25 * h - 5 * a - 161;
    const tdee = Math.round(bmr * 1.55);
    let intake = goal === 'fat_loss' ? tdee - 400 : goal === 'muscle_gain' ? tdee + 250 : tdee;
    this.setData({ metrics: { bmi: Number(bmi), bmr: Math.round(bmr), tdee, recommended_intake: intake } });
  },

  _processWeightHistory(list) {
    return list.map((item, i) => {
      const r = { ...item };
      if (i > 0) {
        const diff = r.weight_kg - list[i - 1].weight_kg;
        r.changeText = (diff >= 0 ? '+' : '') + diff.toFixed(1);
        r.changeDir = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
      } else { r.changeText = ''; r.changeDir = ''; }
      return r;
    });
  },

  // ---- 通用数字编辑 ----
  onEditField(e) {
    const { field, label } = e.currentTarget.dataset;
    const cur = this.data.profile[field];
    wx.showModal({
      title: '编辑' + label,
      editable: true,
      placeholderText: String(cur),
      success: (res) => {
        if (res.confirm && res.content) {
          const val = field === 'weight_kg' ? parseFloat(res.content) : parseInt(res.content);
          if (isNaN(val) || val <= 0) {
            wx.showToast({ title: '请输入有效数值', icon: 'none' });
            return;
          }
          this._saveField(field, val, null);
        }
      },
    });
  },

  // 性别切换
  onEditGender() {
    const cur = this.data.profile.gender;
    const newVal = cur === 'male' ? 'female' : 'male';
    this._saveField('gender', newVal, null);
  },

  // 目标选择
  onEditGoal() {
    const items = ['减脂', '增肌', '塑形', '维持'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex];
        const val = GOAL_REVERSE[label];
        this._saveField('fitness_goal', val, label);
      },
    });
  },

  // 场所切换
  onEditPlace() {
    const cur = this.data.profile.place;
    const newVal = cur === 'gym' ? 'home' : 'gym';
    this._saveField('place', newVal, null);
  },

  // ---- 保存到本地 + 云端 ----
  _saveField(field, value, goalLabel) {
    const profile = { ...this.data.profile, [field]: value };
    const app = getApp();
    app.globalData.userProfile = profile;
    this.setData({ profile });
    if (goalLabel) this.setData({ goalLabel });
    this._recalcMetrics(profile);

    // 如果体重变化>2%，触发计划重生成
    if (field === 'weight_kg') {
      const oldWeight = this.data.profile.weight_kg;
      const pct = Math.abs((value - oldWeight) / oldWeight * 100);
      if (pct > 2) {
        const newPlan = this._genLocalPlan(profile);
        wx.setStorageSync('weeklyPlan', JSON.stringify(newPlan));
        wx.showToast({ title: '体重变化超过2%，计划已更新', icon: 'none' });
      }
    }

    // 如果改的是目标或场所，也重新生成计划
    if (field === 'fitness_goal' || field === 'place') {
      const newPlan = this._genLocalPlan(profile);
      wx.setStorageSync('weeklyPlan', JSON.stringify(newPlan));
      wx.showToast({ title: '计划已同步更新', icon: 'success' });
    }

    // 云端同步
    api.callCloudFunction('userInit', { action: 'updateProfile', profile })
      .catch(() => {});

    wx.showToast({ title: '已更新', icon: 'success' });
  },

  _genLocalPlan(profile) {
    const isHome = profile.place !== 'gym';
    const chest = isHome
      ? [{ name:'俯卧撑', sets:3, reps:12, weight:0, notes:'身体成直线' },{ name:'跪姿俯卧撑', sets:3, reps:10, weight:0, notes:'膝盖着地' }]
      : [{ name:'坐姿胸推', sets:3, reps:12, weight:20, notes:'肩胛收紧' },{ name:'哑铃卧推', sets:3, reps:10, weight:12, notes:'控制离心' }];
    const back = isHome
      ? [{ name:'臀桥', sets:3, reps:15, weight:0, notes:'臀部发力' },{ name:'平板支撑', sets:3, reps:1, weight:0, notes:'收紧核心' }]
      : [{ name:'高位下拉', sets:3, reps:12, weight:25, notes:'沉肩' },{ name:'坐姿划船', sets:3, reps:12, weight:20, notes:'挺胸收腹' }];
    const legs = isHome
      ? [{ name:'深蹲', sets:3, reps:15, weight:0, notes:'膝盖不过脚尖' },{ name:'弓步蹲', sets:3, reps:12, weight:0, notes:'重心稳定' }]
      : [{ name:'器械腿举', sets:3, reps:12, weight:40, notes:'膝盖不锁死' },{ name:'杠铃深蹲', sets:3, reps:10, weight:30, notes:'脊柱中立' }];
    const core = isHome
      ? [{ name:'仰卧起坐', sets:3, reps:15, weight:0, notes:'腹部发力' },{ name:'开合跳', sets:3, reps:30, weight:0, notes:'保持节奏' }]
      : [{ name:'器械卷腹', sets:3, reps:15, weight:10, notes:'腹部发力' },{ name:'椭圆机', sets:1, reps:1, weight:0, notes:'匀速20分钟' }];
    return { days: [
      { label:'Day1',day:1,focus:'胸+三头',rest:false,exercises:chest },
      { label:'Day2',day:2,focus:'背+二头',rest:false,exercises:back },
      { label:'Day3',day:3,focus:'休息',rest:true,exercises:[] },
      { label:'Day4',day:4,focus:'腿+肩',rest:false,exercises:legs },
      { label:'Day5',day:5,focus:'核心+有氧',rest:false,exercises:core },
      { label:'Day6',day:6,focus:'休息',rest:true,exercises:[] },
      { label:'Day7',day:7,focus:'休息',rest:true,exercises:[] },
    ], startDate: new Date().toISOString().slice(0, 10) };
  },

  // ---- 保持不变 ----
  onEditAllergies() {
    wx.showModal({
      title: '编辑饮食忌口',
      editable: true,
      placeholderText: '输入忌口食材，用逗号分隔（如：海鲜,花生）',
      success: (res) => {
        if (res.confirm && res.content) {
          const allergies = res.content.split(/[,，]/).map(s => s.trim()).filter(Boolean);
          const profile = { ...this.data.profile, allergies };
          const app = getApp();
          app.globalData.userProfile = profile;
          this.setData({ profile });
          api.callCloudFunction('userInit', { action: 'updateAllergies', allergies })
            .catch(() => {});
          wx.showToast({ title: '已更新', icon: 'success' });
        }
      },
    });
  },

  onEditLikedFoods() {
    wx.showModal({
      title: '编辑喜欢食材',
      editable: true,
      placeholderText: '输入喜欢的食材，用逗号分隔（如：牛肉,番茄,豆腐）',
      success: (res) => {
        if (res.confirm && res.content) {
          const likedFoods = res.content.split(/[,，]/).map(s => s.trim()).filter(Boolean);
          const profile = { ...this.data.profile, likedFoods };
          const app = getApp();
          app.globalData.userProfile = profile;
          this.setData({ profile });
          api.callCloudFunction('userInit', { action: 'updateLikedFoods', likedFoods })
            .catch(() => {});
          wx.showToast({ title: '已更新', icon: 'success' });
        }
      },
    });
  },

  onGoWeeklyPlan() {
    wx.navigateTo({ url: '/pages/weekly-plan/weekly-plan' });
  },

  onGoPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onFeedback() {
    wx.showModal({
      title: '意见反馈',
      editable: true,
      placeholderText: '请输入您的建议或遇到的问题...',
      success: async (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          const content = res.content.trim();
          wx.showLoading({ title: '提交中...' });
          try {
            await api.submitFeedback(content);
            wx.hideLoading();
            wx.showToast({ title: '感谢反馈！', icon: 'success' });
          } catch (e) {
            wx.hideLoading();
            // 本地兜底
            const list = wx.getStorageSync('pending_feedbacks') || [];
            list.push({ content, time: new Date().toISOString() });
            wx.setStorageSync('pending_feedbacks', list);
            wx.showToast({ title: '已保存，联网后自动提交', icon: 'none' });
          }
        }
      },
    });
  },

  onClearHistory() {
    wx.showModal({
      title: '清除对话记录',
      content: '将清除所有对话记忆和聊天记录，AI会忘记之前的对话上下文。确定继续？',
      success: async (res) => {
        if (!res.confirm) return;

        // 1. 清除本地对话记忆
        try { wx.removeStorageSync('conversationHistory'); } catch (e) {}

        // 2. 重置对话状态（下次进入AI教练页会重新打招呼）
        const app = getApp();
        app.globalData.conversationState = 'greeting';

        // 3. 云端清除
        try {
          await api.callCloudFunction('aiChat', { action: 'clear_history' });
        } catch (e) {
          // 云端不可用，本地已清
        }

        wx.showToast({ title: '对话记录已清除', icon: 'success' });
      },
    });
  },
});
