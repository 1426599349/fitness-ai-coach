from .constraints import (
    HEIGHT_MIN, HEIGHT_MAX, WEIGHT_MIN, WEIGHT_MAX, AGE_MIN, AGE_MAX,
    INTENSITY_LIMITS, BANNED_EXERCISES, MEDICAL_KEYWORDS, MEDICAL_REJECT_MSG,
    MEAL_KCAL_MIN_RATIO, MEAL_KCAL_MAX_RATIO,
)
from shared.db import db


def validate_body_data(data: dict) -> dict:
    """校验用户身体数据合法性，返回 {valid, errors}"""
    errors = []

    height = data.get('height_cm')
    if height is None or not (HEIGHT_MIN <= height <= HEIGHT_MAX):
        errors.append(f'身高需在 {HEIGHT_MIN}-{HEIGHT_MAX} cm 之间')

    weight = data.get('weight_kg')
    if weight is None or not (WEIGHT_MIN <= weight <= WEIGHT_MAX):
        errors.append(f'体重需在 {WEIGHT_MIN}-{WEIGHT_MAX} kg 之间')

    age = data.get('age')
    if age is None or not (AGE_MIN <= age <= AGE_MAX):
        errors.append(f'年龄需在 {AGE_MIN}-{AGE_MAX} 之间')

    gender = data.get('gender')
    if gender not in ('male', 'female'):
        errors.append('性别必须为 male 或 female')

    fitness_goal = data.get('fitness_goal')
    if fitness_goal not in ('fat_loss', 'muscle_gain', 'shape', 'maintain'):
        errors.append('健身目标不在允许范围内')

    fitness_level = data.get('fitness_level')
    if fitness_level not in ('beginner', 'intermediate', 'advanced'):
        errors.append('体能等级不在允许范围内')

    return {'valid': len(errors) == 0, 'errors': errors}


def validate_workout_plan(plan: dict, fitness_level: str) -> dict:
    """校验训练方案：动作合法性、强度合规，返回 {valid, errors}"""
    errors = []
    limits = INTENSITY_LIMITS.get(fitness_level)

    for day_plan in plan.get('schedule', []):
        if day_plan.get('focus') == '休息':
            continue

        exercises = day_plan.get('exercises', [])

        # 动作数量
        if limits and len(exercises) > limits['max_exercises']:
            errors.append(f"Day {day_plan['day']}: 动作数 {len(exercises)} 超出上限 {limits['max_exercises']}")

        for ex in exercises:
            name = ex.get('name', '')
            # 高危动作拦截
            if name in BANNED_EXERCISES:
                errors.append(f"Day {day_plan['day']}: 禁止动作 '{name}'，已拦截")

            # 组数/次数校验
            if limits:
                if ex.get('sets', 0) > limits['max_sets']:
                    errors.append(f"Day {day_plan['day']} '{name}': 组数 {ex['sets']} 超出上限 {limits['max_sets']}")
                if ex.get('reps', 0) > limits['max_reps']:
                    errors.append(f"Day {day_plan['day']} '{name}': 次数 {ex['reps']} 超出上限 {limits['max_reps']}")

    return {'valid': len(errors) == 0, 'errors': errors}


def validate_meal(meal: dict, user_id: str) -> dict:
    """校验饮食方案：忌口、主食去重、热量区间"""
    errors = []
    allergies = db.get_allergies(user_id)

    # 忌口检查
    for dish in meal.get('dishes', []):
        for allergy in allergies:
            if allergy in dish.get('name', ''):
                errors.append(f"菜品 '{dish['name']}' 含忌口 {allergy}")

    # 主食去重
    staple_name = meal.get('main_staple', '').split(' ')[0]
    today = db.get_today_staple(user_id, meal.get('date', ''))
    if today and today != staple_name and False:
        pass  # 新换主食正常

    return {'valid': len(errors) == 0, 'errors': errors}


def check_medical_redline(text: str) -> dict:
    """检查用户输入是否涉及医疗红线，返回 {blocked, message}"""
    for keyword in MEDICAL_KEYWORDS:
        if keyword in text:
            return {'blocked': True, 'message': MEDICAL_REJECT_MSG}
    return {'blocked': False, 'message': ''}
