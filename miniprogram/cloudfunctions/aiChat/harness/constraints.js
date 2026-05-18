/**
 * Harness 硬约束规则常量（Node.js版）
 */

// 数据范围
const HEIGHT_MIN = 50;
const HEIGHT_MAX = 250;
const WEIGHT_MIN = 20;
const WEIGHT_MAX = 300;
const AGE_MIN = 10;
const AGE_MAX = 120;

// 训练强度上限（按体能等级）
const INTENSITY_LIMITS = {
  beginner:  { maxMinutes: 25, maxExercises: 6, maxSets: 3, maxReps: 12, maxWeightKg: 0 },
  intermediate: { maxMinutes: 40, maxExercises: 8, maxSets: 4, maxReps: 15, maxWeightKg: 20 },
  advanced:  { maxMinutes: 60, maxExercises: 10, maxSets: 5, maxReps: 20, maxWeightKg: 100 },
};

// 高危动作黑名单（绝对禁止）
const BANNED_EXERCISES = [
  '颈后推举', '颈后下拉', '早安式体前屈', '断头台卧推',
  '直立划船', '仰卧起坐（抱头式）', '腿部伸展机（锁定膝盖）',
];

// 医疗敏感词黑名单
const MEDICAL_KEYWORDS = [
  '治疗', '治愈', '康复', '诊断', '处方', '药物', '药品',
  '疾病', '病症', '病理', '疗程', '疗效', '药方', '中药',
  '西药', '手术', '术后', '术前', '化疗', '放疗',
];

const MEDICAL_REJECT_MSG = '您好，我是健身饮食助手，不提供医疗建议。如有健康问题，请咨询专业医生。';

// 体重变化阈值
const WEIGHT_CHANGE_THRESHOLD = 2.0; // %

// 饮食热量区间
const MEAL_KCAL_MIN_RATIO = 0.33;
const MEAL_KCAL_MAX_RATIO = 0.50;

module.exports = {
  HEIGHT_MIN, HEIGHT_MAX, WEIGHT_MIN, WEIGHT_MAX, AGE_MIN, AGE_MAX,
  INTENSITY_LIMITS, BANNED_EXERCISES, MEDICAL_KEYWORDS, MEDICAL_REJECT_MSG,
  WEIGHT_CHANGE_THRESHOLD, MEAL_KCAL_MIN_RATIO, MEAL_KCAL_MAX_RATIO,
};
