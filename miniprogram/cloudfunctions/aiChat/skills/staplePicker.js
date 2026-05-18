/**
 * 每日主食随机生成 Skill（Node.js版）
 */
const foods = require('../data/foods.json');

function pickStaple(excludeNames = []) {
  const pool = foods.staples.filter(s => !excludeNames.includes(s.name));
  if (pool.length === 0) return foods.staples[Math.floor(Math.random() * foods.staples.length)];
  return pool[Math.floor(Math.random() * pool.length)];
}

function generateDailyStaple(yesterdayStapleName) {
  const exclude = yesterdayStapleName ? [yesterdayStapleName] : [];
  return pickStaple(exclude);
}

function regenerateStaple(currentName, yesterdayName) {
  const exclude = [];
  if (currentName) exclude.push(currentName);
  if (yesterdayName) exclude.push(yesterdayName);
  return pickStaple(exclude);
}

module.exports = { generateDailyStaple, regenerateStaple };
