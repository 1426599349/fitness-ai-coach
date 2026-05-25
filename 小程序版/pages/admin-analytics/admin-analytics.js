/**
 * 数据看板（隐藏页，需密码访问）
 * 从云数据库 analytics 集合实时查询
 */
const api = require('../../utils/api.js');

Page({
  data: {
    loading: true,
    error: '',
    totalUsers: 0,
    todaySignin: 0,
    todayActive: 0,
    plansGenerated: 0,
    plansUpdated: 0,
    mealsGenerated: 0,
    exercisesDone: 0,
    signupByDay: [],
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await api.callCloudFunction('userInit', { action: 'getAnalytics' });
      if (res && res.success) {
        const signups = res.signupByDay || [];
        const maxSignup = Math.max(1, ...signups.map(s => s.count));
        this.setData({
          loading: false,
          totalUsers: res.totalUsers || 0,
          todaySignin: res.todaySignin || 0,
          todayActive: res.todayActive || 0,
          plansGenerated: res.plansGenerated || 0,
          plansUpdated: res.plansUpdated || 0,
          mealsGenerated: res.mealsGenerated || 0,
          exercisesDone: res.exercisesDone || 0,
          signupByDay: signups,
          maxSignup: maxSignup,
        });
      } else {
        this.setData({ loading: false, error: '暂无数据' });
      }
    } catch (e) {
      this.setData({ loading: false, error: '查询失败，请确认已部署云函数并创建 analytics 集合' });
    }
  },
});
