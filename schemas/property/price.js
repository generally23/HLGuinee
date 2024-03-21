export const price = {
  type: Number,
  required: [true, 'Un bien doit avoir un prix'],
  validate: [
    {
      validator: function () {
        const { purpose, price } = this;

        const rentMin = 100_000;
        const rentMax = 10_000_000;

        const buyMin = 10_000_000;
        const buyMax = 900_000_000_000;

        if (purpose === 'rent') return price >= rentMin && price <= rentMax;

        if (purpose === 'sell') return price >= buyMin && price <= buyMax;

        return false;
      },
      message:
        "Le prix d'un bien doit être entre 100.000FG et 10.000.000FG pour les maisons à louer et 10.000.000FG à 900.000.000.000FG pour les biens à vendre",
    },
  ],
};
