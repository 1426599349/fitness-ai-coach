const api = require('../../utils/api.js');
const analytics = require('../../utils/analytics.js');

Page({
  data: { plan: null, loading: true },

  onShow() {
    analytics.track(analytics.EVENTS.view_weekly_plan);
    const cached = this.loadFromCache();
    if (cached) {
      this.setData({ plan: cached, loading: false });
    } else {
      this.setData({ loading: true });
    }
    this.loadFromCloud();
  },

  loadFromCache() {
    try {
      const raw = wx.getStorageSync('weeklyPlan');
      if (raw && raw.days) {
        return this.formatPlan(raw);
      }
    } catch (e) {}
    return null;
  },

  async loadFromCloud() {
    try {
      const res = await api.callCloudFunction('aiChat', { action: 'get_weekly_plan' });
      const planData = res && res.plan;
      if (planData && planData.days) {
        const plan = this.formatPlan(planData);
        const edits = wx.getStorageSync('planEdits') || {};
        plan.days.forEach(d => {
          d.exercises.forEach(ex => {
            if (edits[ex.name]) {
              ex.sets = edits[ex.name].sets;
              ex.reps = edits[ex.name].reps;
              ex.weight = edits[ex.name].weight;
              ex.difficulty = edits[ex.name].difficulty;
            }
          });
        });
        wx.setStorageSync('weeklyPlan', JSON.stringify(planData));
        this.setData({ plan, loading: false });
        return;
      }
    } catch (e) {}
    this.setData({ loading: false });
  },

  savePlan(plan) {
    this.setData({ plan });
    const raw = { days: plan.days.map(d => ({
      label: d.label, day: d.day, focus: d.focus, rest: d.rest, exercises: d.exercises,
    })), startDate: plan.startDate };
    wx.setStorageSync('weeklyPlan', JSON.stringify(raw));
  },

  // 格式化：Day1 → Day1 (5/18) 等，加上完成状态
  formatPlan(raw) {
    const startDate = raw.startDate || new Date().toISOString().slice(0, 10);
    const completed = wx.getStorageSync('planCompleted') || {};

    const dayNames = ['Day1','Day2','Day3','Day4','Day5','Day6','Day7'];
    const days = dayNames.map((label, i) => {
      // 找匹配的day或按索引取
      const d = (raw.days || []).find(d => d.label === label) || (raw.days || [])[i];
      // 计算实际日期
      const s = new Date(startDate);
      s.setDate(s.getDate() + i);
      const dateStr = `${s.getMonth() + 1}/${s.getDate()}`;

      if (!d) {
        const isRest = i === 2 || i >= 5;
        return {
          label, dateStr, day: i + 1, focus: isRest ? '休息' : '训练',
          rest: isRest, exercises: [],
        };
      }

      const exercises = (d.exercises || []).map((ex, exIdx) => {
        const key = `${startDate}_${label}_${exIdx}`;
        return {
          ...ex,
          sets: ex.sets || 3,
          reps: ex.reps || 10,
          weight: ex.weight || 0,
          difficulty: 'medium',
          notes: ex.notes || '保持标准动作',
          completed: !!completed[key],
          _key: key,
        };
      });

      return {
        label, dateStr, day: d.day || i + 1,
        focus: d.focus || '训练',
        rest: d.rest || d.focus === '休息' || (d.exercises && d.exercises.length === 0),
        exercises,
      };
    });

    return { weekLabel: `${startDate} 起 7天`, startDate, days };
  },

  // 勾选完成
  onToggleComplete(e) {
    const { dayidx, exidx } = e.currentTarget.dataset;
    const plan = this.data.plan;
    if (!plan) return;
    const ex = plan.days[dayidx].exercises[exidx];
    if (!ex) return;
    ex.completed = !ex.completed;

    const completed = wx.getStorageSync('planCompleted') || {};
    if (ex.completed) {
      completed[ex._key] = true;
      analytics.track(analytics.EVENTS.exercise_done);
    } else {
      delete completed[ex._key];
    }
    wx.setStorageSync('planCompleted', completed);
    this.savePlan({ ...plan });
  },

  _saveEdit(ex) {
    const edits = wx.getStorageSync('planEdits') || {};
    edits[ex.name] = { sets: ex.sets, reps: ex.reps, weight: ex.weight, difficulty: ex.difficulty };
    wx.setStorageSync('planEdits', edits);
  },

  onSetDifficulty(e) {
    const { day, exidx, level } = e.currentTarget.dataset;
    const plan = this.data.plan;
    if (!plan) return;
    const ex = plan.days[day].exercises[exidx];
    if (!ex) return;
    ex.difficulty = level;
    this._saveEdit(ex);
    this.savePlan({ ...plan });
    wx.showToast({ title: level === 'easy' ? '已标记太简单' : level === 'hard' ? '已标记太难' : '适中', icon: 'none' });
  },

  onEditParam(e) {
    const { day, exidx, field } = e.currentTarget.dataset;
    const plan = this.data.plan;
    const ex = plan.days[day].exercises[exidx];

    wx.showModal({
      title: '修改' + (field === 'sets' ? '组数' : field === 'reps' ? '次数' : '重量'),
      editable: true,
      placeholderText: String(ex[field]),
      success: (res) => {
        if (res.confirm && res.content) {
          const val = parseInt(res.content);
          if (!isNaN(val) && val > 0 && val < 100) {
            ex[field] = val;
            ex.difficulty = 'custom';
            this._saveEdit(ex);
            this.savePlan({ ...plan });
          }
        }
      },
    });
  },
});
