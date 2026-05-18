/**
 * 每日饮食搭配 Skill（Node.js版）
 */
const foods = require('../data/foods.json');

function filterByAllergies(items, allergies) {
  if (!allergies || allergies.length === 0) return items;
  return items.filter(item => {
    return !allergies.some(a => item.name.includes(a));
  });
}

function generateMeal(targetKcal, allergies, staple) {
  const availableMains = filterByAllergies(foods.mainDishes, allergies);
  const availableSides = filterByAllergies(foods.sideDishes, allergies);

  if (availableMains.length === 0) return { error: '没有可用的主菜（忌口过滤后为空）' };
  if (availableSides.length === 0) return { error: '没有可用的配菜（忌口过滤后为空）' };

  const kcalLower = targetKcal * 0.33;
  const kcalUpper = targetKcal * 0.50;

  for (let attempt = 0; attempt < 20; attempt++) {
    const mainDish = availableMains[Math.floor(Math.random() * availableMains.length)];
    const numSides = Math.random() < 0.5 ? 1 : 2;
    const sidePicks = [];
    const sidePool = [...availableSides];
    for (let i = 0; i < numSides && sidePool.length > 0; i++) {
      const idx = Math.floor(Math.random() * sidePool.length);
      sidePicks.push(sidePool.splice(idx, 1)[0]);
    }

    const stapleKcal = staple.kcal_per_100g || 130;
    const stapleGrams = [150, 180, 200][Math.floor(Math.random() * 3)];
    const stapleEnergy = stapleKcal * stapleGrams / 100;

    const mainGrams = [100, 120, 150][Math.floor(Math.random() * 3)];
    const mainEnergy = mainDish.kcal_per_100g * mainGrams / 100;

    let sideTotalEnergy = 0;
    const sideItems = [];
    for (const s of sidePicks) {
      const sg = [100, 120, 150][Math.floor(Math.random() * 3)];
      const se = s.kcal_per_100g * sg / 100;
      sideTotalEnergy += se;
      sideItems.push({
        name: s.name, grams: sg,
        kcal: Math.round(s.kcal_per_100g * sg / 100 * 10) / 10,
      });
    }

    const totalKcal = stapleEnergy + mainEnergy + sideTotalEnergy;

    if (totalKcal >= kcalLower && totalKcal <= kcalUpper) {
      let totalProtein = (staple.protein_g || 3) * stapleGrams / 100;
      totalProtein += mainDish.protein_g * mainGrams / 100;
      let totalFat = (staple.fat_g || 1) * stapleGrams / 100;
      totalFat += mainDish.fat_g * mainGrams / 100;
      let totalCarb = (staple.carb_g || 25) * stapleGrams / 100;
      totalCarb += (mainDish.carb_g || 0) * mainGrams / 100;

      for (const si of sideItems) {
        const s = sidePicks[sideItems.indexOf(si)];
        totalProtein += s.protein_g * si.grams / 100;
        totalFat += s.fat_g * si.grams / 100;
        totalCarb += (s.carb_g || 0) * si.grams / 100;
      }

      const dishes = [
        { name: mainDish.name, grams: mainGrams, kcal: Math.round(mainEnergy * 10) / 10 },
        ...sideItems,
      ];

      return {
        main_staple: `${staple.name} ${stapleGrams}g`,
        dishes,
        total_kcal: Math.round(totalKcal * 10) / 10,
        protein_g: Math.round(totalProtein * 10) / 10,
        fat_g: Math.round(totalFat * 10) / 10,
        carb_g: Math.round(totalCarb * 10) / 10,
      };
    }
  }

  return { error: '无法在热量范围内生成饮食，请调整目标热量' };
}

module.exports = { generateMeal, filterByAllergies };
