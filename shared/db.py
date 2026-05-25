"""
SQLite 数据库 — 替代内存 dict，数据持久化不丢
Python 标准库自带 sqlite3，无需额外安装
"""
import sqlite3, json, os
from datetime import date, timedelta
from typing import Optional
from .models import UserProfile, WeightRecord, WorkoutPlan, MealPlan

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fitness.db')


class Database:

    def __init__(self):
        self._conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self):
        self._conn.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                height_cm REAL, weight_kg REAL, age INTEGER,
                gender TEXT, fitness_goal TEXT, fitness_level TEXT,
                activity_level TEXT, allergies TEXT, liked_foods TEXT, place TEXT,
                credits INTEGER DEFAULT 200, last_signin TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS weight_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT, weight_kg REAL, date TEXT
            );
            CREATE TABLE IF NOT EXISTS workout_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT, plan_data TEXT, version INTEGER DEFAULT 1,
                created_date TEXT
            );
            CREATE TABLE IF NOT EXISTS meal_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT, date TEXT, main_staple TEXT,
                dishes TEXT, total_kcal REAL,
                protein_g REAL, fat_g REAL, carb_g REAL
            );
            CREATE TABLE IF NOT EXISTS daily_staples (
                user_id TEXT, date TEXT, staple_name TEXT,
                PRIMARY KEY (user_id, date)
            );
        ''')
        self._conn.commit()

    # ===== 用户 =====
    def save_user_profile(self, user_id: str, data: dict) -> UserProfile:
        profile = UserProfile(
            user_id=user_id,
            height_cm=data['height_cm'], weight_kg=data['weight_kg'],
            age=data['age'], gender=data['gender'],
            fitness_goal=data.get('fitness_goal', 'maintain'),
            fitness_level=data.get('fitness_level', 'beginner'),
            activity_level=data.get('activity_level', 'moderate'),
            allergies=data.get('allergies', []),
            place=data.get('place', 'home'),
        )
        self._conn.execute('''INSERT OR REPLACE INTO users
            (user_id, height_cm, weight_kg, age, gender, fitness_goal, fitness_level, activity_level, allergies, place, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
            (user_id, profile.height_cm, profile.weight_kg, profile.age,
             profile.gender, profile.fitness_goal, profile.fitness_level,
             profile.activity_level, json.dumps(profile.allergies, ensure_ascii=False),
             profile.place, date.today().isoformat()))
        self._conn.commit()
        self.save_weight(user_id, data['weight_kg'])
        return profile

    def get_user(self, user_id: str) -> Optional[UserProfile]:
        row = self._conn.execute('SELECT * FROM users WHERE user_id=?', (user_id,)).fetchone()
        if not row:
            return None
        return UserProfile(
            user_id=row['user_id'], height_cm=row['height_cm'],
            weight_kg=row['weight_kg'], age=row['age'],
            gender=row['gender'], fitness_goal=row['fitness_goal'],
            fitness_level=row['fitness_level'], activity_level=row['activity_level'],
            allergies=json.loads(row['allergies'] or '[]'),
            place=row['place'],
        )

    def update_user_weight(self, user_id: str, new_weight: float):
        self._conn.execute('UPDATE users SET weight_kg=? WHERE user_id=?', (new_weight, user_id))
        self._conn.commit()
        self.save_weight(user_id, new_weight)

    # ===== 体重 =====
    def save_weight(self, user_id: str, weight_kg: float):
        self._conn.execute('INSERT INTO weight_history (user_id, weight_kg, date) VALUES (?,?,?)',
                           (user_id, weight_kg, date.today().isoformat()))
        self._conn.commit()

    def get_last_weight(self, user_id: str) -> Optional[float]:
        row = self._conn.execute(
            'SELECT weight_kg FROM weight_history WHERE user_id=? ORDER BY date DESC LIMIT 1',
            (user_id,)).fetchone()
        return row['weight_kg'] if row else None

    def get_weight_history(self, user_id: str) -> list[WeightRecord]:
        rows = self._conn.execute(
            'SELECT * FROM weight_history WHERE user_id=? ORDER BY date ASC', (user_id,)).fetchall()
        return [WeightRecord(user_id=r['user_id'], weight_kg=r['weight_kg'], date=r['date']) for r in rows]

    # ===== 健身方案 =====
    def save_workout_plan(self, plan: WorkoutPlan):
        self._conn.execute(
            'INSERT INTO workout_plans (user_id, plan_data, version, created_date) VALUES (?,?,?,?)',
            (plan.user_id, json.dumps(plan.schedule, ensure_ascii=False, default=str),
             plan.version, plan.created_date))
        self._conn.commit()

    def get_latest_workout(self, user_id: str) -> Optional[WorkoutPlan]:
        row = self._conn.execute(
            'SELECT * FROM workout_plans WHERE user_id=? ORDER BY id DESC LIMIT 1', (user_id,)).fetchone()
        if not row:
            return None
        return WorkoutPlan(
            user_id=row['user_id'], place='home', days=7,
            schedule=json.loads(row['plan_data']),
            created_date=row['created_date'], version=row['version'],
        )

    # ===== 饮食 =====
    def save_meal(self, meal: MealPlan):
        self._conn.execute(
            'INSERT INTO meal_history (user_id, date, main_staple, dishes, total_kcal, protein_g, fat_g, carb_g) VALUES (?,?,?,?,?,?,?,?)',
            (meal.user_id, meal.date, meal.main_staple,
             json.dumps([{'name': d.name, 'grams': d.grams, 'kcal': d.kcal,
                          'protein_g': d.protein_g, 'fat_g': d.fat_g, 'carb_g': d.carb_g}
                         for d in meal.dishes], ensure_ascii=False),
             meal.total_kcal, meal.protein_g, meal.fat_g, meal.carb_g))
        self._conn.execute('INSERT OR REPLACE INTO daily_staples (user_id, date, staple_name) VALUES (?,?,?)',
                           (meal.user_id, meal.date, meal.main_staple))
        self._conn.commit()

    def get_today_staple(self, user_id: str, target_date: str) -> Optional[str]:
        row = self._conn.execute(
            'SELECT staple_name FROM daily_staples WHERE user_id=? AND date=?',
            (user_id, target_date)).fetchone()
        return row['staple_name'] if row else None

    def get_yesterday_staple(self, user_id: str) -> Optional[str]:
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        return self.get_today_staple(user_id, yesterday)

    def get_today_meal(self, user_id: str, target_date: str) -> Optional[MealPlan]:
        row = self._conn.execute(
            'SELECT * FROM meal_history WHERE user_id=? AND date=? ORDER BY id DESC LIMIT 1',
            (user_id, target_date)).fetchone()
        if not row:
            return None
        dishes = json.loads(row['dishes'])
        return MealPlan(
            user_id=row['user_id'], date=row['date'],
            main_staple=row['main_staple'],
            dishes=[type('Dish', (), d) for d in dishes],
            total_kcal=row['total_kcal'],
            protein_g=row['protein_g'], fat_g=row['fat_g'], carb_g=row['carb_g'],
        )

    def get_allergies(self, user_id: str) -> list:
        user = self.get_user(user_id)
        return user.allergies if user else []


db = Database()
