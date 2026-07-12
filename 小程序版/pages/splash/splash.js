Page({
  data: { fadeOut: false },
  _startY: 0,

  onLoad() {
    console.log('===== 新版splash加载成功: 视频背景模式 =====');
    if (wx.getStorageSync('splashShown')) {
      this.enterApp();
    }
  },

  onTouchStart(e) { this._startY = e.touches[0].clientY; },

  onTouchEnd(e) {
    if (this._startY - e.changedTouches[0].clientY > 60) {
      this.enterApp();
    }
  },

  enterApp() {
    if (this._entered) return;
    this._entered = true;
    wx.setStorageSync('splashShown', true);
    wx.switchTab({ url: '/pages/chat/chat' });
  },
});
