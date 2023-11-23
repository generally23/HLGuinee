import { Schema } from 'mongoose';

export const locationSchema = new Schema({
  type: {
    type: String,
    required: [true],
    enum: {
      values: ['Point'],
      message: 'Given location type is wrong',
    },
    default: 'Point',
  },
  coordinates: {
    type: [Number],
    required: [true, 'location coordinates are required'],
    validator: {
      validate(value) {
        // values must be 2 Numbers
        return value.length === 2;
      },
      message: 'Coordinates need a Longitude and a Latitude',
    },
  },
});
