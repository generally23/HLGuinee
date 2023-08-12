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
  },
});

// SCHEMA
const propertySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true],
      enum: ['house', 'land'],
      lowercase: true,
    },
    ownerId: {
      required: [true],
      unique: [true],
      type: mongoose.Schema.Types.ObjectId,
    },
    price: {
      type: Number,
      required: [true],
    },
    location: {
      type: locationSchema,
      required: [true],
    },

    documented: {
      type: Boolean,
    },
    imagesNames: [imageSchema],
    dimension: {},
    title: {
      type: String,
      required: [true],
    },
    story: {
      type: String,
    },
    status: {
      type: String,
      enum: ['available', 'pending', 'sold'],
    },

    tags: [String],
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

  return imagesNames.map((image) => {
    return {
      src: `${baseURI}/${image.sourceName}`,
      srcset: image.names.map((name) => `${baseURI}/${name}`),
    };
  });
});

// hooks

// methods

const Property = mongoose.model('Property', propertySchema);

// EXPORTS

export default Property;

// location = { type: 'Point', coordinates: [79, 88] }
