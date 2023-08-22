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
var crypto = require('crypto');
var argon = require('argon2');
var emailValidator = require('email-validator');
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

const removeFroms3 = async (fileNames = []) => {
  const s3Instance = createS3Instance();
  const bucketName = process.env.AWS_BUCKET_NAME;

  console.log(fileNames);
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

const catchAsyncErrors = f => {
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
  props.forEach(prop => delete src[prop]);
};

const generateJwt = (
  id,
  expiresIn = process.env.JWT_EXPIRATION_TIME || '30d'
) => {
  return jsonwebtoken.sign({ id }, process.env.JWT_SECRET || 'secret', {
    expiresIn,
  });
};

const uploader = limits => {
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

const isFullHd = async file => {
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

    account.avatarNames = avatarFiles.map(avatar => avatar.originalname);

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
      return next(
        new ServerError$1('Please upload high resolution images', 400)
      );
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
      names: imageAndCopies.map(img => img.originalname),
    };
    // add imageObject to imageNames list
    property.imagesNames.push(imageObject);
    // persist to db
    await property.save();
  }
};

// create pages array out of a number of pages
const createPages = numPages => {
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

    populates.forEach(population => query.populate(population));

    docs = await query;
  } else {
    query = Model.find(filterObject).sort(sortStr).skip(skip).limit(limit);

    populates.forEach(population => query.populate(population));

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

const hashToken = raw => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

const generateAccountEmail = (fn = '', ln = '') => {
  // random number from 0 - 1000
  const random = Math.round(Math.random() * 1000);
  // company email extension @company.com
  const ext = process.env.SYSTEM_EMAIL_EXT;
  // combine user info and random num + ext to generate a unique email
  return fn + ln + random + ext;
};

const generateDfPassword = (fn = '', ln = '') => {
  return `PASS-${fn.slice(0, 2)}${ln.slice(0, 2)}`;
};

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
    validator: {
      validate(value) {
        console.log(value);
        return value.length === 2;
      },
      message: 'Coordinates need a Longitude and a Latitude',
    },
  },
});

// SCHEMA
const propertySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, 'A property must be of type land or house'],
      enum: ['house', 'land'],
      lowercase: true,
    },
    ownerId: {
      required: [true, 'A property has to have an owner'],
      unique: [true],
      type: mongoose.Schema.Types.ObjectId,
    },
    price: {
      type: Number,
      required: [true, 'A property needs a price'],
    },
    location: {
      type: locationSchema,
      required: [true, 'A property must have gps coordinates'],
    },

    documented: {
      type: Boolean,
    },
    imagesNames: [imageSchema],
    dimension: {},
    title: {
      type: String,
      required: [true, 'A property needs a title'],
    },
    story: {
      type: String,
    },
    status: {
      type: String,
      enum: ['available', 'pending', 'sold'],
    },
    yearBuilt: {
      type: Number,
      // minium property built year
      min: [1800, 'A property built year must be from year 1800'],
      // don't allow property buil year to be in the future
      max: [
        new Date().getFullYear(),
        `A property built year can't be in the future`,
      ],
      required: [
        function () {
          return this.type === 'house';
        },
        'A house property must have a year built',
      ],
    },

    tags: String,
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

  return imagesNames.map(image => {
    return {
      src: `${baseURI}/${image.sourceName}`,
      srcset: image.names.map(name => `${baseURI}/${name}`),
    };
  });
});

// hooks

// methods

const Property = mongoose.model('Property', propertySchema);

const fetchProperties = catchAsyncErrors(async (req, res, next) => {
  // latitude of client
  const latitude = parseInt(req.headers.latitude) || null;
  // longitude of client
  const longitude = parseInt(req.headers.longitude) || null;
  // radius default to 1000 meters for now
  const radius = parseInt(req.headers.radius) || 1000;

  // this filter finds properties near a given client location
  const geoFilter = {
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        maxDistance: radius,
      },
    },
  };

  // only try finding properties near location if longitude and latitude is present
  longitude && latitude && objectAssign(geoFilter, filterObject);

  const { search, type, documented, page = 1, limit = 15 } = req.query;
  // object containg search query
  const searchObject = {};
  // search query
  const searchQuery = { $text: { $search: search } };
  // only assign search query to search object when present
  search && objectAssign(searchQuery, searchObject);
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
  // create new property
  const property = new Property(req.body);

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

const fetchMyProperties = catchAsyncErrors(async (req, res, next) => {
  res.json(await Property.find({ ownerId: req.account.id }));
});

const updateProperty = catchAsyncErrors(async (req, res, next) => {
  // don't allow anyone to update property owner
  delete req.body.ownerId;

  const property = await Property.findById(req.params.propertyId);

  if (!property) {
    // error
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  if (!property.ownerId.equals(req.account.id)) {
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
  // find property
  const property = await Property.findById(req.params.propertyId);

  // send error if property doesn't exist
  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  // only property owner and admin allowed accounts can delete
  const allowedAccounts = ['admin', 'sub-admin', 'agent'];

  if (
    !property.ownerId.equals(req.account.id) ||
    !allowedAccounts.includes(req.account.role)
  ) {
    return next(
      new ServerError$1(
        'You do not have enough credentials to perform this action',
        404
      )
    );
  }

  // delete all images of property from s3

  const images = property.imagesNames;

  for (let image of images) {
    await removeFroms3(image.names);
  }

  // delete property from records
  await Property.deleteOne({ _id: property.id });

  res.status(204).json();
});

const addPropertyImages = catchAsyncErrors(async (req, res, next) => {
  // find property
  const property = await Property.findOne({
    _id: req.params.propertyId,
    ownerId: req.account.id,
  });

  // send an error if property is not found
  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  // how many images are stored for this property
  const propertyImagesLength = property.imagesNames.length;
  // uploaded images
  const uploadedImages = req.files || [];

  console.log(uploadedImages);
  // maximum number of images allowed for a single property
  const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 12;

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

  await uploadPropertyImages(uploadedImages, property, next);

  res.json(property);
});

const removePropertyImage = catchAsyncErrors(async (req, res, next) => {
  // account
  const { account } = req;

  // imageName and propertyId
  const { imageName, propertyId } = req.params;

  // find property
  const property = await Property.findById(propertyId);

  // send an error if property is not found
  if (!property) {
    return next(
      new ServerError$1('This property does not exist on our server', 404)
    );
  }

  // allow only owner and admin to delete image
  console.log(property.ownerId.equals(account.id));
  if (!property.ownerId.equals(account.id)) {
    return next(
      new ServerError$1('You are not allowed to perform this action', 403)
    );
  }

  // imageNames
  const { imagesNames } = property;

  // try to find the image to be deleted
  const image = property.imagesNames.find(
    imageObject => imageObject.sourceName === imageName
  );

  if (!image) {
    return next(
      new ServerError$1('This image does not exist on our server', 404)
    );
  }

  // remove image and all it's duplicates from s3
  await removeFroms3(image.names);

  // remove image info from db
  property.imagesNames = imagesNames.filter(
    imageObject => imageObject.sourceName !== imageName
  );

  await property.save();

  res.json();
});

// SCHEMA
const accountSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
      minlength: [4, 'Firstname cannot be less than 5 characetrs'],
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
      required: [true],
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

  console.log(password);

  if (password < minlength || password > maxlength) {
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

    const authFailError = new ServerError$1('You are not authenticated', 401);
    // get token
    const token = req.headers['authorization'];

    // req.cookies.AUTH_TOKEN;
    console.log(token);

    // verify token
    const decoded = jsonwebtoken.verify(
      token,
      process.env.JWT_SECRET || 'secret'
    );

    if (!decoded) {
      return next(authFailError);
    }
    // system auth
    if (type === 'system')
      query = { tokens: token, role: { $in: ['admin', 'sub-admin', 'agent'] } };
    // client auth
    else if (type === 'client') query = { tokens: token, role: 'client' };
    // unknown auth
    else return next(authFailError);

    // find account that has role as client
    const account = await Account.findOne(query);

    if (!account) return next(authFailError);

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

const preventUnverifiedAccounts = catchAsyncErrors(async (req, res, next) => {
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
});

const router$1 = express.Router();

const parentRoute$1 = '/properties';
const childRoute = `${parentRoute$1}/:propertyId`;

router$1
  .route(parentRoute$1)
  .get(fetchProperties)
  .post(
    uploader({ files: 12 }).any(),
    authenticate(),
    preventUnverifiedAccounts,
    createProperty
  );

router$1.get(
  `${parentRoute$1}/my-properties`,
  authenticate(),
  fetchMyProperties
);

router$1
  .route(childRoute)
  .get(fetchProperty)
  .patch(authenticate(), updateProperty)
  .delete(authenticate(), removeProperty);

router$1.post(
  `${childRoute}/images`,
  authenticate(),
  uploader({ files: 12 }).any(),
  addPropertyImages
);

router$1.delete(
  `${childRoute}/images/:imageName`,
  authenticate(),
  removePropertyImage
);

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
  const avatar = req.files ? req.files[0] : undefined;

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
  account.tokens = account.tokens.filter(t => t !== token);

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
      new ServerError$1(
        'Your current and new password cannnot be the same',
        400
      )
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

  const avatar = req.files ? req.files[0] : undefined;

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

  const account = await Account.findOne({ email, role: 'client' });

  // send error
  if (!account) {
    return next(
      new ServerError$1('This account does not exist on our server', 401)
    );
  }

  // generate reset token
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
      new ServerError$1('This account does not exist on our server', 404)
    );
  }

  // don't allow account to use the same password as current one
  if (await account.validatePassword(password)) {
    return next(
      new ServerError$1('Your current and new password cannot be the same', 400)
    );
  }

  // update password and default reset token & exp date
  // didn't use objectAssign because it's strict will not assign falsy values
  account.resetToken = undefined;
  account.resetTokenExpirationDate = undefined;
  account.password = password;

  console.log(account);

  // logout all tokens stored before pwd change
  account.tokens = [];

  // save account
  await account.save();

  res.json(account);
});

const verifyAccount = catchAsyncErrors(async (req, res, next) => {
  // verfication code
  const { code } = req.params;

  const hash = hashToken(code);

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
  res.json({ message: 'Your account has successfully been verfified' });
});

const sendVerficationCode = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  // don't send code to email if user is already verified
  if (account.verified) {
    return next(new ServerError$1('This account is already verified', 400));
  }

  // generate verification code
  const verificationCode = await account.generateVerificationCode();

  res.json({ verificationCode });
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

  // setCookie(res, 'Auth-Token', token);

  res.setHeader('auth_token', token);

  res.json(account);
});

// ADMIN ONLY FUNCTIONS
const systemAdminCreateAccount = catchAsyncErrors(async (req, res, next) => {
  // don't allow admin accounts creations
  if (req.body.role === 'admin') {
    return next(
      new ServerError$1(
        'You do not have permission to perform these actions',
        403
      )
    );
  }

  const account = new Account(req.body);

  const { firstname, lastname } = account;

  // generate email
  account.email = generateAccountEmail(firstname, lastname);

  // generate default for account
  account.password = generateDfPassword(firstname, lastname);
  // set these accounts as verified (unnecessary anyways)
  account.verified = true;
  // save account
  await account.save();

  res.status(201).json(account);
});

const systemAdminAccountUpdate = catchAsyncErrors(async (req, res, next) => {
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
});

const systemAdminRemoveAccount = catchAsyncErrors(async (req, res, next) => {
  const account = await Account.findById(req.params.accountId);

  if (!account) return next(new ServerError$1('Account not found', 404));

  if (
    account.role === 'admin' ||
    (req.account.role === 'sub-admin' &&
      account.role === 'sub-admin' &&
      !account._id.equals(req.account.id))
  )
    return next(
      new ServerError$1("You're not allowed to perform these actions", 404)
    );
  // delete account
  await Account.deleteOne({ _id: req.params.accountId });
  // send response
  res.status(204).json();
});

const systemAdminPasswordChange = catchAsyncErrors(async (req, res, next) => {
  const account = await Account.findOne({
    _id: req.params.accountId,
    role: { $in: ['admin', 'sub-admin', 'agent'] },
  });
  // if account does not exist send err
  if (!account) {
    return next(new ServerError$1('Account not found', 401));
  }

  // if (account.role === 'admin'account._id.equals(req.account.id)) {

  // }
  // reset password to default and force account to update password
  account.password = generateDfPassword(account.firstname, account.lastname);

  await account.save();

  res.json();
});

const router = express.Router();

const parentRoute = '/accounts';

const systemParentRoute = `/system${parentRoute}`;

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
router.get(
  `${systemParentRoute}/my-account`,
  authenticate('system'),
  getMyAccount
);

router.post(
  `${systemParentRoute}/create-account`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminCreateAccount
);
router.patch(
  `${systemParentRoute}/update-account/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminAccountUpdate
);
router.delete(
  `${systemParentRoute}/delete-account/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminRemoveAccount
);
router.patch(
  `${systemParentRoute}/change-password/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
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

    // console.log(admin);

    if (!admin) {
      const firstname = process.env.ADMIN_FIRSTNAME;
      const lastname = process.env.ADMIN_LASTNAME;
      const email = process.env.ADMIN_EMAIL;
      const contacts = ['(716)-314-35-33', '(917)-284-4425'];
      const password = generateDfPassword(firstname, lastname);
      const role = process.env.MASTER_ROLE;

      const account = new Account({
        firstname,
        lastname,
        email,
        contacts,
        password,
        role,
        // ip,
        // year month (begin at 0 march = idx 2) day
        dob: new Date(2000, 2, 17),
      });

      console.log(account);
      await account.save();

      console.log(account);
    }
  } catch (error) {
    console.log('Failed db connection');
    console.log(error);
  }
};

const setupExpressMiddleware = server => {
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

express();

// connect to mongodb
connectToDb();
// setup express middlewares
setupExpressMiddleware(server);
// listen on determined port
listen(server);

// when server is under maintainance shut it down and use maintenance server
// listen(maintenanceServer);

console.clear();
