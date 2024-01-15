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
      required: [true, 'A property must be of type land or house'],
      enum: ['house', 'land'],
      lowercase: true,
    },

    purpose: {
      type: String,
      enum: ['rent', 'sell'],
      required: [true, 'A house must have a purpose'],
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
      required: [true, 'A property must have an owner'],
      type: mongoose.Schema.Types.ObjectId,
    },

    location: {
      type: locationSchema,
      required: [true, 'A property must have gps coordinates'],
    },

    // documented: {
    //   type: Boolean,
    // },

    address: {
      type: String,
      required: [true, 'A property must have an address'],
      lowercase: true,
    },

    imagesNames: [imageSchema],

    area: {
      type: Number,
      required: [true, 'Area is required'],
    },

    areaBuilt: {
      type: Number,
      required: [
        function () {
          this.type === 'house';
        },
        'Area built is required',
      ],
      default: function () {
        // if property is a house and user did not set this property set to area
        return this.type === 'house' ? this.area : undefined;
      },
      validate: {
        validator,
        message: 'area built is only for a house',
      },
    },

    areaUnit: {
      type: String,
      required: [true, 'Area unit is required'],
      default: 'm²',
    },

    title: {
      type: String,
      max: [60, 'A title cannot exceed 60 characters'],
      required: [true, 'A property needs a title'],
    },

    description: {
      type: String,
      max: [1500, 'The description cannot be longer than 512 characters'],
    },

    status: {
      type: String,
      enum: ['unlisted', 'listed', 'pending', 'sold', 'rented'],
      default: 'unlisted',
    },

    rooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'A house must have rooms',
      ],
      validate: {
        validator,
        message: 'Rooms are only for a house',
      },
    },

    bathrooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'bathrooms is required',
      ],
      validate: {
        validator,
        message: 'Bathrooms are only for a house',
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
        'kitchens is required',
      ],
      validate: {
        validator,
        message: 'kitchens is only for houses',
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
        'garages is required',
      ],
      validate: {
        validator,
        message: 'Garages are only for a house',
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
        message: 'Dining rooms are only for a house',
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
        message: 'Living rooms are only for a house',
      },
    },

    yearBuilt: {
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
    },

    // cloturé
    fenced: {
      type: Boolean,
      default: function () {
        return this.type === 'house' ? false : undefined;
      },
      required: [true, 'Fenced is required'],
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
        'pools is required',
      ],
      validate: {
        validator,
        message: 'Pool is only for a house',
      },
    },
    tags: [String],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// indexes

// propertySchema.index({
//   location: '2dsphere',
// });

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
  // account clone
  const property = this.toObject();
  // remove props from user object
  deleteProps(property, 'imagesNames', '__v');
  // return value will be sent to client
  return property;
};

const Property = mongoose.model('Property', propertySchema);

Property.on('index', e => {
  console.log(e);
});
// EXPORTS

export default Property;
