Component({
  properties: {
    visible: { type: Boolean, value: false },
  },

  data: { spinning: false },

  observers: {
    'visible' (visible) {
      if (visible) {
        setTimeout(() => this.initAndSpin(), 300);
      } else {
        this._stop();
      }
    },
  },

  methods: {
    initAndSpin() {
      const query = this.createSelectorQuery();
      query.select('#wheelCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          setTimeout(() => this.initAndSpin(), 200);
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const w = res[0].width;
        const h = res[0].height;
        const dpr = wx.getWindowInfo().pixelRatio;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        this._ctx = ctx;
        this._cx = w / 2;
        this._cy = h / 2;
        this._r = w / 2 - 8;
        this._doSpin();
      });
    },

    _render(angle) {
      const ctx = this._ctx;
      const cx = this._cx, cy = this._cy, r = this._r;
      const colors = ['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6','#1abc9c','#e67e22','#e91e63','#00bcd4','#ff5722','#8bc34a','#ff9800'];
      const n = colors.length;
      const arc = (2 * Math.PI) / n;
      ctx.clearRect(0, 0, cx * 2, cy * 2);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, i * arc + angle, (i + 1) * arc + angle);
        ctx.closePath();
        ctx.fillStyle = colors[i];
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // 外圈光晕
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 6;
      ctx.stroke();
    },

    _doSpin() {
      this.setData({ spinning: true });
      this._angle = this._angle || 0;
      const rounds = 6 + Math.random() * 3;
      const target = this._angle + rounds * 2 * Math.PI;
      const start = this._angle;
      const duration = 5000;
      const t0 = Date.now();

      this._timer = setInterval(() => {
        const p = Math.min((Date.now() - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        this._angle = start + (target - start) * ease;
        this._render(this._angle);
        if (p >= 1) {
          clearInterval(this._timer);
          this._timer = null;
          this.setData({ spinning: false });
          this.triggerEvent('done');
        }
      }, 16);
    },

    _stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    preventScroll() {},
  },
});
