"""
健身AI个性化健康助手 V1.0 — 主应用入口
架构: Skill（能力原子） + MCP（中控调度） + Harness（约束管控）
"""
import importlib
from datetime import date
from shared.db import db
from mcp.orchestrator import orchestrator
from mcp.scheduler import scheduler
from harness.validator import check_medical_redline


def _import_skill(module_name: str, func_name: str):
    mod = importlib.import_module(f'skills.{module_name}')
    return getattr(mod, func_name)


# ================================================================
# API 接口（模拟小程序后端）
# ================================================================

def api_user_init(user_data: dict) -> dict:
    """新用户初始化：录入→测算→生成方案→生成饮食"""
    return orchestrator.new_user_init(user_data)


def api_user_checkin(user_id: str, new_weight_kg: float) -> dict:
    """每周体重回访"""
    return orchestrator.weekly_checkin_flow(user_id, new_weight_kg)


def api_daily_meal(user_id: str, target_date: str = None) -> dict:
    """获取今日饮食"""
    if target_date is None:
        target_date = date.today().isoformat()
    return orchestrator.daily_meal_flow(user_id, target_date)


def api_regenerate_meal(user_id: str, target_date: str = None) -> dict:
    """重新生成饮食（换一换）"""
    if target_date is None:
        target_date = date.today().isoformat()
    return orchestrator.regenerate_meal(user_id, target_date)


def api_workout_plan(user_id: str) -> dict:
    """获取最新训练计划"""
    plan = db.get_latest_workout(user_id)
    if not plan:
        return {'success': False, 'error': '未找到训练计划'}
    return {
        'success': True,
        'place': plan.place,
        'days': plan.days,
        'created_date': plan.created_date,
        'version': plan.version,
        'schedule': plan.schedule,
    }


def api_user_profile(user_id: str) -> dict:
    """获取用户档案"""
    profile = db.get_user(user_id)
    if not profile:
        return {'success': False, 'error': '用户不存在'}
    calculate_metrics = _import_skill('人体指标测算 Skill', 'calculate_metrics')
    metrics = calculate_metrics(
        height_cm=profile.height_cm,
        weight_kg=profile.weight_kg,
        age=profile.age,
        gender=profile.gender,
        fitness_goal=profile.fitness_goal,
        activity_level=profile.activity_level,
    )
    return {
        'success': True,
        'profile': {
            'user_id': profile.user_id,
            'height_cm': profile.height_cm,
            'weight_kg': profile.weight_kg,
            'age': profile.age,
            'gender': profile.gender,
            'fitness_goal': profile.fitness_goal,
            'fitness_level': profile.fitness_level,
            'allergies': profile.allergies,
            'place': profile.place,
        },
        'metrics': metrics,
        'weight_history': [
            {'weight_kg': r.weight_kg, 'date': r.date}
            for r in db.get_weight_history(user_id)
        ],
    }


def api_handle_user_message(user_id: str, message: str) -> dict:
    """处理用户自然语言消息（MCP意图识别 + Harness医疗红线）"""
    # 医疗红线先拦截
    redline = check_medical_redline(message)
    if redline['blocked']:
        return {'success': False, 'blocked': True, 'message': redline['message']}

    # 简单意图识别
    msg_lower = message.lower()
    if any(w in msg_lower for w in ['换餐', '换一换', '换个', '重新生成', '再来一份']):
        return api_regenerate_meal(user_id)
    elif any(w in msg_lower for w in ['更新体重', '体重', '称重']):
        return {'success': True, 'action': 'checkin', 'message': '请输入您的最新体重（kg）'}
    elif any(w in msg_lower for w in ['训练计划', '健身方案', '今天练什么']):
        return api_workout_plan(user_id)
    elif any(w in msg_lower for w in ['今天吃什么', '饮食', '餐单', '吃什么']):
        return api_daily_meal(user_id)
    elif any(w in msg_lower for w in ['我的数据', '身体数据', '档案']):
        return api_user_profile(user_id)
    else:
        return {
            'success': True,
            'action': 'unknown',
            'message': '您可以：查看训练计划、查看今日饮食、换一换餐单、更新体重',
        }


# ================================================================
# Demo 运行
# ================================================================

def run_demo():
    """运行完整 Demo 演示流程"""
    print('=' * 60)
    print('  健身AI个性化健康助手 V1.0 — Demo 演示')
    print('=' * 60)

    user_id = 'demo_user_001'

    # ---- 1. 新用户初始化 ----
    print('\n[Step 1] 新用户初始化...')
    user_data = {
        'user_id': user_id,
        'height_cm': 170,
        'weight_kg': 75,
        'age': 28,
        'gender': 'male',
        'fitness_goal': 'fat_loss',
        'fitness_level': 'beginner',
        'activity_level': 'moderate',
        'allergies': ['海鲜', '花生'],
        'place': 'home',
    }
    result = api_user_init(user_data)
    if result['success']:
        print(f'  初始化成功!')
        metrics = result['metrics']
        print(f'  BMI: {metrics["bmi"]}, BMR: {metrics["bmr"]} kcal')
        print(f'  TDEE: {metrics["tdee"]} kcal, 推荐摄入: {metrics["recommended_intake"]} kcal')
        print(f'  蛋白质: {metrics["protein_g"]}g, 脂肪: {metrics["fat_g"]}g, 碳水: {metrics["carb_g"]}g')

        workout = result['workout_plan']
        print(f'\n  训练计划 ({workout["place"]}, {workout["days"]}天):')
        for day in workout['schedule']:
            if day['focus'] == '休息':
                print(f'    Day {day["day"]}: 休息日')
            else:
                actions = ', '.join(e['name'] for e in day['exercises'])
                print(f'    Day {day["day"]}: {day["focus"]} → {actions}')

        meal = result['today_meal']
        if meal['success']:
            print(f'\n  今日饮食:')
            print(f'    主食: {meal["meal"]["main_staple"]}')
            print(f'    总热量: {meal["meal"]["total_kcal"]} kcal')
            for dish in meal['meal']['dishes']:
                print(f'    - {dish["name"]} {dish["grams"]}g ({dish["kcal"]} kcal)')
    else:
        print(f'  初始化失败: {result.get("errors", result.get("error"))}')

    # ---- 2. 查看用户档案 ----
    print('\n[Step 2] 查看用户档案...')
    profile = api_user_profile(user_id)
    if profile['success']:
        print(f'  用户: {profile["profile"]["user_id"]}')
        print(f'  身高: {profile["profile"]["height_cm"]}cm, 体重: {profile["profile"]["weight_kg"]}kg')
        print(f'  推荐热量: {profile["metrics"]["recommended_intake"]} kcal')

    # ---- 3. 模拟每周回访（体重下降3kg，超过2%阈值） ----
    print('\n[Step 3] 模拟每周回访（体重 75→72kg，变化-4%）...')
    checkin = api_user_checkin(user_id, 72.0)
    print(f'  {checkin["checkin"]["message"]}')
    print(f'  方案已更新: {checkin["regenerated"]}')

    if checkin['regenerated']:
        new_plan = checkin['new_workout_plan']
        print(f'  新训练方案已生成 ({new_plan["days"]}天)')

    # ---- 4. 重新生成饮食 ----
    print('\n[Step 4] 手动换一换饮食...')
    new_meal = api_regenerate_meal(user_id)
    if new_meal['success']:
        print(f'  重新生成成功!')
        print(f'  新主食: {new_meal["meal"]["main_staple"]}')
        print(f'  总热量: {new_meal["meal"]["total_kcal"]} kcal')

    # ---- 5. 测试 Harness 医疗红线 ----
    print('\n[Step 5] 测试 Harness 医疗红线拦截...')
    redline_test = api_handle_user_message(user_id, '我膝盖受伤了怎么治疗')
    if not redline_test['success'] and redline_test.get('blocked'):
        print(f'  输入: "我膝盖受伤了怎么治疗"')
        print(f'  拦截: {redline_test["message"]}')

    # ---- 6. 测试异常数据拦截 ----
    print('\n[Step 6] 测试异常数据拦截（身高999cm）...')
    bad_data = {
        'user_id': 'bad_user',
        'height_cm': 999,
        'weight_kg': 75,
        'age': 28,
        'gender': 'male',
        'fitness_goal': 'fat_loss',
        'fitness_level': 'beginner',
    }
    bad_result = api_user_init(bad_data)
    if not bad_result['success']:
        print(f'  拦截成功: {bad_result["errors"]}')

    # ---- 7. 意图识别测试 ----
    print('\n[Step 7] 意图识别测试...')
    tests = ['今天吃什么', '换一换', '训练计划', '更新体重']
    for msg in tests:
        r = api_handle_user_message(user_id, msg)
        if r.get('blocked'):
            print(f'  "{msg}" → blocked')
        elif r.get('meal'):
            print(f'  "{msg}" → 返回今日饮食 (主食: {r["meal"]["main_staple"]})')
        elif r.get('schedule'):
            print(f'  "{msg}" → 返回训练计划')
        else:
            action = r.get('action', 'unknown')
            print(f'  "{msg}" → action={action}')

    print('\n' + '=' * 60)
    print('  Demo 演示完成!')
    print('=' * 60)


if __name__ == '__main__':
    run_demo()
