"""
MCP 中控调度层：流程编排、判断、调度。
不做具体业务计算，只负责编排 Skill 调用。
"""
import importlib
from datetime import date
from shared.db import db
from shared.models import UserProfile
from harness.validator import validate_body_data, validate_workout_plan, check_medical_redline
from harness.constraints import WEIGHT_CHANGE_THRESHOLD


def _import_skill(module_name: str, func_name: str):
    """通过 importlib 导入含空格/中文的 Skill 模块"""
    mod = importlib.import_module(f'skills.{module_name}')
    return getattr(mod, func_name)


class Orchestrator:
    """中控调度器，串联所有 Skill 完成业务流程"""

    # ================================================================
    # 流程1: 新用户初始化
    # ================================================================
    def new_user_init(self, user_data: dict) -> dict:
        """录入 → 校验 → 测算 → 生成健身方案 → 生成当日饮食"""
        # 1. Harness 前置校验
        validation = validate_body_data(user_data)
        if not validation['valid']:
            return {'success': False, 'stage': 'validation', 'errors': validation['errors']}

        # 2. 数据录入 Skill
        user_data_entry = _import_skill('用户身体数据录入 Skill', 'user_data_entry')
        entry_result = user_data_entry(user_data['user_id'], user_data)
        if 'error' in entry_result:
            return {'success': False, 'stage': 'data_entry', 'errors': [entry_result['error']]}

        # 3. 指标测算 Skill
        calculate_metrics = _import_skill('人体指标测算 Skill', 'calculate_metrics')
        profile = db.get_user(user_data['user_id'])
        metrics = calculate_metrics(
            height_cm=profile.height_cm, weight_kg=profile.weight_kg,
            age=profile.age, gender=profile.gender,
            fitness_goal=profile.fitness_goal, activity_level=profile.activity_level,
        )

        # 4. 健身方案生成 Skill
        generate_workout_plan = _import_skill('健身方案生成 Skill', 'generate_workout_plan')
        workout = generate_workout_plan(
            user_id=user_data['user_id'], place=profile.place,
            fitness_level=profile.fitness_level, days=7,
        )

        # Harness 后置校验训练方案
        workout_validation = validate_workout_plan(workout, profile.fitness_level)
        if not workout_validation['valid']:
            return {'success': False, 'stage': 'workout_validation', 'errors': workout_validation['errors']}

        # 5. 每日饮食生成
        today = date.today().isoformat()
        meal = self.daily_meal_flow(user_data['user_id'], today)

        return {
            'success': True, 'stage': 'complete',
            'user_id': user_data['user_id'],
            'metrics': metrics, 'workout_plan': workout, 'today_meal': meal,
        }

    # ================================================================
    # 流程2: 每周体重回访
    # ================================================================
    def weekly_checkin_flow(self, user_id: str, new_weight_kg: float) -> dict:
        """校验体重 → 对比历史 → 必要时重新生成方案"""
        weekly_checkin = _import_skill('每周回访问询 Skill', 'weekly_checkin')
        checkin = weekly_checkin(user_id, new_weight_kg)

        result = {'success': True, 'checkin': checkin, 'regenerated': False}

        if checkin['should_regenerate_plan']:
            profile = db.get_user(user_id)
            if profile:
                generate_workout_plan = _import_skill('健身方案生成 Skill', 'generate_workout_plan')
                new_plan = generate_workout_plan(
                    user_id=user_id, place=profile.place,
                    fitness_level=profile.fitness_level, days=7,
                )
                result['regenerated'] = True
                result['new_workout_plan'] = new_plan

        return result

    # ================================================================
    # 流程3: 每日饮食生成
    # ================================================================
    def daily_meal_flow(self, user_id: str, target_date: str = None) -> dict:
        """生成主食 → 搭配饮食 → 校验 → 返回"""
        if target_date is None:
            target_date = date.today().isoformat()

        profile = db.get_user(user_id)
        if not profile:
            return {'success': False, 'error': '用户不存在'}

        calculate_metrics = _import_skill('人体指标测算 Skill', 'calculate_metrics')
        metrics = calculate_metrics(
            height_cm=profile.height_cm, weight_kg=profile.weight_kg,
            age=profile.age, gender=profile.gender,
            fitness_goal=profile.fitness_goal, activity_level=profile.activity_level,
        )
        target_kcal = metrics['recommended_intake']

        generate_daily_staple = _import_skill('每日主食随机生成 Skill', 'generate_daily_staple')
        staple_result = generate_daily_staple(user_id, target_date)

        generate_meal = _import_skill('每日饮食搭配 Skill', 'generate_meal')
        meal = generate_meal(
            user_id=user_id, target_kcal=target_kcal,
            staple=staple_result['staple'], target_date=target_date,
        )

        if 'error' in meal:
            return {'success': False, 'error': meal['error']}

        return {'success': True, 'date': target_date, 'target_kcal': target_kcal, 'meal': meal}

    # ================================================================
    # 流程4: 重新生成饮食
    # ================================================================
    def regenerate_meal(self, user_id: str, target_date: str = None) -> dict:
        """去重后重新生成饮食"""
        if target_date is None:
            target_date = date.today().isoformat()

        profile = db.get_user(user_id)
        if not profile:
            return {'success': False, 'error': '用户不存在'}

        calculate_metrics = _import_skill('人体指标测算 Skill', 'calculate_metrics')
        metrics = calculate_metrics(
            height_cm=profile.height_cm, weight_kg=profile.weight_kg,
            age=profile.age, gender=profile.gender,
            fitness_goal=profile.fitness_goal, activity_level=profile.activity_level,
        )
        target_kcal = metrics['recommended_intake']

        regenerate_daily_staple = _import_skill('每日主食随机生成 Skill', 'regenerate_daily_staple')
        staple_result = regenerate_daily_staple(user_id, target_date)

        generate_meal = _import_skill('每日饮食搭配 Skill', 'generate_meal')
        meal = generate_meal(
            user_id=user_id, target_kcal=target_kcal,
            staple=staple_result['staple'], target_date=target_date,
        )

        if 'error' in meal:
            return {'success': False, 'error': meal['error']}

        return {'success': True, 'date': target_date, 'regenerated': True, 'meal': meal}


orchestrator = Orchestrator()
