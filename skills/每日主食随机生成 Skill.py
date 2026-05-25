import os
import random
from datetime import date, timedelta
from shared.db import db


def _load_staple_list() -> list[dict]:
    """从饮食库加载主食列表，返回 [{name, kcal_per_100g, protein, carb, fat}, ...]"""
    staples = []
    food_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), '饮食库')
    with open(os.path.join(food_dir, '主食.txt'), encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split('｜')
            if len(parts) >= 5:
                staples.append({
                    'name': parts[0].strip(),
                    'kcal_per_100g': float(parts[1].replace('大卡', '').strip()),
                    'carb_g': float(parts[2].replace('碳水', '').replace('g', '').strip()),
                    'protein_g': float(parts[3].replace('蛋白质', '').replace('g', '').strip()),
                    'fat_g': float(parts[4].replace('脂肪', '').replace('g', '').strip()),
                })
    return staples


STAPLE_LIST = _load_staple_list()


def _pick_staple(exclude_names: list[str] = None) -> dict:
    """从主食列表中随机选一个，排除指定名称"""
    exclude = set(exclude_names or [])
    pool = [s for s in STAPLE_LIST if s['name'] not in exclude]
    if not pool:
        pool = STAPLE_LIST  # 去重失败，回退全量
    return random.choice(pool)


def generate_daily_staple(user_id: str, target_date: str = None) -> dict:
    """
    为指定用户生成每日随机主食。
    规则：不与昨日主食重复；若指定日期已有记录，直接返回。
    """
    if target_date is None:
        target_date = date.today().isoformat()

    # 检查今日是否已有
    existing = db.get_today_staple(user_id, target_date)
    if existing:
        matched = next((s for s in STAPLE_LIST if s['name'] == existing), None)
        if matched:
            return {'date': target_date, 'staple': matched, 'regenerated': False}

    # 排除昨日主食
    yesterday_staple = db.get_yesterday_staple(user_id)
    pick = _pick_staple(exclude_names=[yesterday_staple] if yesterday_staple else [])

    return {'date': target_date, 'staple': pick, 'regenerated': False}


def regenerate_daily_staple(user_id: str, target_date: str = None) -> dict:
    """重新生成主食，确保与当前已记录的不同"""
    if target_date is None:
        target_date = date.today().isoformat()

    current = db.get_today_staple(user_id, target_date)
    yesterday = db.get_yesterday_staple(user_id)

    exclude = []
    if current:
        exclude.append(current)
    if yesterday:
        exclude.append(yesterday)

    pick = _pick_staple(exclude_names=exclude)
    return {'date': target_date, 'staple': pick, 'regenerated': True}
