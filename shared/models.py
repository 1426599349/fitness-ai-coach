from dataclasses import dataclass, field
from typing import Optional
from datetime import date


@dataclass
class UserProfile:
    user_id: str
    height_cm: float
    weight_kg: float
    age: int
    gender: str  # male / female
    fitness_goal: str  # fat_loss / muscle_gain / shape / maintain
    fitness_level: str  # beginner / intermediate / advanced
    activity_level: str  # sedentary / light / moderate / active / very_active
    allergies: list = field(default_factory=list)
    place: str = "home"  # home / gym


@dataclass
class BodyMetrics:
    bmi: float
    bmr: float
    tdee: float
    recommended_intake: float
    protein_g: float
    fat_g: float
    carb_g: float


@dataclass
class Exercise:
    name: str
    sets: int
    reps: int
    rest_seconds: int
    notes: str


@dataclass
class WorkoutDay:
    day: int
    focus: str
    exercises: list  # list of Exercise


@dataclass
class WorkoutPlan:
    user_id: str
    place: str
    days: int
    schedule: list  # list of WorkoutDay
    created_date: str
    version: int = 1


@dataclass
class Dish:
    name: str
    grams: int
    kcal: float
    protein_g: float = 0
    fat_g: float = 0
    carb_g: float = 0


@dataclass
class MealPlan:
    user_id: str
    date: str
    main_staple: str
    dishes: list  # list of Dish
    total_kcal: float
    protein_g: float
    fat_g: float
    carb_g: float


@dataclass
class WeightRecord:
    user_id: str
    weight_kg: float
    date: str


@dataclass
class CheckinResult:
    old_weight: float
    new_weight: float
    change_percent: float
    should_regenerate_plan: bool
    message: str
