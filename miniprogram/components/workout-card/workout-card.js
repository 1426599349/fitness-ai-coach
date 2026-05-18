Component({
  properties: {
    data: {
      type: Object,
      value: {},
    },
  },

  data: {
    expandedDays: {},
  },

  methods: {
    onToggleDay(e) {
      const index = e.currentTarget.dataset.index;
      const expandedDays = { ...this.data.expandedDays };
      expandedDays[index] = !expandedDays[index];
      this.setData({ expandedDays });
    },
  },
});
