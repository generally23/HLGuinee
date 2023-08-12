import mongoose from 'mongoose';
import argon from 'argon2';
import { deleteProps, hashToken } from '../utils';
import crypto from 'crypto';

// SCHEMA
const accountSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
      required: [true],
    },
    lastname: {
      type: String,
      required: [true],
    },
    email: {
      type: String,
      required: [true],
      unique: [true],
    },
    contacts: {
      type: [{ type: String, required: true }],
      validate: [
        (numbers) => numbers.length <= 3,
        'Phone numbers max out at 3',
      ],
    },
    role: {
      type: String,
      enum: ['admin', 'sub-admin', 'agent', 'client'],
      required: [true],
      default: 'client',
    },
    password: {
      type: String,
      required: [true],
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
      required: [true],
    },
    signedIn: {
      type: Date,
    },
    signedOut: {
      type: Date,
    },
    verified: {
      type: Boolean,
      required: true,
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
  return this.avatarNames.map(
    (name) => `${process.env.CLOUDFRONT_URL}/${name}`
  );
});

/** HOOKS */

// hash password before saving it
accountSchema.pre('save', async function (next) {
  // user account
  const account = this;
  // stop execution here if password field has not changed
  if (!account.isModified('password')) return next();
  // min and max length required because pwd is being modified to hash pre save, and hash is long
  // pwd minlength
  const minlength = 8;
  // pwd max length
  const maxlength = 32;

  const { password } = account;

  console.log(password);

  if (password < minlength || password > maxlength) {
    // error
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
