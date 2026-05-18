from shared.db import db


def weekly_checkin(user_id: str, new_weight_kg: float) -> dict:
    """每周体重回访：对比历史体重，判断是否需要更新方案"""
    old_weight = db.get_last_weight(user_id)

    if old_weight is None:
        # 首次录入，直接保存
        db.save_weight(user_id, new_weight_kg)
        db.update_user_weight(user_id, new_weight_kg)
        return {
            'old_weight': new_weight_kg,
            'new_weight': new_weight_kg,
            'change_percent': 0.0,
            'should_regenerate_plan': False,
            'message': '首次录入体重，已为您生成初始方案',
        }

    change_percent = (new_weight_kg - old_weight) / old_weight * 100
    need_update = abs(change_percent) > 2

    db.save_weight(user_id, new_weight_kg)
    db.update_user_weight(user_id, new_weight_kg)

    return {
        'old_weight': round(old_weight, 1),
        'new_weight': new_weight_kg,
        'change_percent': round(change_percent, 1),
        'should_regenerate_plan': need_update,
        'message': (
            '体重变化平稳，继续执行原计划'
            if not need_update
            else f'体重变化 {abs(change_percent):.1f}%，超过2%，已为您更新训练与饮食方案'
        ),
    }
