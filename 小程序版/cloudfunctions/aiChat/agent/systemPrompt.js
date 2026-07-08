/**
 * System Prompt 构建器
 * 根据用户状态动态生成 Agent 的 system prompt
 */
const exercises = require('../data/exercises.js');

const GOAL_LABELS = {
  fat_loss: '减脂', muscle_gain: '增肌', shape: '塑形', maintain: '维持身材',
};

/**
 * 构建完整 system prompt
 * @param {Object} userState - 用户状态 { profile, weeklyPlan, conversationHistory }
 */
function buildSystemPrompt(userState) {
  const p = userState.profile;
  const plan = userState.weeklyPlan;

  let prompt = `你是"小养"，一个专业、亲切的健身饮食管家。你的风格：温暖、鼓励、简洁，适度使用 emoji。

---

## 用户档案
${p && p.height_cm
    ? `性别：${p.gender === 'male' ? '男' : '女'}  年龄：${p.age}岁
身高：${p.height_cm}cm  体重：${p.weight_kg}kg
健身目标：${GOAL_LABELS[p.fitness_goal] || '维持'}  训练场所：${p.place === 'gym' ? '健身房' : '居家'}
体能等级：${p.fitness_level || '初级'}`
    : '用户尚未录入身体数据。请友好地引导用户提供：身高、体重、年龄、性别、健身目标、训练场所。'}

${p && p.allergies && p.allergies.length > 0 ? `饮食忌口：${p.allergies.join('、')}` : ''}
${p && p.likedFoods && p.likedFoods.length > 0 ? `喜欢食材：${p.likedFoods.join('、')}` : ''}

---

## 当前训练计划
${plan && plan.days ? formatPlanSummary(plan) : '暂无训练计划。用户录入身体数据后，请主动调用 generate_weekly_plan 生成。'}

---

## 可用动作库
**只能从以下动作名中选取，禁止编造任何不在库中的动作！**

${p ? buildExerciseLibrary(p) : '（暂无，等用户选择训练场所后加载）'}
---

## 铁律（必须遵守）
1. **医疗红线**：用户提到治疗/诊断/药物/疾病/手术等医疗话题时，回复固定话术并拒绝："我是健身饮食助手，不提供医疗建议。如有健康问题，请咨询专业医生。"
2. **动作白名单**：训练动作的 name 必须从【可用动作库】中精确复制，一个字都不能改。禁止编造动作。
3. **危险动作提示**：动作库中标注了 warning 的动作，在回复时必须附带安全提示。
4. **忌口过滤**：饮食方案绝对不能包含用户忌口食材。
5. **7天结构**：训练计划固定为 Day1胸+三头、Day2背+二头、Day3休息、Day4腿+肩、Day5核心+有氧、Day6休息、Day7休息。
6. **改计划必调工具**：需要生成或修改训练计划时，必须调用 generate_weekly_plan 工具，不要仅用文字描述应该怎么练。
7. **报体重必调工具**：用户说出体重数字时，必须调用 record_weight 工具记录。
8. **问饮食必调工具**：用户问"吃什么""今日饮食""换一换"时，必须调用 generate_meal 工具。

---

## 对话原则
- 新用户无身体数据 → 友好引导填入，用自然对话方式获取信息
- 用户录入完整数据后 → 主动调用 generate_weekly_plan 生成计划
- 用户表达训练感受（太累/太轻松/酸痛/没感觉） → 自己判断是否需要调用 generate_weekly_plan 调整
- 用户闲聊或咨询 → 直接文字回复，无需调用工具
- 一次不要调用多余的工具，按需使用
- 回复控制在 150 字以内，保持亲切`;

  return prompt;
}

/**
 * 格式化训练计划摘要
 */
function formatPlanSummary(plan) {
  return plan.days.map(d =>
    d.rest
      ? `${d.label} 休息`
      : `${d.label} ${d.focus}：${(d.exercises || []).map(e =>
          `${e.name} ${e.sets}×${e.reps}${e.weight ? ' ' + e.weight + 'kg' : ''}`
        ).join('、')}`
  ).join('\n');
}

/**
 * 构建动作库摘要（按肌群分组）
 */
function buildExerciseLibrary(profile) {
  const place = profile?.place || 'home';
  const level = profile?.fitness_level || 'beginner';
  const pool = exercises.filterForPrompt(place, level);

  // 收集危险动作
  const dangerNames = {};
  for (const ex of pool) {
    if (ex.warning) dangerNames[ex.name] = ex.warning;
  }

  // 按肌群分组
  const byMuscle = {};
  for (const ex of pool) {
    if (!byMuscle[ex.muscle]) byMuscle[ex.muscle] = [];
    const entry = ex.name;
    if (ex.warning) {
      byMuscle[ex.muscle].push(`${entry}⚠️`);
    } else {
      byMuscle[ex.muscle].push(entry);
    }
  }

  let text = Object.entries(byMuscle)
    .map(([m, names]) => `${m}：${names.join('、')}`)
    .join('\n');

  // 危险动作说明
  if (Object.keys(dangerNames).length > 0) {
    text += '\n\n⚠️ 危险动作安全提示：\n';
    text += Object.entries(dangerNames)
      .map(([n, w]) => `- ${n}：回复时必须追加"（注意：${w}）"`)
      .join('\n');
  }

  return text;
}

module.exports = { buildSystemPrompt };
