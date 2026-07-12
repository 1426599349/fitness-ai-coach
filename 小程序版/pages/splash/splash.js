Page({
  data: { isDevTools: false },
  _startY: 0,

  onLoad() {
    // 开发者工具模拟器用海报图替代视频（视频在模拟器中无法正常播放）
    const sys = wx.getSystemInfoSync();
    this.setData({ isDevTools: sys.platform === 'devtools' });

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
