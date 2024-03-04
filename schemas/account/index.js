import mongoose from 'mongoose';
import argon from 'argon2';
import { deleteProps, hashToken } from '../../utils';
import crypto from 'crypto';
import emailValidator from 'email-validator';
import { ServerError } from '../../handlers/errors';

// SCHEMA
const accountSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
      minlength: [4, 'Prénom ne peut pas etre moins de 4 lettres'],
      maxlength: [15, 'Prénom ne peut pas etre plus de 15 lettres'],
      required: [true, 'Prénom est réquis'],
    },

    lastname: {
      type: String,
      minlength: [4, 'Nom ne peut pas etre moins de 2 lettres'],
      maxlength: [15, 'Nom ne peut pas etre plus de 10 lettres'],
      required: [true, 'Nom est réquis'],
    },

    email: {
      type: String,
      required: [true, 'Email est réquis'],
      unique: [true, 'Ce email existe déjà'],
      lowercase: true,
      validate: {
        validator: value => emailValidator.validate(value),
        message: 'Addresse email non valide',
      },
    },

    phoneNumber: {
      type: String,
      // validate phone number
      validate: {
        validator: value => /^[67][05678]\d{7}$/.test(value),
        message: 'Numéro de teléphone non valide',
      },
    },

    role: {
      type: String,
      enum: ['admin', 'sub-admin', 'agent', 'client'],
      required: [true, 'Un compte doit avoir un role'],
      default: 'client',
    },

    password: {
      type: String,
      required: [true, 'Mot de passe réquis'],
    },

    avatarUrl: {
      type: String,
      default: 'http://192.169.1.196:9090/assets/images/avatar.avif',
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
      required: [true, 'Verifié est réquis'],
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

  if (passwordLength < minlength || passwordLength > maxlength) {
    return next(
      new ServerError('Ton mot de passe est soit trop petit ou trop long', 400)
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
    'tokens',
    'ip',
    'verificationCode',
    'verificationCodeExpirationDate',
    'resetToken',
    'resetTokenExpirationDate'
  );
  // return value will be sent to client
  return account;
};

const Account = mongoose.model('Account', accountSchema);

// EXPORTS
export default Account;
