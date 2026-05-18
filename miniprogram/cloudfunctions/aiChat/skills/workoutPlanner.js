/**
 * 健身方案生成 Skill（规则引擎兜底）
 * 直接从动作库中选动作，保证每个动作都在库里
 */
const exercisesModule = require('../data/exercises.js');

const WEEKLY_SPLIT = [
  { day: 1, label: 'Day1', focus: '胸+三头', muscles: ['胸', '臂'] },
  { day: 2, label: 'Day2', focus: '背+二头', muscles: ['背', '臂'] },
  { day: 3, label: 'Day3', focus: '休息', muscles: [] },
  { day: 4, label: 'Day4', focus: '腿+肩', muscles: ['腿', '肩'] },
  { day: 5, label: 'Day5', focus: '核心+有氧', muscles: ['腹', '核心', '有氧', '功能性'] },
  { day: 6, label: 'Day6', focus: '休息', muscles: [] },
  { day: 7, label: 'Day7', focus: '休息', muscles: [] },
];

function generateWorkoutPlan(place, fitnessLevel, days = 7) {
  const pool = exercisesModule.filterForPrompt(place, fitnessLevel);
  const levelOrder = { '初级': 0, '中级': 1, '高级': 2 };
  const maxLv = (levelOrder[fitnessLevel] || 0) + 1;

  function pickForDay(targetMuscles, count) {
    const candidates = [];
    const used = new Set();
    for (const ex of pool) {
      const lv = levelOrder[ex.level] || 0;
      if (lv > maxLv) continue;
      if (!targetMuscles.some(m => ex.muscle === m)) continue;
      if (used.has(ex.name)) continue;
      used.add(ex.name);
      candidates.push(ex);
    }
    // 随机选 count 个
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(ex => ({
      name: ex.name,
      sets: Math.floor(Math.random() * 3) + 2,   // 2-4组
      reps: Math.floor(Math.random() * 5) + 8,   // 8-12次
      weight: place === 'home' ? 0 : Math.floor(Math.random() * 15) + 5,
      notes: '保持标准动作',
    }));
  }

  const schedule = [];
  for (const slot of WEEKLY_SPLIT.slice(0, days)) {
    if (slot.focus === '休息') {
      schedule.push({ day: slot.day, label: slot.label, focus: '休息', rest: true, exercises: [] });
      continue;
    }
    const count = Math.floor(Math.random() * 2) + 3; // 3-4个动作
    schedule.push({ day: slot.day, label: slot.label, focus: slot.focus, rest: false, exercises: pickForDay(slot.muscles, count) });
  }

  return { place, days, fitness_level: fitnessLevel, schedule, startDate: new Date().toISOString().slice(0, 10) };
}

module.exports = { generateWorkoutPlan };
