import { Schema } from 'mongoose';

const houseSchema = new Schema({
  areaBuilt: {
    type: Number,
    required: [
      function () {
        this.type === 'house';
      },
      'Surface Batie est réquise',
    ],
    // default: function () {
    //   // if property is a house and user did not set this property set to area
    //   return this.type === 'house' ? this.area : undefined;
    // },
    // validate: {
    //   validator() {
    //     return this.type === 'house';
    //   },
    //   message: 'Surface Batie est permis que pour les maisons',
    // },
  },

  rooms: {
    type: Number,
    required: [
      function () {
        return this.type === 'house';
      },
      'Chambres est réquise',
    ],
    // validate: {
    //   validator,
    //   message: 'Chambres est permis que pour les maisons',
    // },
  },

  bathrooms: {
    type: Number,
    required: [
      function () {
        return this.type === 'house';
      },
      'Douches est réquis is required',
    ],
    // validate: {
    //   validator,
    //   message: 'Douches est permis que pour les maisons',
    // },
  },

  kitchens: {
    type: Number,
    default: function () {
      return this.type === 'house' ? 0 : undefined;
    },
    required: [
      function () {
        return this.type === 'house';
      },
      'Cuisine est réquise',
    ],
    // validate: {
    //   validator,
    //   message: 'Cuisine est permis que pour les maisons',
    // },
  },

  garages: {
    type: Number,
    default: function () {
      return this.type === 'house' ? 0 : undefined;
    },
    required: [
      function () {
        return this.type === 'house';
      },
      'Garages est réquis',
    ],
    // validate: {
    //   validator,
    //   message: 'Les garages sont permis que pour les maisons',
    // },
  },

  diningRooms: {
    type: Number,
    default: function () {
      return this.type === 'house' ? 0 : undefined;
    },
    required: [
      function () {
        return this.type === 'house';
      },
      'diningRooms is required',
    ],
    // validate: {
    //   validator,
    //   message: 'Les sale à manger sont permis que pour les maisons',
    // },
  },

  livingRooms: {
    type: Number,
    default: function () {
      return this.type === 'house' ? 0 : undefined;
    },
    required: [
      function () {
        return this.type === 'house';
      },
      'livingRooms is required',
    ],
    // validate: {
    //   validator,
    //   message: 'Les salons sont permis que pour les maisons',
    // },
  },

  yearBuilt: {
    type: Number,
    // minium property built year
    min: [1800, 'Un bien ne peut pas etre construit avant 1800'],
    // don't allow property buil year to be in the future
    max: [
      new Date().getFullYear(),
      'Un bien ne peut pas etre construit dans le future',
    ],
    required: [
      function () {
        return this.type === 'house';
      },
      'Une maison doit avoir une année de construction',
    ],
  },

  pools: {
    type: Number,

    default: function () {
      return this.type === 'house' ? 0 : undefined;
    },
    required: [
      function () {
        return this.type === 'house';
      },
      'Piscines sont requisent',
    ],
    // validate: {
    //   validator,
    //   message: 'Seul une maison possède de piscine',
    // },
  },

  // only allowed for houses
  //   rentPeriod: {
  //     type: String,
  //     default: function () {
  //       return this.type === 'house' ? 'monthly' : undefined;
  //     },
  //     enum: ['monthly'],
  //   },
});

export default houseSchema;
