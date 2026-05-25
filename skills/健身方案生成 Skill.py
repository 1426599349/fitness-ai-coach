import random
from datetime import date
from shared.db import db
from shared.models import WorkoutPlan, WorkoutDay, Exercise


# ============================================================
# 动作库（硬编码，按PRD规格）
# ============================================================
HOME_ACTIONS = {
    'beginner': [
        {'name': '深蹲', 'muscle': '腿', 'notes': '膝盖不过脚尖，背部挺直'},
        {'name': '靠墙俯卧撑', 'muscle': '胸', 'notes': '身体成直线，缓慢下放'},
        {'name': '平板支撑', 'muscle': '核心', 'notes': '收紧腹部，身体成一直线'},
        {'name': '原地踏步', 'muscle': '有氧', 'notes': '摆臂自然，保持节奏'},
        {'name': '臀桥', 'muscle': '腿', 'notes': '臀部发力上抬，顶峰收缩'},
        {'name': '跪姿俯卧撑', 'muscle': '胸', 'notes': '膝盖着地，核心收紧'},
    ],
    'intermediate': [
        {'name': '标准俯卧撑', 'muscle': '胸', 'notes': '身体成直线，下落时胸部贴近地面'},
        {'name': '弓步蹲', 'muscle': '腿', 'notes': '前膝不超过脚尖，后膝接近地面'},
        {'name': '仰卧起坐', 'muscle': '核心', 'notes': '用腹部发力，不要抱头拉扯颈部'},
        {'name': '开合跳', 'muscle': '有氧', 'notes': '落地轻盈，膝盖微屈缓冲'},
        {'name': '哑铃弯举', 'muscle': '臂', 'notes': '肘部固定，集中二头肌发力'},
        {'name': '登山跑', 'muscle': '核心', 'notes': '保持核心稳定，交替提膝'},
        {'name': '深蹲', 'muscle': '腿', 'notes': '可手持轻哑铃增加难度'},
        {'name': '臀桥', 'muscle': '腿', 'notes': '单腿变体可增加难度'},
    ],
    'advanced': [
        {'name': '波比跳', 'muscle': '全身', 'notes': '全程核心收紧，落地缓冲'},
        {'name': '单腿深蹲', 'muscle': '腿', 'notes': '重心稳定，扶墙辅助逐步进阶'},
        {'name': '钻石俯卧撑', 'muscle': '胸', 'notes': '双手拇指食指相触形成钻石形'},
        {'name': '悬垂举腿', 'muscle': '核心', 'notes': '悬挂时肩膀放松，抬腿时控制'},
        {'name': '保加利亚分腿蹲', 'muscle': '腿', 'notes': '后脚抬高，前腿发力为主'},
        {'name': '标准俯卧撑', 'muscle': '胸', 'notes': '可负重背包增加强度'},
        {'name': '弓步蹲', 'muscle': '腿', 'notes': '可双手持哑铃增加负重'},
        {'name': '登山跑', 'muscle': '核心', 'notes': '加快节奏，保持腹肌持续紧张'},
    ],
}

GYM_ACTIONS = {
    'beginner': [
        {'name': '器械腿举', 'muscle': '腿', 'notes': '调整座椅，膝盖不锁死'},
        {'name': '坐姿胸推', 'muscle': '胸', 'notes': '肩胛收紧，控制离心阶段'},
        {'name': '高位下拉', 'muscle': '背', 'notes': '沉肩，下拉至锁骨位置'},
        {'name': '坐姿划船', 'muscle': '背', 'notes': '挺胸收腹，向后挤压肩胛'},
        {'name': '器械卷腹', 'muscle': '核心', 'notes': '用腹肌发力，含胸收腹'},
        {'name': '椭圆机', 'muscle': '有氧', 'notes': '保持匀速，心率控制在120-140'},
    ],
    'intermediate': [
        {'name': '杠铃深蹲', 'muscle': '腿', 'notes': '核心收紧，脊柱中立位'},
        {'name': '哑铃卧推', 'muscle': '胸', 'notes': '手腕中立，下落至胸侧'},
        {'name': '引体向上', 'muscle': '背', 'notes': '辅助机或弹力带辅助'},
        {'name': '罗马尼亚硬拉', 'muscle': '腿', 'notes': '微屈膝，髋部后移主导'},
        {'name': '坐姿哑铃推举', 'muscle': '肩', 'notes': '背部贴靠椅背，稳定发力'},
        {'name': '站姿提踵', 'muscle': '腿', 'notes': '顶峰收缩停顿2秒'},
        {'name': '坐姿划船', 'muscle': '背', 'notes': '增加重量，保持动作标准'},
        {'name': '高位下拉', 'muscle': '背', 'notes': '中等重量，控制节奏'},
    ],
    'advanced': [
        {'name': '自由深蹲', 'muscle': '腿', 'notes': '大重量需有人保护，充分热身'},
        {'name': '平板卧推', 'muscle': '胸', 'notes': '起桥稳定，大重量需保护'},
        {'name': '负重引体向上', 'muscle': '背', 'notes': '腰间挂片或穿负重背心'},
        {'name': '硬拉', 'muscle': '全身', 'notes': '发力前核心完全收紧，脊柱中立'},
        {'name': '哑铃飞鸟', 'muscle': '胸', 'notes': '肘部微屈，控制离心收缩'},
        {'name': '双杠臂屈伸', 'muscle': '臂', 'notes': '身体前倾练胸，垂直练三头'},
        {'name': '杠铃深蹲', 'muscle': '腿', 'notes': '大重量组，深度到位'},
        {'name': '哑铃卧推', 'muscle': '胸', 'notes': '大重量，离心控制放慢'},
    ],
}

# 训练强度限制（按体能等级）
INTENSITY_LIMITS = {
    'beginner': {'max_minutes': 25, 'max_exercises': 6, 'max_sets': 3, 'max_reps': 12},
    'intermediate': {'max_minutes': 40, 'max_exercises': 8, 'max_sets': 4, 'max_reps': 15},
    'advanced': {'max_minutes': 60, 'max_exercises': 10, 'max_sets': 5, 'max_reps': 20},
}

# 7天训练分配（训练4天+休息3天）
WEEKLY_SPLIT = [
    {'day': 1, 'focus': '胸+三头'},
    {'day': 2, 'focus': '背+二头'},
    {'day': 3, 'focus': '休息'},
    {'day': 4, 'focus': '腿+肩'},
    {'day': 5, 'focus': '核心+有氧'},
    {'day': 6, 'focus': '休息'},
    {'day': 7, 'focus': '休息'},
]

MUSCLE_MAP = {
    '胸': ['胸'],
    '背': ['背'],
    '腿': ['腿'],
    '核心': ['核心'],
    '肩': ['肩'],
    '臂': ['臂'],
    '有氧': ['有氧'],
    '全身': ['全身'],
    '胸+三头': ['胸', '臂'],
    '背+二头': ['背', '臂'],
    '腿+肩': ['腿', '肩'],
    '核心+有氧': ['核心', '有氧'],
}


def _pick_action(actions: list[dict], focus: str, used_names: set) -> dict:
    """从动作库中选择匹配当天焦点的动作，避免重复"""
    target_muscles = MUSCLE_MAP.get(focus, ['全身'])
    pool = [a for a in actions if a['muscle'] in target_muscles and a['name'] not in used_names]
    if not pool:
        pool = [a for a in actions if a['name'] not in used_names]
    if not pool:
        pool = actions
    return random.choice(pool)


def generate_workout_plan(user_id: str, place: str, fitness_level: str,
                          days: int = 7) -> dict:
    """
    根据用户档案生成训练计划。
    V1使用规则引擎从动作库直接组装，不调LLM。
    """
    actions = HOME_ACTIONS if place == 'home' else GYM_ACTIONS
    level_actions = actions.get(fitness_level, actions['beginner'])
    limits = INTENSITY_LIMITS.get(fitness_level, INTENSITY_LIMITS['beginner'])

    schedule = []
    for slot in WEEKLY_SPLIT[:days]:
        if slot['focus'] == '休息':
            schedule.append({
                'day': slot['day'],
                'focus': '休息',
                'exercises': [],
            })
            continue

        # 根据强度限制选动作
        num_exercises = min(random.randint(3, 5), limits['max_exercises'])
        used = set()
        exercises = []
        for _ in range(num_exercises):
            action = _pick_action(level_actions, slot['focus'], used)
            used.add(action['name'])
            sets = random.randint(2, limits['max_sets'])
            reps = random.randint(8, limits['max_reps'])
            rest = random.choice([30, 45, 60, 90])
            exercises.append({
                'name': action['name'],
                'sets': sets,
                'reps': reps,
                'rest_seconds': rest,
                'notes': action['notes'],
            })

        schedule.append({
            'day': slot['day'],
            'focus': slot['focus'],
            'exercises': exercises,
        })

    plan = WorkoutPlan(
        user_id=user_id,
        place=place,
        days=days,
        schedule=schedule,
        created_date=date.today().isoformat(),
    )
    db.save_workout_plan(plan)

    return {
        'place': place,
        'days': days,
        'fitness_level': fitness_level,
        'schedule': schedule,
    }
