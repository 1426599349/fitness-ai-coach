import os
import random
from datetime import date
from shared.db import db
from shared.models import Dish, MealPlan


def _load_food_library(filename: str) -> list[dict]:
    """加载饮食库文件，返回 [{name, kcal_per_100g, protein_g, fat_g, carb_g}, ...]"""
    items = []
    food_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), '饮食库')
    with open(os.path.join(food_dir, filename), encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('每100g') or line.endswith('类'):
                continue
            parts = line.split('｜')
            if len(parts) >= 5:
                items.append({
                    'name': parts[0].strip(),
                    'kcal_per_100g': float(parts[1].strip()),
                    'protein_g': float(parts[2].strip()),
                    'fat_g': float(parts[3].strip()),
                    'carb_g': float(parts[4].strip()),
                })
    return items


MAIN_DISHES = _load_food_library('主菜.txt')
SIDE_DISHES = _load_food_library('配菜.txt')


def _filter_by_allergies(items: list[dict], allergies: list[str]) -> list[dict]:
    """过滤含忌口食材的菜品"""
    if not allergies:
        return items
    result = []
    for item in items:
        blocked = False
        for allergy in allergies:
            if allergy in item['name']:
                blocked = True
                break
        if not blocked:
            result.append(item)
    return result


def _calc_dish_nutrition(item: dict, grams: int) -> dict:
    factor = grams / 100
    return {
        'name': item['name'],
        'grams': grams,
        'kcal': round(item['kcal_per_100g'] * factor, 1),
        'protein_g': round(item['protein_g'] * factor, 1),
        'fat_g': round(item['fat_g'] * factor, 1),
        'carb_g': round(item['carb_g'] * factor, 1),
    }


def generate_meal(user_id: str, target_kcal: float, staple: dict,
                  target_date: str = None) -> dict:
    """
    根据用户热量目标和忌口，生成一餐搭配。
    规则：1主食 + 1主菜(蛋白质) + 1-2配菜(蔬菜)
    总热量在 target_kcal 的 1/3~1/2 之间。
    """
    if target_date is None:
        target_date = date.today().isoformat()

    allergies = db.get_allergies(user_id)
    available_mains = _filter_by_allergies(MAIN_DISHES, allergies)
    available_sides = _filter_by_allergies(SIDE_DISHES, allergies)

    if not available_mains:
        return {'error': '没有可用的主菜（忌口过滤后为空）'}
    if not available_sides:
        return {'error': '没有可用的配菜（忌口过滤后为空）'}

    kcal_lower = target_kcal * 0.33
    kcal_upper = target_kcal * 0.50

    max_attempts = 20
    for _ in range(max_attempts):
        main_dish = random.choice(available_mains)
        num_sides = random.choice([1, 2])
        side_picks = random.sample(available_sides, min(num_sides, len(available_sides)))

        # 计算份量（克数）
        staple_kcal = staple.get('kcal_per_100g', 130)
        staple_grams = random.choice([150, 180, 200])
        staple_energy = staple_kcal * staple_grams / 100

        main_grams = random.choice([100, 120, 150])
        main_energy = main_dish['kcal_per_100g'] * main_grams / 100

        side_items = []
        side_total_energy = 0
        for s in side_picks:
            sg = random.choice([100, 120, 150])
            se = s['kcal_per_100g'] * sg / 100
            side_items.append(_calc_dish_nutrition(s, sg))
            side_total_energy += se

        total_kcal = staple_energy + main_energy + side_total_energy

        if kcal_lower <= total_kcal <= kcal_upper:
            # 计算总营养
            total_protein = staple.get('protein_g', 3) * staple_grams / 100
            total_protein += main_dish['protein_g'] * main_grams / 100
            total_fat = staple.get('fat_g', 1) * staple_grams / 100
            total_fat += main_dish['fat_g'] * main_grams / 100
            total_carb = staple.get('carb_g', 25) * staple_grams / 100
            total_carb += main_dish['carb_g'] * main_grams / 100

            for si in side_items:
                total_protein += si['protein_g']
                total_fat += si['fat_g']
                total_carb += si['carb_g']

            dishes = [_calc_dish_nutrition(main_dish, main_grams)] + side_items

            meal = MealPlan(
                user_id=user_id,
                date=target_date,
                main_staple=f"{staple['name']} {staple_grams}g",
                dishes=[Dish(**d) for d in dishes],
                total_kcal=round(total_kcal, 1),
                protein_g=round(total_protein, 1),
                fat_g=round(total_fat, 1),
                carb_g=round(total_carb, 1),
            )
            db.save_meal(meal)
            return {
                'main_staple': meal.main_staple,
                'dishes': [{'name': d.name, 'grams': d.grams, 'kcal': d.kcal} for d in meal.dishes],
                'total_kcal': meal.total_kcal,
                'protein_g': meal.protein_g,
                'fat_g': meal.fat_g,
                'carb_g': meal.carb_g,
            }

    # 多次尝试后仍不匹配，放宽条件返回最近一次结果
    return {'error': '无法在热量范围内生成饮食，请调整目标热量'}


def validate_meal(meal_candidate: dict, user_id: str, target_date: str) -> dict:
    """校验饮食方案：热量区间、忌口、主食去重"""
    allergies = db.get_allergies(user_id)
    total_kcal = meal_candidate.get('total_kcal', 0)
    target_kcal = meal_candidate.get('target_kcal', 2000)

    errors = []

    # 1. 热量区间
    if not (target_kcal * 0.33 <= total_kcal <= target_kcal * 0.50):
        errors.append(f'总热量 {total_kcal} 不在目标区间 [{target_kcal*0.33:.0f}, {target_kcal*0.5:.0f}]')

    # 2. 忌口检查
    for dish in meal_candidate.get('dishes', []):
        for allergy in allergies:
            if allergy in dish.get('name', ''):
                errors.append(f"菜品 {dish['name']} 含忌口: {allergy}")

    # 3. 主食去重
    today = db.get_today_staple(user_id, target_date)
    if today and today == meal_candidate.get('main_staple', '').split(' ')[0]:
        errors.append('主食与今日已记录重复')

    return {'valid': len(errors) == 0, 'errors': errors}
