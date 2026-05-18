from datetime import date, datetime, timedelta
from typing import Optional
from .models import UserProfile, WeightRecord, WorkoutPlan, MealPlan


class Database:
    """内存模拟数据库，Demo阶段使用"""

    def __init__(self):
        self._users: dict[str, UserProfile] = {}
        self._weight_history: dict[str, list[WeightRecord]] = {}
        self._workout_plans: dict[str, list[WorkoutPlan]] = {}
        self._meal_history: dict[str, list[MealPlan]] = {}
        self._daily_staples: dict[str, str] = {}  # key: user_id:date, value: staple_name

    # ---- 用户档案 ----
    def save_user_profile(self, user_id: str, data: dict) -> UserProfile:
        profile = UserProfile(
            user_id=user_id,
            height_cm=data['height_cm'],
            weight_kg=data['weight_kg'],
            age=data['age'],
            gender=data['gender'],
            fitness_goal=data.get('fitness_goal', 'maintain'),
            fitness_level=data.get('fitness_level', 'beginner'),
            activity_level=data.get('activity_level', 'moderate'),
            allergies=data.get('allergies', []),
            place=data.get('place', 'home'),
        )
        self._users[user_id] = profile
        # 同步记录初始体重
        self.save_weight(user_id, data['weight_kg'])
        return profile

    def get_user(self, user_id: str) -> Optional[UserProfile]:
        return self._users.get(user_id)

    def update_user_weight(self, user_id: str, new_weight: float):
        if user_id in self._users:
            self._users[user_id].weight_kg = new_weight
        self.save_weight(user_id, new_weight)

    # ---- 体重记录 ----
    def save_weight(self, user_id: str, weight_kg: float):
        record = WeightRecord(
            user_id=user_id,
            weight_kg=weight_kg,
            date=date.today().isoformat(),
        )
        if user_id not in self._weight_history:
            self._weight_history[user_id] = []
        self._weight_history[user_id].append(record)

    def get_last_weight(self, user_id: str) -> Optional[float]:
        records = self._weight_history.get(user_id, [])
        if not records:
            return None
        return records[-1].weight_kg

    def get_weight_history(self, user_id: str) -> list[WeightRecord]:
        return self._weight_history.get(user_id, [])

    # ---- 健身方案 ----
    def save_workout_plan(self, plan: WorkoutPlan):
        if plan.user_id not in self._workout_plans:
            self._workout_plans[plan.user_id] = []
        self._workout_plans[plan.user_id].append(plan)

    def get_latest_workout(self, user_id: str) -> Optional[WorkoutPlan]:
        plans = self._workout_plans.get(user_id, [])
        return plans[-1] if plans else None

    # ---- 饮食记录 ----
    def save_meal(self, meal: MealPlan):
        if meal.user_id not in self._meal_history:
            self._meal_history[meal.user_id] = []
        self._meal_history[meal.user_id].append(meal)
        # 记录今日主食
        key = f"{meal.user_id}:{meal.date}"
        self._daily_staples[key] = meal.main_staple

    def get_today_staple(self, user_id: str, target_date: str) -> Optional[str]:
        return self._daily_staples.get(f"{user_id}:{target_date}")

    def get_yesterday_staple(self, user_id: str) -> Optional[str]:
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        return self._daily_staples.get(f"{user_id}:{yesterday}")

    def get_today_meal(self, user_id: str, target_date: str) -> Optional[MealPlan]:
        meals = self._meal_history.get(user_id, [])
        for m in reversed(meals):
            if m.date == target_date:
                return m
        return None

    # ---- 过敏/偏好 ----
    def get_allergies(self, user_id: str) -> list:
        user = self._users.get(user_id)
        return user.allergies if user else []


# 全局单例
db = Database()
