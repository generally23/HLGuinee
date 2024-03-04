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
    required: [true, 'Un bien doit avoir des coordonées GPS'],
    validator: {
      validate(value) {
        const [longitude, latitude] = value;

        // values must be 2 Numbers
        return (
          value.length === 2 &&
          typeof longitude === 'number' &&
          typeof latitude === 'number'
        );
      },
      message:
        'Les coordonnées GPS doivent avoir une longitude et une latitude',
    },
  },
});
