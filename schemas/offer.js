import mongoose from 'mongoose';

// SCHEMA
const offerSchema = new mongoose.Schema(
  {
    offererId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'ID of offerer is required'],
    },
    offerPrice: {
      type: Number,
      required: [true, 'Offer price is required'],
    },
    paymentType: {
      type: String,
      enum: ['cash', 'check', 'transfer'],
      required: [true, 'A payment type for an offer is required'],
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'ID of property receiving offer is required'],
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
