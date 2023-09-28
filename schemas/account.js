import mongoose from 'mongoose';
import argon from 'argon2';
import { deleteProps, hashToken } from '../utils';
import crypto from 'crypto';
import emailValidator from 'email-validator';
import { ServerError } from '../handlers/errors';

// SCHEMA
const accountSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
      minlength: [4, 'Firstname cannot be less than 4 characetrs'],
      maxlength: [15, 'Firstname cannot exceed 15 characters'],
      required: [true, 'Firstname is required'],
      lowercase: true,
    },
    lastname: {
      type: String,
      minlength: [2, 'Lastname cannot be less than 2 characetrs'],
      maxlength: [10, 'Lastname cannot exceed 10 characters'],
      required: [true, 'Lastname is required'],
      lowercase: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: [true, 'Email already exist'],
      lowercase: true,
      validate: {
        validator(value) {
          return emailValidator.validate(value);
        },
        message: 'Invalid email address',
      },
    },
    contacts: {
      type: [{ type: String, required: true }],
      validate: [numbers => numbers.length <= 3, 'Phone numbers max out at 3'],
    },
    role: {
      type: String,
      enum: ['admin', 'sub-admin', 'agent', 'client'],
      required: [true, 'An must have a role'],
      default: 'client',
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
    },
    avatarNames: [String],
    dob: {
      type: Date,
    },
    tokens: [String],
    resetToken: {
      type: String,
    },

    resetTokenExpirationDate: Date,

    ip: {
      type: String,
    },
    signedIn: {
      type: Date,
    },
    signedOut: {
      type: Date,
    },
    verified: {
      type: Boolean,
      required: [true, 'Verified is required'],
      default: false,
    },
    verificationCode: String,

    verificationCodeExpirationDate: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// virtuals
accountSchema.virtual('avatarUrls').get(function () {
  return this.avatarNames.map(name => `${process.env.CLOUDFRONT_URL}/${name}`);
});

/** HOOKS */

// hash password before saving it
accountSchema.pre('save', async function (next) {
  // user account
  const account = this;
  // move to next midware if password hasn't changed
  if (!account.isModified('password')) return next();
  // min and max length required because pwd is being modified to hash pre save, and hash is long
  // pwd minlength
  const minlength = 8;
  // pwd max length
  const maxlength = 32;

  const { password } = account;

  const passwordLength = password.length;

  console.log(password);

  if (password < passwordLength || passwordLength > maxlength) {
    return next(
      new ServerError('Your password is either too short or too long', 400)
    );
  }

  // hash pwd
  const hash = await argon.hash(password);

  // assign hash to account
  account.password = hash;

  // move to the next middleware
  next();
});

/** HOOKS END **/

/** METHODS **/

accountSchema.methods.validatePassword = async function (password = '') {
  const account = this;

  return await argon.verify(account.password, password);
};

accountSchema.methods.generateResetToken = async function () {
  const account = this;

  // create reset token string
  const resetToken = crypto.randomBytes(40).toString('hex');

  // append hashed token to account
  account.resetToken = hashToken(resetToken);

  // set expiration date for the token
  account.resetTokenExpirationDate = Date.now() + 15 * 60 * 1000;

  await account.save();

  return resetToken;
};

accountSchema.methods.generateVerificationCode = async function () {
  const account = this;

  // create reset token string
  const code = crypto.randomBytes(40).toString('hex');

  // append hashed token to account
  account.verificationCode = hashToken(code);

  // set expiration date for the token
  account.verificationCodeExpirationDate = Date.now() + 15 * 60 * 1000;

  await account.save();

  return code;
};

accountSchema.methods.toJSON = function () {
  // account clone
  const account = this.toObject();
  // remove props from user object
  deleteProps(
    account,
    'password',
    '__v',
    'reset_token',
    'reset_token_expiration_date',
    'tokens'
  );
  // return value will be sent to client
  return account;
};

const Account = mongoose.model('Account', accountSchema);

// EXPORTS
export default Account;
