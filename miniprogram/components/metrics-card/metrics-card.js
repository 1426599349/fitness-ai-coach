Component({
  properties: {
    data: {
      type: Object,
      value: {},
    },
  },

  observers: {
    'data' (data) {
      if (!data || !data.bmi) return;

      // BMI 颜色和等级
      const bmi = data.bmi;
      let bmiColor = '#00d4aa';
      let bmiLevel = '标准';
      if (bmi < 18.5) { bmiColor = '#f39c12'; bmiLevel = '偏瘦'; }
      else if (bmi >= 24 && bmi < 28) { bmiColor = '#f39c12'; bmiLevel = '偏胖'; }
      else if (bmi >= 28) { bmiColor = '#e74c3c'; bmiLevel = '超重'; }

      // 宏量营养素比例
      const totalCal = (data.protein_g || 0) * 4 + (data.fat_g || 0) * 9 + (data.carb_g || 0) * 4;
      const proteinPercent = totalCal > 0 ? ((data.protein_g || 0) * 4 / totalCal * 100).toFixed(0) : 0;
      const fatPercent = totalCal > 0 ? ((data.fat_g || 0) * 9 / totalCal * 100).toFixed(0) : 0;
      const carbPercent = totalCal > 0 ? ((data.carb_g || 0) * 4 / totalCal * 100).toFixed(0) : 0;

      this.setData({ bmiColor, bmiLevel, proteinPercent, fatPercent, carbPercent });
    },
  },
});
