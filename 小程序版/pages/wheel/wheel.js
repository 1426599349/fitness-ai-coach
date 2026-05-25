const api = require('../../utils/api.js');

Page({
  data: {
    showWheel: false,
    mealDetail0: null, mealDetail1: null, mealDetail2: null,
    todayUsed: false,
  },

  onShow() {
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = wx.getStorageSync('lastWheelDate') || '';
    if (lastDate === today) {
      this.setData({
        todayUsed: true,
        mealDetail0: wx.getStorageSync('mealDetail_0') || null,
        mealDetail1: wx.getStorageSync('mealDetail_1') || null,
        mealDetail2: wx.getStorageSync('mealDetail_2') || null,
      });
    }
  },

  async onStart(e) {
    const isRetry = !!(e && e.currentTarget && e.currentTarget.dataset.retry);
    const app = getApp();
    const credits = app.globalData.credits || 200;
    if (credits < 10) { wx.showToast({ title: '积分不足', icon: 'none' }); return; }
    app.globalData.credits = credits - 10;

    const t0 = Date.now();
    this.setData({ showWheel: true, mealDetail0: null, mealDetail1: null, mealDetail2: null });
    const today = new Date().toISOString().slice(0, 10);

    // 等 API（最多 10 秒）
    const apiPromise = api.getDailyMeals(isRetry).catch(() => null);
    const apiTimeout = new Promise(r => setTimeout(() => r(null), 10000));
    const apiResult = await Promise.race([apiPromise, apiTimeout]);

    // 确保转盘至少展示 5.5 秒
    const elapsed = Date.now() - t0;
    if (elapsed < 5500) await new Promise(r => setTimeout(r, 5500 - elapsed));

    const details = (apiResult && apiResult.details) ? apiResult.details : {};
    const update = { showWheel: false, todayUsed: true,
      mealDetail0: null, mealDetail1: null, mealDetail2: null };

    ['breakfast','lunch','dinner'].forEach((k, i) => {
      if (details[k]) {
        update['mealDetail' + i] = details[k];
        wx.setStorageSync('mealDetail_' + i, details[k]);
      }
    });
    wx.setStorageSync('lastWheelDate', today);
    this.setData(update);

    if (apiResult && apiResult.needProfile) {
      wx.showModal({
        title: '请先录入数据',
        content: apiResult.message,
        confirmText: '去录入',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/chat/chat' });
        },
      });
      return;
    }

    if (!details.breakfast) {
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  },
});
