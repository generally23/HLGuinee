export const price = {
  type: Number,
  required: [true, 'A property needs a price'],
  validate: [
    {
      validator: function () {
        const { purpose, price } = this;

        return (
          (purpose === 'rent' && price >= 100000) ||
          (purpose === 'sell' && price >= 10000000)
        );
      },
      message: 'A property price cannot be less than this amount',
    },
    {
      validator: function () {
        const { purpose, price } = this;

        return (
          (purpose === 'rent' && price <= 10000000) ||
          (purpose === 'sell' && price <= 900000000000)
        );
      },
      message: 'A property price cannot exceed this amount',
    },
  ],
};
