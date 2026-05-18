from shared.db import db


def filter_by_preferences(user_id: str, food_items: list) -> list:
    """过滤含忌口食材的食物列表"""
    allergies = db.get_allergies(user_id)
    result = []
    for item in food_items:
        allowed = True
        reason = ''
        for allergy in allergies:
            if allergy in item.lower():
                allowed = False
                reason = f'忌口: {allergy}'
                break
        result.append({'item': item, 'allowed': allowed, 'reason': reason})
    return result
