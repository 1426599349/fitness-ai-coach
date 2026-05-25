from shared.db import db
from harness.validator import validate_body_data


def user_data_entry(user_id: str, data: dict) -> dict:
    """
    录入用户身体数据。
    data 包含: height_cm, weight_kg, age, gender, fitness_goal, fitness_level, allergies, activity_level, place
    """
    # Harness 校验
    validation = validate_body_data(data)
    if not validation['valid']:
        return {'error': '; '.join(validation['errors'])}

    # 保存到数据库
    db.save_user_profile(user_id, data)
    return {'status': 'saved', 'profile': data}
