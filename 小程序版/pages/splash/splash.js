Page({
  data: {},
  _startY: 0,

  onLoad() {
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
