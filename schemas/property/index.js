import mongoose from 'mongoose';
import {
  deleteProps,
  getPropertyThumbnail,
  preProcessImage,
} from '../../utils';
import { locationSchema } from './location';
import { imageSchema } from './image';
import { price } from './price';

// create ascending & desc index in a field in one go
const createAscDescIndex = (schema, field) => {
  schema.index({ [field]: 1 });
  schema.index({ [field]: -1 });
};

// house validator
// const validator = value => value !== 'house';

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
          if (this.type === 'land' && value !== 'sell') return false;
          return true;
        },
      },
    },

    price,

    // only allowed for houses
    // rentPeriod: {
    //   type: String,
    //   default: function () {
    //     return this.type === 'house' ? 'monthly' : undefined;
    //   },
    //   enum: ['monthly'],
    // },

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
      enum: ['reviewing', 'unlisted', 'listed', 'pending', 'sold', 'rented'],
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
    },

    bathrooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'Douches est réquis is required',
      ],
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
    },

    tags: [String],

    // platform related properties
    publishDate: Date,
    unPublishDate: Date,

    statusChangeDate: Date,

    paymentStatus: {
      type: String,
      enum: ['paid', 'unpaid'],
      default: 'unpaid',
    },
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

  property.images = preProcessImage(property);

  // append it a thumbnail image as the 1st image
  property.thumbnail = getPropertyThumbnail(property.images);

  // remove props from user object
  deleteProps(property, 'imagesNames', '__v');

  // return value will be sent to client
  return property;
};

propertySchema.methods.changeStatus = async function (newStatus, errorMessage) {
  const allStates = ['unlisted', 'listed', 'pending', 'sold', 'rented'];

  const transitions = {
    listed: allStates,
    unlisted: ['unlisted', 'listed'],
    sold: ['sold', 'listed'],
    rented: ['rented', 'listed'],
    pending: allStates,
  };
  // get status from property
  const property = this;

  const isAllowed = transitions[property.status].includes(newStatus);

  if (!isAllowed) throw Error(errorMessage);

  property.status = newStatus;
  property.statusChangeDate = Date.now();

  return property.save();
};

propertySchema.methods.list = async function () {
  // make sure user has payed

  await this.changeStatus('listed', 'This property already listed!');
};

propertySchema.methods.unlist = async function () {
  await this.changeStatus('unlisted', "You can't unlist this property now");
};

propertySchema.methods.markPending = async function () {
  await this.changeStatus('pending', 'There are some errors in your data');
};

propertySchema.methods.isBuyout = function () {
  return this.purpose === 'sell';
};

propertySchema.methods.isRental = function () {
  return this.purpose === 'rent';
};

propertySchema.methods.markSold = async function () {
  // make sure this is a buyout
  if (!this.isBuyout()) throw Error("Can't mark as sold a renting property!");

  await this.changeStatus('sold', 'This property is not available for sale');
};

propertySchema.methods.markRented = async function () {
  // make sure this is a rental
  if (!this.isRental()) throw Error("Can't mark as rent a selling property!");

  await this.changeStatus('rented', 'This property is not available for rent');
};

const Property = mongoose.model('Property', propertySchema);

export default Property;
