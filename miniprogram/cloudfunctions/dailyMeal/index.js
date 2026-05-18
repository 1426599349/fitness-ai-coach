const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 内联：饮食生成逻辑（避免跨函数require）
const foods = require('./foods.json');

function calcMetrics(h, w, age, gender, goal) {
  const bmi = w / Math.pow(h / 100, 2);
  let bmr = gender === 'male' ? 10 * w + 6.25 * h - 5 * age + 5 : 10 * w + 6.25 * h - 5 * age - 161;
  const tdee = Math.round(bmr * 1.55);
  const intake = goal === 'fat_loss' ? tdee - 400 : goal === 'muscle_gain' ? tdee + 250 : tdee;
  return { intake, bmi, tdee, bmr };
}

function pickStaple(exclude) {
  const pool = foods.staples.filter(s => !(exclude || []).includes(s.name));
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : foods.staples[0];
}

function genMeal(targetKcal, allergies, staple) {
  const ok = (arr) => arr.filter(i => !(allergies || []).some(a => i.name.includes(a)));
  const mains = ok(foods.mainDishes), sides = ok(foods.sideDishes);
  for (let a = 0; a < 20; a++) {
    const md = mains[Math.floor(Math.random() * mains.length)];
    const n = Math.random() < 0.5 ? 1 : 2;
    const sp = [...sides].sort(() => Math.random() - 0.5).slice(0, n);
    const sg = [150, 180, 200][a % 3], mg = [100, 120, 150][a % 3];
    const se = (staple.kcal_per_100g || 130) * sg / 100;
    const me = md.kcal_per_100g * mg / 100;
    let ste = 0; const si = [];
    for (const s of sp) {
      const g = [100, 120, 150][(a + sp.indexOf(s)) % 3];
      ste += s.kcal_per_100g * g / 100;
      si.push({ name: s.name, grams: g, kcal: Math.round(s.kcal_per_100g * g / 100 * 10) / 10 });
    }
    const tk = se + me + ste;
    if (tk >= targetKcal * 0.33 && tk <= targetKcal * 0.5) {
      let p = (staple.protein_g || 3) * sg / 100 + md.protein_g * mg / 100;
      let f = (staple.fat_g || 1) * sg / 100 + md.fat_g * mg / 100;
      let c = (staple.carb_g || 25) * sg / 100 + (md.carb_g || 0) * mg / 100;
      for (const s of sp) {
        const g = si[sp.indexOf(s)].grams;
        p += s.protein_g * g / 100; f += s.fat_g * g / 100; c += (s.carb_g || 0) * g / 100;
      }
      return {
        main_staple: staple.name + ' ' + sg + 'g',
        dishes: [{ name: md.name, grams: mg, kcal: Math.round(me * 10) / 10 }, ...si],
        total_kcal: Math.round(tk * 10) / 10,
        protein_g: Math.round(p * 10) / 10, fat_g: Math.round(f * 10) / 10, carb_g: Math.round(c * 10) / 10,
      };
    }
  }
  return { error: '生成失败，请重试' };
}

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID;
  const { action } = event;
  const today = new Date().toISOString().slice(0, 10);

  let profile, metrics;
  try {
    const r = await db.collection('user_states').doc(openid).get();
    profile = r.data.profile;
    metrics = calcMetrics(profile.height_cm, profile.weight_kg, profile.age, profile.gender, profile.fitness_goal);
  } catch (e) { return { success: false, error: '请先录入身体数据' }; }

  if (action === 'regenerate') {
    const staple = pickStaple([profile.lastStaple]);
    const meal = genMeal(metrics.intake, profile.allergies, staple);
    if (!meal.error) {
      await db.collection('meal_logs').add({ data: { openid, date: today, mealData: meal, createdAt: new Date() } });
      await db.collection('user_states').doc(openid).update({ data: { lastStaple: staple.name } });
    }
    return { success: true, type: 'meal-card', cardData: meal };
  }

  // get
  const exist = await db.collection('meal_logs').where({ openid, date: today }).orderBy('createdAt', 'desc').limit(1).get();
  if (exist.data.length > 0) return { success: true, type: 'meal-card', cardData: exist.data[0].mealData };

  const staple = pickStaple([]);
  const meal = genMeal(metrics.intake, profile.allergies, staple);
  if (!meal.error) {
    await db.collection('meal_logs').add({ data: { openid, date: today, mealData: meal, createdAt: new Date() } });
    await db.collection('user_states').doc(openid).update({ data: { lastStaple: staple.name } });
  }
  return { success: true, type: 'meal-card', cardData: meal };
};
