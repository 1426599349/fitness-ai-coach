Page({
  data: { food: null },

  onLoad(options) {
    if (options.data) {
      try {
        const food = JSON.parse(decodeURIComponent(options.data));
        // 计算宏量营养素占比
        const totalCal = food.protein * 4 + food.fat * 9 + food.carb * 4;
        food.proteinPct = Math.round(food.protein * 4 / totalCal * 100);
        food.fatPct = Math.round(food.fat * 9 / totalCal * 100);
        food.carbPct = Math.round(food.carb * 4 / totalCal * 100);
        this.setData({ food });
      } catch (e) {}
    }
  },
});
