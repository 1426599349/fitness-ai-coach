Component({
  properties: {
    message: { type: Object, value: {} },
  },

  data: {
    formHeights: Array.from({length: 91}, (_, i) => 140 + i),
    formHeightIdx: 30,
    formWeights: Array.from({length: 151}, (_, i) => 30 + i),
    formWeightIdx: 40,
    formGender: 'male',
    formAges: Array.from({length: 80}, (_, i) => 10 + i),
    formAgeIdx: 15,
    formGoal: 'fat_loss',
    formPlace: 'home',
  },

  methods: {
    onFormHeight(e) { this.setData({ formHeightIdx: e.detail.value }); },
    onFormWeight(e) { this.setData({ formWeightIdx: e.detail.value }); },
    onFormGender(e) { this.setData({ formGender: e.currentTarget.dataset.g }); },
    onFormAge(e) { this.setData({ formAgeIdx: e.detail.value }); },
    onFormGoal(e) { this.setData({ formGoal: e.currentTarget.dataset.g }); },
    onFormPlace(e) { this.setData({ formPlace: e.currentTarget.dataset.p }); },
    onFormSubmit() {
      const data = {
        height_cm: this.data.formHeights[this.data.formHeightIdx],
        weight_kg: this.data.formWeights[this.data.formWeightIdx],
        gender: this.data.formGender,
        age: this.data.formAges[this.data.formAgeIdx],
        fitness_goal: this.data.formGoal,
        place: this.data.formPlace,
      };
      this.triggerEvent('action', { action: 'submit_profile', data });
    },
    onChoosePlace(e) {
      this.triggerEvent('action', { action: 'choose_place', place: e.currentTarget.dataset.place });
    },
    onWorkoutAction(e) { this.triggerEvent('action', e.detail); },
    onRegenerateMeal() { this.triggerEvent('action', { action: 'regenerate_meal' }); },
  },
});
