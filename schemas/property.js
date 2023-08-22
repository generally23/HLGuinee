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
      required: [true, 'A property has to have an owner'],
      unique: [true],
      type: mongoose.Schema.Types.ObjectId,
    },
    price: {
      type: Number,
      required: [true, 'A property needs a price'],
    },
    location: {
      type: locationSchema,
      required: [true, 'A property must have gps coordinates'],
    },

    documented: {
      type: Boolean,
    },
    imagesNames: [imageSchema],
    dimension: {},
    title: {
      type: String,
      required: [true, 'A property needs a title'],
    },
    story: {
      type: String,
    },
    status: {
      type: String,
      enum: ['available', 'pending', 'sold'],
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

    tags: String,
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

// indexes
propertySchema.index({
  title: 'text',
  story: 'text',
  location: '2dsphere',
  tags: 'text',
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

// EXPORTS

export default Property;
