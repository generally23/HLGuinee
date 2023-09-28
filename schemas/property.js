import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema({
  sourceName: {
    type: String,
    required: [true],
  },
  names: [String],
});

const locationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: [true],
    enum: ['Point'],
    default: 'Point',
  },
  coordinates: {
    type: [Number],
    required: [true],
    validator: {
      validate(value) {
        console.log(value);
        return value.length === 2;
      },
      message: 'Coordinates need a Longitude and a Latitude',
    },
  },
});

// helper functions
// this function return true if type === house

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
    ownerId: {
      required: [true, 'A property must have an owner'],
      type: mongoose.Schema.Types.ObjectId,
    },
    price: {
      type: Number,
      required: [true, 'A property needs a price'],
      min: [5000000, 'A property price cannot be less than this amount'],
      // price must not be past billions
      max: [900000000000, 'A property price cannot exceed this amount'],
    },
    location: {
      type: locationSchema,
      required: [true, 'A property must have gps coordinates'],
    },
    // documented: {
    //   type: Boolean,
    // },
    imagesNames: [imageSchema],
    // area
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
        return this.area;
      },
      validate: {
        validator,
        message: 'area built is only for a house',
      },
    },
    // area unit
    areaUnit: {
      type: String,
      required: [true, 'Area unit is required'],
      default: 'square meter',
    },

    title: {
      type: String,
      max: [60, 'A title cannot exceed 60 characters'],
      required: [true, 'A property needs a title'],
    },
    // description
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: ['available', 'pending', 'sold'],
    },
    published: {
      type: Boolean,
      required: [true, 'A property must have a published field'],
      default: false,
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
    // bathrooms: {
    //   type: Number,
    //   validate: {
    //     validator,
    //     message: 'Bathrooms are only for a house',
    //   },
    // },
    externalBathrooms: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'External bathrooms is required',
      ],
      validate: {
        validator,
        message: 'External Bathrooms are only for a house',
      },
    },

    internalBathrooms: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'Internal bathrooms is required',
      ],
      validate: {
        validator,
        message: 'Internal Bathrooms are only for a house',
      },
    },
    cuisine: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Cuisine is required',
      ],
      validate: {
        validator,
        message: 'Cuisine is only for houses',
      },
    },
    garages: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'Garage is required',
      ],
      validate: {
        validator,
        message: 'Garage is only for a house',
      },
    },
    // sale a manger
    diningRooms: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'Dining room is required',
      ],
      validate: {
        validator,
        message: 'Dining rooms are only for a house',
      },
    },
    // salon
    livingRooms: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'Living room is required',
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
      default: false,
      required: [true, 'Fenced is required'],
    },

    pool: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Pool is required',
      ],
      validate: {
        validator,
        message: 'Pool is only for a house',
      },
    },
    tags: String,
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

// indexes
propertySchema.index({
  title: 'text',
  story: 'text',
  tags: 'text',
});

propertySchema.index({
  location: '2dsphere',
});

// virtuals
propertySchema.virtual('owner', {
  ref: 'Account',
  localField: 'ownerId',
  foreignField: '_id',
  justOne: true,
});

propertySchema.virtual('images').get(function () {
  const property = this;
  const { imagesNames } = property;
  const baseURI = process.env.CLOUDFRONT_URL;

  return imagesNames.map(image => {
    return {
      src: `${baseURI}/${image.sourceName}`,
      srcset: image.names.map(name => `${baseURI}/${name}`),
    };
  });
});

// hooks

// methods

const Property = mongoose.model('Property', propertySchema);

Property.on('index', e => {
  console.log(e);
});
// EXPORTS

export default Property;
