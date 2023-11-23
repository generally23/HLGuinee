import { Schema } from 'mongoose';

export const imageSchema = new Schema({
  sourceName: {
    type: String,
    required: [true, 'sourceName is required'],
  },
  names: [String],
});
