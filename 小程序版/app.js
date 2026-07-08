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

    // 恢复本地授权状态
    this.restoreAuthState();
    // 云端登录
    this.doLogin();
  },

  /**
   * 从本地缓存恢复授权状态
   */
  restoreAuthState: function () {
    try {
      const nickname = wx.getStorageSync('userNickname');
      const avatarUrl = wx.getStorageSync('userAvatarUrl');
      if (nickname) {
        this.globalData.nickname = nickname;
        this.globalData.avatarUrl = avatarUrl || '';
        this.globalData.isAuthorized = true;
      }
    } catch (e) {}
  },

  doLogin: function () {
    // 通过云函数获取 openid（云开发自动使用 wx.login code）
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
          // 同步云端头像昵称到本地
          if (res.result.nickname) {
            this.globalData.nickname = res.result.nickname;
            this.globalData.avatarUrl = res.result.avatarUrl || '';
            this.globalData.isAuthorized = true;
            wx.setStorageSync('userNickname', res.result.nickname);
            wx.setStorageSync('userAvatarUrl', res.result.avatarUrl || '');
          }
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

    // —— 用户身份 ——
    isAuthorized: false,   // 是否已完成授权（选头像+昵称）
    nickname: '',           // 微信昵称
    avatarUrl: '',          // 头像云存储 fileID
  },
});
