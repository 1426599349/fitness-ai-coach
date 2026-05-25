# ============================================================
# Harness 硬约束规则常量
# ============================================================

# 数据范围
HEIGHT_MIN = 50   # cm
HEIGHT_MAX = 250  # cm
WEIGHT_MIN = 20   # kg
WEIGHT_MAX = 300  # kg
AGE_MIN = 10
AGE_MAX = 120

# 训练强度上限（按体能等级）
INTENSITY_LIMITS = {
    'beginner': {'max_minutes': 25, 'max_exercises': 6, 'max_sets': 3, 'max_reps': 12, 'max_weight_kg': 0},
    'intermediate': {'max_minutes': 40, 'max_exercises': 8, 'max_sets': 4, 'max_reps': 15, 'max_weight_kg': 20},
    'advanced': {'max_minutes': 60, 'max_exercises': 10, 'max_sets': 5, 'max_reps': 20, 'max_weight_kg': 100},
}

# 高危动作黑名单（绝对禁止）
BANNED_EXERCISES = [
    '颈后推举', '颈后下拉', '早安式体前屈', '断头台卧推',
    '直立划船', '仰卧起坐（抱头式）', '腿部伸展机（锁定膝盖）',
]

# 医疗敏感词黑名单
MEDICAL_KEYWORDS = [
    '治疗', '治愈', '康复', '诊断', '处方', '药物', '药品',
    '疾病', '病症', '病理', '疗程', '疗效', '药方', '中药',
    '西药', '手术', '术后', '术前', '化疗', '放疗',
]

# 固定话术模板
MEDICAL_REJECT_MSG = '您好，我是健身饮食助手，不提供医疗建议。如有健康问题，请咨询专业医生。'

# 体重变化阈值
WEIGHT_CHANGE_THRESHOLD = 2.0  # %, 超过则触发方案更新

# 饮食热量区间
MEAL_KCAL_MIN_RATIO = 0.33  # 一餐最低占总热量比例
MEAL_KCAL_MAX_RATIO = 0.50  # 一餐最高占总热量比例
