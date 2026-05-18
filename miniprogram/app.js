/**
 * 健身AI个性化健康助手 — 小程序入口
 */
App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    wx.cloud.init({
      env: 'cloud1-d9gotndz2f992ac32',
      traceUser: true,
    });

    this.doLogin();
  },

  doLogin: function () {
    wx.cloud.callFunction({
      name: 'userInit',
      data: { action: 'login' },
      success: (res) => {
        this.globalData.openid = res.result.openid;
        this.globalData.isLoggedIn = true;
        this.globalData.cloudReady = true;
        if (res.result.isNewUser) {
          this.globalData.isNewUser = true;
        } else {
          this.globalData.isNewUser = false;
          this.globalData.userProfile = res.result.profile;
        }
      },
      fail: (err) => {
        console.warn('云函数未部署，使用离线模式');
        this.globalData.isLoggedIn = false;
        this.globalData.cloudReady = false;
      },
    });
  },

  globalData: {
    openid: null,
    isLoggedIn: false,
    isNewUser: true,
    cloudReady: false,
    userProfile: null,
    credits: 200,
    conversationState: 'greeting',
    adUnitId: '', // 激励视频广告位ID，申请后填入。留空则用模拟模式
  },
});
