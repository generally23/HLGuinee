'use strict';

var express = require('express');
var path = require('path');
var mongoose = require('mongoose');
var helmet = require('helmet');
var cors = require('cors');
var compress = require('compression');
var cookieParser = require('cookie-parser');
var multer = require('multer');
var sharp = require('sharp');
var clientS3 = require('@aws-sdk/client-s3');
var uid = require('uniqid');
var jsonwebtoken = require('jsonwebtoken');
var nodemailer = require('nodemailer');
var crypto = require('crypto');
var argon = require('argon2');
var dotenv = require('dotenv');

const createS3Instance = () => {
  // AWS CONFIGURATION
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_KEY;

  // Create a new S3 Instance
  return new clientS3.S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

const uploadToS3 = async (files = []) => {
  const s3Instance = createS3Instance();
  const bucketName = process.env.AWS_BUCKET_NAME;

  // Upload each given file to the s3 Bucket
  for (let file of files) {
    // command parameters
    const params = {
      Bucket: bucketName,
      ContentType: file.mimetype,
      Key: file.originalname,
      Body: file.buffer,
    };
    // create a new command
    const command = new clientS3.PutObjectCommand(params);
    // upload file to s3
    await s3Instance.send(command);
  }
};

const removeFroms3 = async (...fileNames) => {
  const s3Instance = createS3Instance();
  const bucketName = process.env.AWS_BUCKET_NAME;

  // Delete each given filename from the s3 Bucket
  for (let filename of fileNames) {
    // command parameters
    const params = {
      Bucket: bucketName,
      Key: filename,
    };
    // create a new command
    const command = new clientS3.DeleteObjectCommand(params);
    // Delete filename from s3
    await s3Instance.send(command);
  }
};

let ServerError$1 = class ServerError extends Error {
  constructor(
    message = 'Internal server error',
    statusCode = 500,
    details = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.operational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
};

const unroutable = (req, res, next) => {
  next(new ServerError$1(`The route ${req.originalUrl} is not found`, 404));
};

const catchAsyncErrors = (f) => {
  return (req, res, next) => f(req, res, next).catch(next);
};

const globalErrorHandler = (err, req, res, next) => {
  console.error('The Error Happened Here!!! : ', err);

  // const { ENVIRONMENT = 'dev' } = process.env;
  const { ENVIRONMENT = 'dev' } = process.env;

  if (ENVIRONMENT === 'dev') {
    // known error
    if (err.operational) {
      res.status(err.statusCode).json({ ...err, message: err.message });
    } else {
      // send error
      res.status(500).json({ err, message: err.message, stack: err.stack });
    }
  } else if (ENVIRONMENT === 'prod') {
    let error = { ...err, message: err.message };

    // duplicate key errors
    if (error.code === 11000) {
      const { keyValue } = error;
      let message = '';
      for (let key in keyValue) message += `wrong ${key}! `;
      error = new ServerError$1(message, 400);
    }

    // cast errors
    if (err.name === 'CastError') {
      error = new ServerError$1(`Invalid ${error.path}: ${error.value}`, 400);
    }

    // validation errors
    if (err.name === 'ValidationError') {
      const details = {};

      for (let key in error.errors) {
        details[key] = error.errors[key].properties.message;
      }

      error = new ServerError$1('Validation error', 400, details);
    }

    // multer errors
    if (err instanceof multer.MulterError) {
      error = new ServerError$1(err.message, 400);
    }

    if (error.operational) {
      res.status(error.statusCode).json({ message: error.message, ...error });
    } else {
      res
        .status(500)
        .json({ message: 'Something went wrong', statusCode: 500 });
    }
  }
};

const objectAssign = (source, target) => {
  if (!source || !target) {
    return;
  }
  for (let key in source) {
    if (source[key]) target[key] = source[key];
  }
};

// delete properties from a source object
const deleteProps = (src, ...props) => {
  props.forEach((prop) => delete src[prop]);
};

const generateJwt = (
  id,
  expiresIn = process.env.JWT_EXPIRATION_TIME || '30d'
) => {
  return jsonwebtoken.sign({ id }, process.env.JWT_SECRET_KEY || 'secret', {
    expiresIn,
  });
};

const uploader = (limits) => {
  limits = {
    fileSize: parseInt(process.env.MAX_IMAGE_SIZE) || 5000000,
    files: 1,
    ...limits,
  };
  const storage = multer.memoryStorage();
  // filter files to only accept images
  const fileFilter = (req, file, cb) => {
    const regex = /.+\/(jpg|jpeg|png|webp)$/;

    if (!file.mimetype.match(regex)) {
      // error
      return cb(new Error('Wrong file extension!'));
    }

    cb(null, true);
  };

  return multer({ storage, limits, fileFilter });
};

const isFullHd = async (file) => {
  if (!file) return;
  // get image dimensions
  const { width, height } = await sharp(file.buffer).metadata();
  // if width & height >= FHD image passes test
  if (width >= 1920 && height >= 1080) return true;
  // image fails test
  return false;
};

const createFileCopies = async (source, dimensions = []) => {
  if (!source) return;

  const copies = [];
  const all = [source];

  for (let dimension of dimensions) {
    const copy = { ...source };

    const { originalname } = copy;

    copy.originalname = `${originalname}-${dimension}`;

    copy.buffer = await sharp(source.buffer).resize(dimension).toBuffer();

    copies.push(copy);
    all.push(copy);
  }

  return { source, copies, all };
};

const convertToWebp = async (file, quality = 100) => {
  // return if no file is given
  if (!file) return;

  if (file.mimetype !== 'images/webp') {
    // convert to webp
    const converted = await sharp(file.buffer).webp({ quality }).toBuffer();

    console.log('file sizes: ', file.size, converted.byteLength);
    // only save converted if it's size is less than original file
    if (converted.byteLength < file.size) {
      console.log('converted');
      file.buffer = converted;
      file.mimetype = 'images/webp';
    }
  }

  return file;
};

const uploadAvatar = async (file, account, next) => {
  if (file && account) {
    // change avatar name
    file.originalname = `avatar-${account.id}`;
    // check if image is at least 1920x1080(FHD)
    const isAccepted = isFullHd(file);

    // send error if image is low quality < FHD
    if (!isAccepted) {
      return next(new ServerError$1('Please upload a high quality image', 400));
    }
    // convert original file to webp
    const webpAvatar = await convertToWebp(file);

    // make copies of account avatar/profile in the given dimensions
    const copyOutput = await createFileCopies(webpAvatar, [200, 400, 800]);
    const avatarFiles = copyOutput.all;

    // upload files to AWS S3
    await uploadToS3(avatarFiles);

    account.avatarNames = avatarFiles.map((avatar) => avatar.originalname);

    await account.save();
  }
};

const uploadPropertyImages = async (images, property, next) => {
  for (let image of images) {
    // rename property images
    image.originalname = `property-img-${uid()}`;

    // make sure images match our criterias
    const isHighRes = await isFullHd(image);

    // send error if images are not clear (hd)
    if (!isHighRes) {
      return next(new ServerError$1('Please upload high resolution images', 400));
    }

    // convert property image to webp to optimize images for web use
    const webpImage = await convertToWebp(image);

    // create versions or copies of original images (different dimensions)

    // dimensions are default chosen by me (developer)
    const dimensions = [500, 800];

    // create smaller image versions from original image uploaded by client
    const copyOutput = await createFileCopies(webpImage, dimensions);

    // original image + smaller versions of image
    const imageAndCopies = copyOutput.all;

    // upload images to s3
    await uploadToS3(imageAndCopies);

    // save image and its different versions info to db
    const imageObject = {
      sourceName: webpImage.originalname,
      names: imageAndCopies.map((img) => img.originalname),
    };
    // add imageObject to imageNames list
    property.imagesNames.push(imageObject);
    // persist to db
    await property.save();
  }
};

// create pages array out of a number of pages
const createPages = (numPages) => {
  let firstPage = 1;
  const pages = [];
  for (let i = firstPage; i <= numPages; i++) {
    pages.push(i);
  }
  return pages;
};

const paginateModel = async (
  Model,
  searchObject = {},
  filterObject = {},
  sortStr = '',
  pagingInfo = { page: 1, limit: 15 },
  // all these must be popolated
  ...populates
) => {
  console.log(searchObject, filterObject, sortStr, pagingInfo);
  // variables
  let docs;
  let docsCount;
  let query;
  // find documents length
  const searchObjectLength = Object.values(searchObject).length;

  console.log(searchObjectLength);

  if (searchObjectLength) {
    query = Model.countDocuments(searchObject).find(filterObject);
    docsCount = await query.countDocuments();
  } else docsCount = await Model.countDocuments(filterObject);

  // get paging info
  let page = parseInt(pagingInfo.page);
  let limit = parseInt(pagingInfo.limit);

  // sanitize user input
  if (isNaN(page) || page < 1) page = 1;

  if (isNaN(limit) || limit < 15) limit = 15;

  let firstPage = 1;
  let pages = Math.ceil(docsCount / limit);
  let lastPage = pages;

  const prevPage = firstPage < page ? page - 1 : null;
  const nextPage = lastPage > page ? page + 1 : null;

  const read = page - firstPage;
  const toread = lastPage - page;

  const skip = (page - 1) * limit;

  if (searchObjectLength) {
    query = Model.find(searchObject)
      .find(filterObject)
      .sort(sortStr)
      .skip(skip)
      .limit(limit);

    populates.forEach((population) => query.populate(population));

    docs = await query;
  } else {
    query = Model.find(filterObject).sort(sortStr).skip(skip).limit(limit);

    populates.forEach((population) => query.populate(population));

    docs = await query.exec();
  }

  const docsLength = docs.length;

  return {
    page,
    pageCount: pages,
    pages: createPages(pages),
    nextPage,
    prevPage,
    read,
    toread,
    docs,
    totalResults: docsCount,
    firstPage,
    lastPage,
    docsLength,
  };
};

const sendEmail = async (content) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    auth: {
      user: 'rallygene0@gmail.com',
      pass: 'FvtRrDY5WV9hTPJn',
    },
  });

  return await transporter.sendMail(content);
};

const hashToken = (raw) => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

const setCookie = (res, name, value, options) => {
  options = { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, ...options };
  res.cookie(name, value, options);
};

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

// location = { type: 'Point', coordinates: [79, 88] }

const createOffer = catchAsyncErrors(async (req, res, next) => {
  // only create offer if property exist
  const property = await Property.findById(req.params.propertyId);
  const accountId = req.account.id;

  console.log('Account ID: ', accountId);

  if (!property) {
    return next(
      new ServerError$1('Cannot create offer for an unexisting property', 404)
    );
  }

  // don't allow property owner to create offer on their property
  if (property.ownerId.equals(accountId)) {
    return next(
      new ServerError$1('You cannot make offers on your own properties', 400)
    );
  }

  const potentialOffer = await Offer.findOne({
    propertyId: property.id,
    offererId: accountId,
  });

  // cannot make offers to the same property 2x
  if (potentialOffer) {
    return next(
      new ServerError$1("You've already sent an offer for this property", 400)
    );
  }

  // create offer
  const offer = new Offer(req.body);
  // tie offer to creator
  offer.offererId = req.account.id;
  // tie offer to property
  offer.propertyId = property.id;
  // save offer
  await offer.save();
  // send created offer
  res.status(201).json(offer);
});

const getOffers = catchAsyncErrors(async (req, res, next) => {
  const offers = await Offer.find({ propertyId: req.params.propertyId })
    .populate('offerer')
    .populate('property');
  res.json(offers);
});

const getOffer = catchAsyncErrors(async (req, res, next) => {
  // find offer
  const offer = await Offer.findById(req.params.offerId)
    .populate('offerer')
    .populate('property');

  // send an error if offer does not exist
  if (!offer) {
    return next(
      new ServerError$1('This offer does not exist on our server', 404)
    );
  }
  // send offer
  res.json(offer);
});

const updateOffer = catchAsyncErrors(async (req, res, next) => {
  // don't allow anyone to update offerer
  delete req.body.offererId;

  // find offer
  const offer = await Offer.findById(req.params.offerId);

  // send error if offer is not found
  if (!offer) {
    return next(
      new ServerError$1('This offer does not exist on our server', 404)
    );
  }

  // only offer owner and admin allowed to remove offer
  if (!offer.offererId.equals(req.account.id)) {
    return next(
      new ServerError$1(
        'You do not have enough credentials to perform this action',
        403
      )
    );
  }

  objectAssign(req.body, offer);

  await offer.save();

  res.json(offer);
});

const removeOffer = catchAsyncErrors(async (req, res, next) => {
  // find offer
  const offer = await Offer.findById(req.params.offerId);

  // error if offer not found
  if (!offer) {
    return next(
      new ServerError$1('This offer does not exist on our server', 404)
    );
  }

  // only offer owner and admin allowed to remove offer
  if (!offer.offererId.equals(req.account.id)) {
    return next(
      new ServerError$1(
        'You do not have enough credentials to perform this action',
        403
      )
    );
  }

  // delete offer
  await Offer.deleteOne({ _id: offer.id });

  res.status(204).json();
});

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

const authenticate = (type = 'client') => {
  return catchAsyncErrors(async (req, res, next) => {
    let query;

    const noAuthError = new ServerError$1('You are not authenticated', 401);
    // get token
    const token = req.headers['authorization'];

    // req.cookies.AUTH_TOKEN;
    console.log(token);

    // verify token
    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET_KEY || 'secret');

    if (!decoded) {
      return next(noAuthError);
    }
    // system auth
    if (type === 'system')
      query = { tokens: token, role: { $in: ['admin', 'sub-admin', 'agent'] } };
    // client auth
    else if (type === 'client') query = { tokens: token, role: 'client' };
    // unknown auth
    else return next(noAuthError);

    // find account that has role as client
    const account = await Account.findOne(query);

    if (!account) return next(noAuthError);

    req.account = account;
    req.token = token;

    return next();
  });
};

const allowAccessTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.account.role)) {
      return next(
        new ServerError$1(
          'You do not have enough credentials to access or perform these actions',
          403
        )
      );
    }
    next();
  };
};

const preventUnverifiedAccounts = catchAsyncErrors(
  async (req, res, next) => {
    const { account } = req;

    if (!account.verified) {
      return next(
        new ServerError$1(
          'Please verify your account to access this ressource',
          403
        )
      );
    }

    next();
  }
);

const router$2 = express.Router({ mergeParams: true });

router$2
  .route('/')
  .get(getOffers)
  .post(authenticate(), preventUnverifiedAccounts, createOffer);

router$2
  .route('/:offerId')
  .get(getOffer)
  .patch(authenticate(), updateOffer)
  .delete(authenticate(), removeOffer);

const fetchProperties = catchAsyncErrors(async (req, res, next) => {
  const { search, type, documented, page = 1, limit = 15 } = req.query;
  // object containg search query
  const searchObject = {};
  // only assign search query to search object when present
  search && objectAssign({ $text: { $search: search } }, searchObject);
  // contains all filters
  const filterObject = {};
  // assign if present
  objectAssign({ type, documented }, filterObject);
  // contains sorting
  let { sortBy } = req.query;
  // contains pagination info
  const pagination = { page, limit };
  // paginate data
  const data = await paginateModel(
    Property,
    searchObject,
    filterObject,
    sortBy,
    pagination,
    'owner'
  );

  res.json(data);
});

const createProperty = catchAsyncErrors(async (req, res, next) => {
  console.log(req.body.location);
  const { lat, long } = req.body.location;
  console.log('Latitude: ', lat, 'Longitude: ', long);

  console.log(req.body.location);
  // create new property
  const property = new Property(req.body);

  const location = {
    coordinates: req.body.location.coords,
  };

  property.location = location;

  // associate property to it's owner
  property.ownerId = req.account.id;

  // property uploaded images
  let images = req.files || [];

  // save property to DB
  await property.save();

  // upload property images to S3 bucket
  await uploadPropertyImages(images, property, next);

  // send success response
  res.status(201).json(property);
});

const fetchProperty = catchAsyncErrors(async (req, res, next) => {
  // fetch property
  const property = await Property.findById(req.params.propertyId).populate(
    'owner'
  );
  // send an error if property does not exist
  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }
  // send property
  res.json(property);
});

const updateProperty = catchAsyncErrors(async (req, res, next) => {
  // don't allow anyone to update property owner
  delete req.body.ownerId;

  const property = await Property.findById(req.params.id);

  if (!property) {
    // error
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  if (
    !property.ownerId.equals(req.account.id) ||
    req.account.role !== process.env.MASTER_ROLE ||
    'admin'
  ) {
    return next(
      new ServerError$1(
        'You do not have enough credentials to perform this action',
        404
      )
    );
  }

  objectAssign(req.body, property);

  await property.save();

  res.json(property);
});

const removeProperty = catchAsyncErrors(async (req, res, next) => {
  const property = await property.findById(req.params.id);

  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  if (
    !property.ownerId.equals(req.account.id) ||
    req.account.role !== process.env.MASTER_ROLE ||
    'admin'
  ) {
    return next(
      new ServerError$1(
        'You do not have enough credentials to perform this action',
        404
      )
    );
  }

  await Property.deleteOne({ _id: property.id });

  res.status(204).json();
});

const addPropertyImages = catchAsyncErrors(async (req, res, next) => {
  // find property
  const property = await Property.findOne(req.params.propertyId);
  // how many images are stored for this property
  const propertyImagesLength = property.imagesNames.length;
  // uploaded images
  const uploadedImages = req.files || [];
  // maximum number of images allowed for a single property
  const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 12;

  // send an error if property is not found
  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  // only owner is allowed to add images to a property
  if (!property.ownerId.equals(req.account.id)) {
    return next(
      new ServerError$1('You are not allowed to perform this action', 404)
    );
  }

  if (
    propertyImagesLength >= maxImagesLength ||
    propertyImagesLength + uploadedImages.length > maxImagesLength
  ) {
    return next(
      new ServerError$1(
        `A property cannot have more than ${maxImagesLength} images`,
        400
      )
    );
  }

  await uploadPropertyImages(images, property, next);

  res.json(property);
});

const removePropertyImage = catchAsyncErrors(async (req, res, next) => {
  // account
  const account = { req };

  // imageName and propertyId
  const { imageName, propertyId } = req.params;

  // find property
  const property = await Property.findOne(propertyId);

  // imageNames
  const { imagesNames } = property;

  // send an error if property is not found
  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  // allow only owner and admin to delete image
  if (!property.ownerId.equals(account.id)) {
    return next(
      new ServerError$1('You are not allowed to perform this action', 403)
    );
  }

  // try to find the image to be deleted
  const image = property.imagesNames.find(
    (imageObject) => imageObject.sourceName === imageName
  );

  if (!image) {
    return next(
      new ServerError$1('This image does not exist on our server', 404)
    );
  }

  await removeFroms3(imageName);

  property.imagesNames = imagesNames.filter(
    (imageObject) => imageObject.sourceName !== imageName
  );

  await property.save();

  res.json();
});

const router$1 = express.Router();

const parentRoute$1 = '/properties';
const childRoute = `${parentRoute$1}/:propertyId`;

router$1
  .route(`${parentRoute$1}`)
  .get(fetchProperties)
  .post(
    uploader({ files: 12 }).any(),
    authenticate(),
    preventUnverifiedAccounts,
    createProperty
  );

router$1
  .route(childRoute)
  .get(fetchProperty)
  .patch(authenticate(), updateProperty)
  .delete(authenticate(), removeProperty);

router$1.post(`${childRoute}/images`, authenticate(), addPropertyImages);
router$1.delete(
  `${childRoute}/images/:imageName`,
  authenticate(),
  removePropertyImage
);

router$1.use(`${childRoute}/offers`, router$2);

// SYSTEM SPECIFIC ROUTES
router$1
  .route('system/properties/:propertyId')
  .patch(authenticate('system'), updateProperty)
  .delete(authenticate('system'), removeProperty);

// REGULAR USER HANDLERS
const signup = catchAsyncErrors(async (req, res, next) => {
  // make sure this account does not exist before we create one
  if (await Account.findOne({ email: req.body.email })) {
    return next(
      new ServerError$1('This account already exist. Please Log In!', 400)
    );
  }
  // create new account
  const account = new Account(req.body);

  // store ip and last time user logged in
  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // generate an auth token for this account and save it to our DB
  const token = generateJwt(account.id);

  // store token
  account.tokens.push(token);

  // save account
  await account.save();

  // get account avatar if uploaded
  const avatar = req.files[0];

  // proccess and upload avatar to s3
  await uploadAvatar(avatar, account, next);

  // setCookie(res, 'Auth-Token', token);
  res.setHeader('auth_token', token);

  res.json(account);
});

const signin = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;
  // find account
  const account = await Account.findOne({ email, role: 'client' });

  if (!account) {
    // account does not exist err
    return next(new ServerError$1('Account not found', 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError$1('Invalid password', 401));
  }

  // store ip and last time user logged in
  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // regular users have long expiration tokens while admins and agents' expire in 1d
  const token = generateJwt(account.id);

  // store token
  account.tokens.push(token);

  await account.save();

  //setCookie(res, 'Auth-Token', token);

  res.setHeader('auth_token', token);

  res.json(account);
});

const signout = catchAsyncErrors(async (req, res, next) => {
  const { account, token } = req;

  // log user out
  account.signedOut = Date.now();
  account.tokens = account.tokens.filter((t) => t !== token);

  await account.save();
  // remove cookie (not required)
  // setCookie(res, 'Auth-Token', undefined, { maxAge: 0 });

  res.status(204).json();
});

const changeMyPassword = catchAsyncErrors(async (req, res, next) => {
  // consider logging out user when password change

  // user current pwd and new pwd
  const { currentPassword, newPassword: password } = req.body;

  // account
  const { account } = req;

  if (currentPassword === password)
    return next(
      new ServerError$1('Your current and new password cannnot be the same', 400)
    );

  // validate pwd
  const isPasswordValid = await account.validatePassword(currentPassword);

  // send error if not valid
  if (!isPasswordValid) {
    return next(new ServerError$1('Invalid password', 401));
  }

  // update pwd
  objectAssign({ password }, account);

  // update tokens
  account.tokens = [];

  // save
  await account.save();

  res.json(account);
});

const getMyAccount = catchAsyncErrors(async (req, res, next) => {
  res.json(req.account);
});

const updateMyAccount = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  const avatar = req.files[0];

  const { firstname, lastname } = req.body;

  objectAssign({ firstname, lastname }, account);

  await account.save();

  // process and update avatar
  await uploadAvatar(avatar, account, next);

  res.json(account);
});

const deleteMyAccount = catchAsyncErrors(async (req, res, next) => {
  // alongside delete offers and properties created by this account
  // id of logged in account
  const accountId = req.account.id;
  // find all properties owned by this account
  const myProperties = await Property.find({ ownerId: accountId }).lean();
  // remove images of all properties made by this account from s3 bucket
  for (let property of myProperties) {
    const images = property.imagesNames;
    for (let image of images) {
      await removeFroms3(image.names);
    }
  }
  // delete properties owned by this account
  await Property.deleteMany({ ownerId: accountId });
  // delete all offers made by this account
  await Offer.deleteMany({ offererId: accountId });
  // finally delete account
  await Account.deleteOne({ _id: req.account.id });
  // respond to client
  res.status(204).json();
});

const forgotMyPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;

  const account = await Account.findOne({ email });

  // send error
  if (!account) {
    return next(
      new ServerError$1('This account does not exist on our server', 401)
    );
  }

  // send email to user
  const resetToken = await account.generateResetToken();

  res.json({ resetToken });
});

const resetMyPassword = catchAsyncErrors(async (req, res, next) => {
  // reset token
  const { resetToken } = req.params;

  // pwd
  const { password } = req.body;

  // hashed reset token
  const hash = hashToken(resetToken);

  // find account
  const account = await Account.findOne({
    resetToken: hash,
    resetTokenExpirationDate: { $gt: Date.now() },
  });

  // send error
  if (!account) {
    return next(
      new ServerError$1('This account does not exist on our server', 401)
    );
  }

  // update password and default reset token & exp date
  objectAssign(
    { password, resetToken: undefined, resetTokenExpirationDate: undefined },
    account
  );

  // logout all tokens stored before pwd change
  account.tokens = [];

  // save account
  await account.save();

  res.json({ account });
});

const verifyAccount = catchAsyncErrors(async (req, res, next) => {
  // verfication code
  const { code } = req.params;

  const hash = hashToken(code);

  console.log('code: ', code, 'hash: ', hash);
  // find account with this code and make sure it has not expired
  const account = await Account.findOne({
    verificationCode: hash,
    verificationCodeExpirationDate: { $gt: Date.now() },
  });

  // send error, no account found
  if (!account) {
    return next(
      new ServerError$1('Unfortunately, we could not verify your account', 400)
    );
  }

  if (account.verified) {
    return next(new ServerError$1('Your account is already verified', 400));
  }

  // mark account as verified
  objectAssign(
    {
      verified: true,
      verificationCode: undefined,
      verificationCodeExpirationDate: undefined,
    },
    account
  );

  // save account
  await account.save();

  // respond to client
  res.json({ message: 'Your account is successfully verfified' });
});

const sendVerficationCode = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  // don't send code to email if user is already verified
  if (account.verfied) {
    return next(new ServerError$1('This account is already verified', 400));
  }

  // generate verification code
  const code = await account.generateVerificationCode();

  const verficationLink = `${req.protocol}://${req.hostname}/api/v1/accounts/verify/${code}`; // https://localhost:80/

  console.log(verficationLink);

  // send email to logged in account
  const info = await sendEmail({
    from: 'abdourahmanedbalde@gmail.com',
    to: account.email,
    subject: 'Hello',
    html: `this is your verification code. Please send a request to <a href='${verficationLink}'>${verficationLink}</a>`,
  });

  console.log(info);

  res.json(code);
});

// SYSTEM ROUTE HANDLERS
// ONLY ACCESSIBLE TO ADMIN AND ADMIN PERMITTED ACCOUNTS

// AGENT FUCTIONS
const systemSignIn = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;
  const systemRoles = ['admin', 'sub-admin', 'agent'];
  // find account
  const account = await Account.findOne({
    email,
    role: { $in: systemRoles },
  });

  if (!account) {
    // account does not exist err
    return next(new ServerError$1('Account not found', 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError$1('Invalid password', 401));
  }

  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // store token
  const token = generateJwt(account.id, '1d');

  account.tokens.push(token);

  await account.save();

  setCookie(res, 'Auth-Token', token);

  res.json(account);
});

// ADMIN ONLY FUNCTIONS
const systemAdminCreateAccount = catchAsyncErrors(
  async (req, res, next) => {
    const account = new Account(req.body);

    account.password = process.env.DEFAULT_SYSTEM_PASSWORD;

    await account.save();

    res.status(201).json(account);
  }
);

const systemAdminAccountUpdate = catchAsyncErrors(
  async (req, res, next) => {
    const { firstname, lastname, contacts } = req.body;
    const account = await Account.findById(req.params.accountId);
    // if account does not exist send err
    if (!account) {
      return next(new ServerError$1('Account not found', 401));
    }
    // update properties
    objectAssign({ firstname, lastname }, account);

    await account.save();

    res.json(account);
  }
);

const systemAdminRemoveAccount = catchAsyncErrors(
  async (req, res, next) => {
    await Account.deleteOne({ _id: req.params.accountId });
    res.status(204).json();
  }
);

const systemAdminPasswordChange = catchAsyncErrors(
  async (req, res, next) => {
    const account = await Account.findById(req.params.accountId);
    // if account does not exist send err
    if (!account) {
      return next(new ServerError$1('Account not found', 401));
    }

    account.password = process.env.DEFAULT_SYSTEM_PASSWORD || 'DFSP-APP';

    await account.save();

    res.json();
  }
);

const router = express.Router();

const parentRoute = '/accounts';

const systemParentRoute = `system/${parentRoute}`;

router.post(`${parentRoute}/signup`, uploader({ files: 1 }).any(), signup);

/** AUTHENTICATED */

router.post(`${parentRoute}/signout`, authenticate(), signout);

router.get(`${parentRoute}/my-account`, authenticate(), getMyAccount);

/** NOT AUTHENTICATED */

router.post(`${parentRoute}/signin`, signin);

router.post(`${parentRoute}/forgot-my-password`, forgotMyPassword);

router.patch(`${parentRoute}/reset-password/:resetToken`, resetMyPassword);

/** AUTHENTICATED */

router.patch(
  `${parentRoute}/change-my-password`,
  authenticate(),
  changeMyPassword
);

router.patch(
  `${parentRoute}/update-my-account`,
  authenticate(),
  updateMyAccount
);

router.delete(
  `${parentRoute}/delete-my-account`,
  authenticate(),
  allowAccessTo('client'),
  deleteMyAccount
);

// verify account
router.get(`${parentRoute}/verify/:code`, authenticate(), verifyAccount);

// send verification code
router.get(
  `${parentRoute}/verification-code`,
  authenticate(),
  sendVerficationCode
);

// SYSTEM ROUTES
router.post(`${systemParentRoute}/signin`, systemSignIn);
router.post(`${systemParentRoute}/signout`, authenticate('system'), signout);
router.patch(
  `${systemParentRoute}/change-my-password`,
  authenticate('system'),
  changeMyPassword
);

// ADMIN ROUTES
router.post(
  `${systemParentRoute}/create-account`,
  authenticate('system'),
  systemAdminCreateAccount
);
router.patch(
  `${systemParentRoute}/update-account`,
  authenticate('system'),
  allowAccessTo('admin'),
  systemAdminAccountUpdate
);
router.delete(
  `${systemParentRoute}/delete-account`,
  authenticate('system'),
  allowAccessTo('admin'),
  systemAdminRemoveAccount
);
router.patch(
  `${systemParentRoute}/change-password`,
  authenticate('system'),
  systemAdminPasswordChange
);

// start db connection
const connectToDb = async () => {
  try {
    await mongoose.connect(
      process.env.DATABASE_URL || 'mongodb://localhost:27017/houses&lands'
    );
    console.log('sucessfull connection to db');

    const admin = await Account.findOne({
      email: process.env.ADMIN_EMAIL || 'abdourahmanedbalde@gmail.com',
    });

    if (!admin) {
      const account = new Account({
        firstname: process.env.ADMIN_FIRSTNAME,
        lastname: process.env.ADMIN_LASTNAME,
        email: process.env.ADMIN_EMAIL,
        contacts: ['(716)-314-35-33', '(917)-284-4425'],
        password: process.env.ADMIN_PASSWORD,
        type: process.env.ADMIN_TYPE,
        // year month (begin at 0 march = idx 2) day
        dob: new Date(2000, 2, 17),
      });

      await account.save();
    }
  } catch (error) {
    console.log('failed db connection');
  }
};

const setupExpressMiddleware = (server) => {
  // setup environment variables
  dotenv.config();
  // parse json
  server.use(express.json());
  // setup cors
  server.use(cors());
  // parse cookies
  server.use(cookieParser());
  // setup compression
  server.use(compress());
  // setup helmet to protect server
  server.use(helmet());

  // serve static files
  server.use(express.static(path.resolve(__dirname, 'Public')));

  // server main routes
  server.use('/api/v1', router);
  server.use('/api/v1', router$1);

  // handles all unmacthing routes
  server.all('*', unroutable);

  // error handler
  server.use(globalErrorHandler);
};

// port listeners
const listen = async (server, port = process.env.PORT || 9090) => {
  try {
    await server.listen(port, console.log);
    console.log('listening on port 9090');
    console.clear();
  } catch (error) {
    console.log('failing to listen on port 9090');
  }
};

const server = express();

// connect to mongodb
connectToDb();
// setup express middlewares
setupExpressMiddleware(server);
// listen on determined port
listen(server);

console.clear();
