const { EXERCISES } = require('./exercise-data.js');

Page({
  data: {
    exercises: EXERCISES.map(e => ({ ...e, color: '#888' })),
    filter: 'all',
    place: 'all',
    search: '',
    groups: ['全部','胸','背','腿','臀','小腿','肩','斜方肌','臂','二头','三头','腹','核心','有氧','热身','拉伸','功能性','颈'],
  },

  onFilter(e) {
    const f = e.currentTarget.dataset.filter;
    this._apply(f, this.data.place, this.data.search);
    this.setData({ filter: f });
  },

  onPlaceToggle() {
    const p = this.data.place === 'all' ? 'home' : this.data.place === 'home' ? 'gym' : 'all';
    const labels = { all: '全部', home: '🏠 居家', gym: '🏋️ 健身房' };
    wx.showToast({ title: labels[p], icon: 'none' });
    this._apply(this.data.filter, p, this.data.search);
    this.setData({ place: p });
  },

  onSearch(e) {
    const v = e.detail.value.trim();
    this._apply(this.data.filter, this.data.place, v);
    this.setData({ search: v });
  },

  _apply(filter, place, search) {
    const COLORS = {
      '胸':'#e74c3c','背':'#3498db','腿':'#2ecc71','臀':'#27ae60',
      '小腿':'#1abc9c','肩':'#f39c12','斜方肌':'#e67e22','臂':'#9b59b6',
      '二头':'#8e44ad','三头':'#c0392b','腹':'#d35400','核心':'#16a085',
      '有氧':'#00bcd4','热身':'#95a5a6','拉伸':'#7f8c8d','功能性':'#2c3e50','颈':'#bdc3c7',
    };
    let list = EXERCISES;
    if (filter !== 'all' && filter !== '全部') list = list.filter(e => e.muscle === filter);
    if (place !== 'all') list = list.filter(e => e.place === place);
    if (search) list = list.filter(e => e.name.includes(search));
    list = list.map(e => ({ ...e, color: COLORS[e.muscle] || '#888' }));
    this.setData({ exercises: list });
  },

  onShow() {
    this._apply(this.data.filter, this.data.place, this.data.search);
  },

  onCardTap(e) {
    const { index } = e.currentTarget.dataset;
    const ex = this.data.exercises[index];
    wx.navigateTo({
      url: '/pages/exercise-detail/exercise-detail?data=' + encodeURIComponent(JSON.stringify(ex)),
    });
  },
});
