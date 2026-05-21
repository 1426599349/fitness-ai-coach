const { FOODS } = require('./food-data.js');

Page({
  data: {
    foods: FOODS,
    filter: '全部',
    categories: ['全部', '主食', '主菜', '配菜'],
  },

  onFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({
      filter,
      foods: filter === '全部' ? FOODS : FOODS.filter(f => f.category === filter),
    });
  },

  onCardTap(e) {
    const index = e.currentTarget.dataset.index;
    const food = this.data.foods[index];
    wx.navigateTo({
      url: '/pages/food-detail/food-detail?data=' + encodeURIComponent(JSON.stringify(food)),
    });
  },
});
