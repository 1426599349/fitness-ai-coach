Page({
  data: { ex: null },

  onLoad(options) {
    if (options.data) {
      try {
        const ex = JSON.parse(decodeURIComponent(options.data));
        const COLORS = { '胸':'#e74c3c','背':'#3498db','腿':'#2ecc71','臀':'#27ae60','小腿':'#1abc9c','肩':'#f39c12','斜方肌':'#e67e22','臂':'#9b59b6','二头':'#8e44ad','三头':'#c0392b','腹':'#d35400','核心':'#16a085','有氧':'#00bcd4','热身':'#95a5a6','拉伸':'#7f8c8d','功能性':'#2c3e50','颈':'#bdc3c7' };
        const EMOJI = { '胸':'💪','背':'🔙','腿':'🦵','臀':'🍑','小腿':'🦿','肩':'🏋️','斜方肌':'💪','臂':'💪','二头':'💪','三头':'💪','腹':'🧘','核心':'🎯','有氧':'🏃','热身':'🔥','拉伸':'🧘','功能性':'⚡','颈':'🙆' };
        ex.color = COLORS[ex.muscle] || '#888';
        ex.emoji = EMOJI[ex.muscle] || '🏋️';
        this.setData({ ex });
      } catch (e) {}
    }
  },

  onPreviewImage() {
    if (this.data.ex && this.data.ex.image) {
      wx.previewImage({ urls: [this.data.ex.image], current: this.data.ex.image });
    }
  },
});
