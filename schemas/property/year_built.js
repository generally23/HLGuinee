export const yearBuilt = {
  type: Number,

  // minium property built year
  min: [1800, 'A property built year must be from year 1800'],

  // don't allow property buil year to be in the future
  max: [
    new Date().getFullYear(),
    `A property built year can't be in the future`,
  ],

  required: [
    function () {
      return this.type === 'house';
    },
    'A house property must have a year built',
  ],
};
