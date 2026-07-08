/**
 * 授权登录页 — 微信个人开发者合规方案
 * 使用 <button open-type="chooseAvatar"> + <input type="nickname">
 * 不依赖已废弃的 wx.getUserProfile
 */
const app = getApp();

Page({
  data: {
    avatarUrl: '',     // 当前选中的头像临时路径
    nickname: '',       // 当前输入的昵称
    hasAvatar: false,
    hasNickname: false,
    submitting: false,
  },

  onLoad() {
    // 如果已授权，直接跳走
    if (app.globalData.isAuthorized) {
      this.goToApp();
    }
  },

  /**
   * 选择头像 — WeChat 官方组件回调
   */
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    this.setData({ avatarUrl, hasAvatar: true });
  },

  /**
   * 输入昵称
   */
  onNicknameInput(e) {
    const nickname = e.detail.value;
    this.setData({ nickname, hasNickname: !!nickname });
  },

  onNicknameBlur(e) {
    const nickname = e.detail.value;
    this.setData({ nickname, hasNickname: !!nickname });
  },

  /**
   * 确认授权
   */
  async onConfirm() {
    if (this.data.submitting) return;

    // 昵称必填
    let nickname = (this.data.nickname || '').trim();
    if (!nickname) {
      nickname = '健身爱好者';
      this.setData({ nickname, hasNickname: true });
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '授权中...', mask: true });

    try {
      let finalAvatarUrl = '';

      // 有头像 → 上传到云存储
      if (this.data.hasAvatar && this.data.avatarUrl) {
        try {
          finalAvatarUrl = await this.uploadAvatar(this.data.avatarUrl);
        } catch (e) {
          console.warn('头像上传失败，继续授权', e);
        }
      }

      // 保存到本地
      wx.setStorageSync('userNickname', nickname);
      wx.setStorageSync('userAvatarUrl', finalAvatarUrl);

      // 同步到 globalData
      app.globalData.nickname = nickname;
      app.globalData.avatarUrl = finalAvatarUrl;
      app.globalData.isAuthorized = true;

      // 云端同步
      if (app.globalData.cloudReady) {
        try {
          await wx.cloud.callFunction({
            name: 'userInit',
            data: {
              action: 'saveIdentity',
              nickname,
              avatarUrl: finalAvatarUrl,
            },
          });
        } catch (e) {
          console.warn('云端同步昵称失败（离线模式不影响使用）', e);
        }
      }

      wx.hideLoading();
      wx.showToast({ title: '授权成功', icon: 'success', duration: 1000 });

      setTimeout(() => this.goToApp(), 800);

    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '授权失败，请重试', icon: 'none' });
    }
  },

  /**
   * 上传头像到云存储，返回 fileID
   */
  uploadAvatar(tempPath) {
    return new Promise((resolve, reject) => {
      const cloudPath = `avatars/${app.globalData.openid || 'unknown'}_${Date.now()}.png`;
      wx.cloud.uploadFile({
        cloudPath,
        filePath: tempPath,
        success: (res) => resolve(res.fileID),
        fail: reject,
      });
    });
  },

  /**
   * 跳过授权 — 使用默认身份
   */
  onSkip() {
    const nickname = '健身爱好者';
    wx.setStorageSync('userNickname', nickname);
    wx.setStorageSync('userAvatarUrl', '');
    app.globalData.nickname = nickname;
    app.globalData.avatarUrl = '';
    app.globalData.isAuthorized = true;
    this.goToApp();
  },

  /**
   * 进入 App
   */
  goToApp() {
    wx.switchTab({ url: '/pages/chat/chat' });
  },
});
