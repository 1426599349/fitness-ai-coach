Page({
  data: { fadeOut: false },
  _startY: 0,

  onLoad() {
    // 如果已经看过封面，直接进入
    if (wx.getStorageSync('splashShown')) {
      this.enterApp();
    }
  },

  onTouchStart(e) {
    this._startY = e.touches[0].clientY;
  },

  onTouchEnd(e) {
    const dy = this._startY - e.changedTouches[0].clientY;
    if (dy > 60) {
      this.enterApp();
    }
  },

  enterApp() {
    if (this._entered) return;
    this._entered = true;
    this.setData({ fadeOut: true });
    wx.setStorageSync('splashShown', true);

    setTimeout(() => {
      wx.switchTab({ url: '/pages/chat/chat' });
    }, 350);
  },
});
