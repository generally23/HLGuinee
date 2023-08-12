import mongoose from 'mongoose';

// SCHEMA
const offerSchema = new mongoose.Schema(
  {
    offererId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true],
    },
    offerPrice: {
      type: Number,
    },
    paymentType: {
      type: String,
      enum: ['cash', 'check', 'transfer'],
      required: [true],
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true],
    },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

// virtuals
offerSchema.virtual('offerer', {
  ref: 'Account',
  localField: 'offererId',
  foreignField: '_id',
  justOne: true,
});

offerSchema.virtual('property', {
  ref: 'Property',
  localField: 'propertyId',
  foreignField: '_id',
  justOne: true,
});

const Offer = mongoose.model('Offer', offerSchema);

// EXPORTS

export default Offer;
