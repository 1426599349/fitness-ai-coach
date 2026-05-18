/**
 * Harness 校验器（Node.js版）
 */
const C = require('./constraints.js');

/**
 * 校验身体数据
 */
function validateBodyData(data) {
  const errors = [];
  if (!data.height_cm || data.height_cm < C.HEIGHT_MIN || data.height_cm > C.HEIGHT_MAX) {
    errors.push(`身高需在 ${C.HEIGHT_MIN}-${C.HEIGHT_MAX} cm 之间`);
  }
  if (!data.weight_kg || data.weight_kg < C.WEIGHT_MIN || data.weight_kg > C.WEIGHT_MAX) {
    errors.push(`体重需在 ${C.WEIGHT_MIN}-${C.WEIGHT_MAX} kg 之间`);
  }
  if (!data.age || data.age < C.AGE_MIN || data.age > C.AGE_MAX) {
    errors.push(`年龄需在 ${C.AGE_MIN}-${C.AGE_MAX} 之间`);
  }
  if (!['male', 'female'].includes(data.gender)) {
    errors.push('性别必须为 male 或 female');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 校验训练方案
 */
function validateWorkoutPlan(plan, fitnessLevel) {
  const errors = [];
  const limits = C.INTENSITY_LIMITS[fitnessLevel];
  if (!limits) return { valid: true, errors: [] };

  for (const day of (plan.schedule || [])) {
    if (day.focus === '休息') continue;
    const exercises = day.exercises || [];

    if (exercises.length > limits.maxExercises) {
      errors.push(`Day ${day.day}: 动作数 ${exercises.length} 超出上限 ${limits.maxExercises}`);
    }
    for (const ex of exercises) {
      if (C.BANNED_EXERCISES.includes(ex.name)) {
        errors.push(`Day ${day.day}: 禁止动作 '${ex.name}'，已拦截`);
      }
      if (ex.sets > limits.maxSets) {
        errors.push(`Day ${day.day} '${ex.name}': 组数 ${ex.sets} 超出 ${limits.maxSets}`);
      }
      if (ex.reps > limits.maxReps) {
        errors.push(`Day ${day.day} '${ex.name}': 次数 ${ex.reps} 超出 ${limits.maxReps}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 医疗红线检查
 */
function checkMedicalRedline(text) {
  for (const kw of C.MEDICAL_KEYWORDS) {
    if (text.includes(kw)) {
      return { blocked: true, message: C.MEDICAL_REJECT_MSG };
    }
  }
  return { blocked: false };
}

/**
 * 饮食校验
 */
function validateMeal(meal, allergies) {
  const errors = [];
  for (const dish of (meal.dishes || [])) {
    for (const allergy of (allergies || [])) {
      if (dish.name.includes(allergy)) {
        errors.push(`菜品 '${dish.name}' 含忌口 ${allergy}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateBodyData, validateWorkoutPlan, checkMedicalRedline, validateMeal };
