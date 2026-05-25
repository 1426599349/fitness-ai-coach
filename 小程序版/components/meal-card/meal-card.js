Component({
  properties: {
    data: {
      type: Object,
      value: {},
    },
  },

  methods: {
    onRegenerate() {
      this.triggerEvent('regenerate');
    },
  },
});
