import mongoose from 'mongoose';
import { deleteProps, preProcessImage } from '../../utils';
import { locationSchema } from './location';
import { imageSchema } from './image';
import { price } from './price';

// create ascending & desc index in a field in one go
const createAscDescIndex = (schema, field) => {
  schema.index({ [field]: 1 });
  schema.index({ [field]: -1 });
};

// house validator
const validator = value => value !== 'house';

// SCHEMA
const propertySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, 'Un bien doit être soit une maison où un terrain'],
      enum: ['house', 'land'],
      lowercase: true,
    },

    purpose: {
      type: String,
      enum: ['rent', 'sell'],
      required: [true, 'Un motif du bien est réquis, soit a vendre où a louer'],
      validate: {
        validator(value) {
          // property can't be land and be rented for now
          if (this.type === 'land' && value === 'rent') return false;
          return true;
        },
      },
    },

    price,

    // only allowed for houses
    rentPeriod: {
      type: String,
      default: function () {
        return this.type === 'house' ? 'monthly' : undefined;
      },
      enum: ['monthly'],
    },

    ownerId: {
      required: [true, 'Un bien doit avoir un propriétaire'],
      type: mongoose.Schema.Types.ObjectId,
    },

    location: {
      type: locationSchema,
      required: [true, 'Un bien doit avoir une localisation GPS'],
    },

    // documented: {
    //   type: Boolean,
    // },

    address: {
      type: String,
      required: [true, 'Un bien doit avoir un quartier'],
      lowercase: true,
    },

    imagesNames: [imageSchema],

    area: {
      type: Number,
      required: [true, 'Surface est réquise'],
    },

    areaBuilt: {
      type: Number,
      required: [
        function () {
          this.type === 'house';
        },
        'Surface Batie est réquise',
      ],
      default: function () {
        // if property is a house and user did not set this property set to area
        return this.type === 'house' ? this.area : undefined;
      },
      validate: {
        validator,
        message: 'Surface Batie est permis que pour les maisons',
      },
    },

    areaUnit: {
      type: String,
      required: [true, 'Unité de surface réquise'],
      default: 'm²',
    },

    title: {
      type: String,
      max: [60, 'Un titre ne peut pas être plus de 60 lettres'],
      required: [true, `Un bien a besoin d'un titre`],
    },

    description: {
      type: String,
      required: ['Une description est réquise'],
      max: [1500, 'Une description ne peut pas être plus de 512 lettres'],
    },

    status: {
      type: String,
      required: [true, 'Status est réquis'],
      enum: ['unlisted', 'listed', 'pending', 'sold', 'rented'],
      default: 'unlisted',
    },

    rooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'Chambres est réquise',
      ],
      validate: {
        validator,
        message: 'Chambres est permis que pour les maisons',
      },
    },

    bathrooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'Douches est réquis is required',
      ],
      validate: {
        validator,
        message: 'Douches est permis que pour les maisons',
      },
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
      validate: {
        validator,
        message: 'Cuisine est permis que pour les maisons',
      },
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
      validate: {
        validator,
        message: 'Les garages sont permis que pour les maisons',
      },
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
      validate: {
        validator,
        message: 'Les sale à manger sont permis que pour les maisons',
      },
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
      validate: {
        validator,
        message: 'Les salons sont permis que pour les maisons',
      },
    },

    yearBuilt: {
      type: Number,
      // minium property built year
      min: [1800, 'Un bien built year must be from year 1800'],
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

    // cloturé
    fenced: {
      type: Boolean,
      default: function () {
        return this.type === 'house' ? false : undefined;
      },
      required: [true, 'Cloture est réquise'],
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
      ],
      validate: {
        validator,
        message: 'Seul une maison possède de piscine',
      },
    },
    tags: [String],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Index all sortable fields

createAscDescIndex(propertySchema, 'price');
createAscDescIndex(propertySchema, 'title');
createAscDescIndex(propertySchema, 'rooms');
// createAscDescIndex(propertySchema, 'address');
createAscDescIndex(propertySchema, 'area');

// virtuals
propertySchema.virtual('owner', {
  ref: 'Account',
  localField: 'ownerId',
  foreignField: '_id',
  justOne: true,
});

propertySchema.virtual('images').get(function () {
  // property
  return preProcessImage(this);
});

// methods
propertySchema.methods.toJSON = function () {
  // property clone
  const property = this.toObject();

  // remove props from user object
  deleteProps(property, 'imagesNames', '__v');

  // return value will be sent to client
  return property;
};

const Property = mongoose.model('Property', propertySchema);

export default Property;
