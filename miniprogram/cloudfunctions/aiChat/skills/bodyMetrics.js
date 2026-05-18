/**
 * 身体指标测算 Skill（Node.js版）
 */
function calculateMetrics(heightCm, weightKg, age, gender, fitnessGoal, activityLevel) {
  const bmi = weightKg / Math.pow(heightCm / 100, 2);

  let bmr;
  if (gender === 'male') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  } else {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  }

  const activityFactors = {
    sedentary: 1.2, light: 1.375, moderate: 1.55,
    active: 1.725, very_active: 1.9,
  };
  const tdee = bmr * (activityFactors[activityLevel] || 1.55);

  let recommended;
  if (fitnessGoal === 'fat_loss') {
    recommended = tdee - 400;
  } else if (fitnessGoal === 'muscle_gain') {
    recommended = tdee + 250;
  } else {
    recommended = tdee;
  }

  const protein = Math.round(weightKg * 1.6);
  const fat = Math.round(recommended * 0.25 / 9);
  const carb = Math.round((recommended - protein * 4 - fat * 9) / 4);

  return {
    bmi: Math.round(bmi * 10) / 10,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    recommended_intake: Math.round(recommended),
    protein_g: protein,
    fat_g: fat,
    carb_g: carb,
  };
}

module.exports = { calculateMetrics };
