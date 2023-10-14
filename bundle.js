'use strict';

var express = require('express');
var path = require('path');
var mongoose = require('mongoose');
var helmet = require('helmet');
var cors = require('cors');
var compress = require('compression');
var cookieParser = require('cookie-parser');
var mongoSanitize = require('express-mongo-sanitize');
var multer = require('multer');
var sharp = require('sharp');
var clientS3 = require('@aws-sdk/client-s3');
var uniqid = require('uniqid');
var jsonwebtoken = require('jsonwebtoken');
var crypto = require('crypto');
var nodemailer = require('nodemailer');
var argon = require('argon2');
var emailValidator = require('email-validator');
require('axios');
var dotenv = require('dotenv');

const router$3 = express.Router();

router$3.get('/', (req, res) => res.send('Welcome to my webserver'));

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

class ServerError extends Error {
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
}

const unroutable = (req, res, next) => {
  next(new ServerError(`The route ${req.originalUrl} is not found`, 404));
};

const catchAsyncErrors = f => {
  return (req, res, next) => f(req, res, next).catch(next);
};

const globalErrorHandler = (err, req, res, next) => {
  console.error('The Error Happened Here!!! : ', err, err.operational);

  // const { ENVIRONMENT = 'dev' } = process.env;
  const { ENVIRONMENT = 'dev' } = process.env;

  console.log(ENVIRONMENT);

  if (ENVIRONMENT === 'dev') {
    // known error
    if (err.operational) {
      console.log('sendin error rn');
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
      error = new ServerError(message, 400);
    }

    // cast errors
    if (err.name === 'CastError') {
      error = new ServerError(`Invalid ${error.path}: ${error.value}`, 400);
    }

    // validation errors
    if (err.name === 'ValidationError') {
      const details = {};

      for (let key in error.errors) {
        details[key] = error?.errors[key]?.properties?.message;
      }

      error = new ServerError('Validation error', 400, details);
    }

    // multer errors
    if (err instanceof multer.MulterError) {
      error = new ServerError(err.message, 400);
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
const deleteProps = (src, ...props) =>
  props.forEach(prop => delete src[prop]);

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
    console.log('file', file);
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
  // if (width >= 1920 && height >= 1080) return true;

  // if width or height does is not FHD+ test fails
  if (width < 1920 || height < 1080) return { passed: false };

  // test passes
  return { passed: true, width, height };
};

const createFileCopies = async (source, dimensions = []) => {
  if (!source) return;

  const copies = [];
  const all = [];

  for (let dimension of dimensions) {
    const copy = { ...source };

    const { originalname } = copy;

    copy.originalname = `${originalname}-${dimension}`;

    copy.buffer = await sharp(source.buffer).resize(dimension).toBuffer();

    copies.push(copy);
    all.push(copy);
  }

  all.push(source);

  return { source, copies, all };
};

const convertToWebp = async (file, quality = 100) => {
  // return if no file is given
  if (!file) return;

  if (file.mimetype !== 'images/webp') {
    // convert to webp
    const converted = await sharp(file.buffer).webp({ quality }).toBuffer();

    // only save converted if it's size is less than original file
    if (converted.byteLength < file.size) {
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

    // convert original file to webp
    const webpAvatar = await convertToWebp(file);

    // make copies of account avatar/profile in the given dimensions
    const copyOutput = await createFileCopies(webpAvatar, [250, 500, 800]);
    // only save the copies not the original
    const avatarFiles = copyOutput.copies;

    // upload files to AWS S3
    await uploadToS3(avatarFiles);

    account.avatarNames = avatarFiles.map(avatar => avatar.originalname);

    await account.save();
  }
};

const uploadPropertyImages = async (images, property) => {
  for (let image of images) {
    // rename property images
    image.originalname = `property-img-${uniqid()}`;

    // make sure images match our criterias
    const resolution = await isFullHd(image);

    const isHighRes = resolution.passed;

    console.log(isHighRes);

    // send error if images are not clear (hd)
    if (!isHighRes) {
      throw new ServerError('Please upload high resolution images', 400);
    }

    // convert property image to webp to optimize images for web use
    const webpImage = await convertToWebp(image);

    // create versions or copies of original images (different dimensions)

    // dimensions are default chosen by me (developer)
    const dimensions = [500, 800];

    // create smaller image versions from original image uploaded by client
    const copyOutput = await createFileCopies(webpImage, dimensions);

    // rename original image to add width for responsive images
    webpImage.originalname = `${image.originalname}-${resolution.width}`;

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
  return true;
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
  /* paging info */ { page, limit },
  // all these must be populated
  ...populates
) => {
  // variables
  let docs;
  let docsCount;
  let query;
  let matches;
  let matchesIds;
  // find documents length
  const searchObjectLength = Object.values(searchObject).length;

  if (searchObjectLength) {
    matches = await Model.find(searchObject);
    matchesIds = matches.map(match => match._id);

    const documents = await Model.find({
      _id: { $in: matchesIds },
      ...filterObject,
    });

    docsCount = documents.length;
  } else {
    // we didn't use countDocuments here because it doesn't support $nearSphere
    const documents = await Model.find(filterObject);
    docsCount = documents.length;
  }

  // get paging info
  page = Number(page);
  limit = Number(limit);

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
    query = Model.find({ _id: { $in: matchesIds }, ...filterObject })
      .sort(sortStr)
      .skip(skip)
      .limit(limit);

    populates.forEach(population => query.populate(population));

    docs = await query;
  } else {
    query = Model.find(filterObject).sort(sortStr).skip(skip).limit(limit);

    populates.forEach(population => query.populate(population));

    docs = await query;
  }

  const docsLength = docs.length;

  console.log('Total Results: ', docsCount);

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

const sendEmail = async content => {
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

const hashToken = raw => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

const setCookie = (res, name, value, options = {}) => {
  options = { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, ...options };
  res.cookie(name, value, options);
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

// house validator
const validator = value => value !== 'house';

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
      required: [true, 'A property must have an owner'],
      type: mongoose.Schema.Types.ObjectId,
    },
    price: {
      type: Number,
      required: [true, 'A property needs a price'],
      min: [5000000, 'A property price cannot be less than this amount'],
      // price must not be past billions
      max: [900000000000, 'A property price cannot exceed this amount'],
    },
    location: {
      type: locationSchema,
      required: [true, 'A property must have gps coordinates'],
    },
    // documented: {
    //   type: Boolean,
    // },
    address: {
      type: String,
      required: [true, 'A property must have an address'],
      lowercase: true,
    },

    imagesNames: [imageSchema],
    // area
    area: {
      type: Number,
      required: [true, 'Area is required'],
    },

    areaBuilt: {
      type: Number,
      required: [
        function () {
          this.type === 'house';
        },
        'Area built is required',
      ],
      default: function () {
        // if property is a house and user did not set this property set to area
        return this.type === 'house' ? this.area : undefined;
      },
      validate: {
        validator,
        message: 'area built is only for a house',
      },
    },
    // area unit
    areaUnit: {
      type: String,
      required: [true, 'Area unit is required'],
      default: 'square meter',
    },

    title: {
      type: String,
      max: [60, 'A title cannot exceed 60 characters'],
      required: [true, 'A property needs a title'],
    },
    // description
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: ['available', 'pending', 'sold'],
    },
    published: {
      type: Boolean,
      required: [true, 'A property must have a published field'],
      default: false,
    },
    rooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'A house must have rooms',
      ],
      validate: {
        validator,
        message: 'Rooms are only for a house',
      },
    },

    // bathrooms:
    externalBathrooms: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'External bathrooms is required',
      ],
      validate: {
        validator,
        message: 'External Bathrooms are only for a house',
      },
    },

    internalBathrooms: {
      type: Number,
      default: 0,
      required: [
        function () {
          return this.type === 'house';
        },
        'Internal bathrooms is required',
      ],
      validate: {
        validator,
        message: 'Internal Bathrooms are only for a house',
      },
    },
    hasCuisine: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Cuisine is required',
      ],
      validate: {
        validator,
        message: 'Cuisine is only for houses',
      },
    },
    hasGarage: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Garage is required',
      ],
      validate: {
        validator,
        message: 'Garage is only for a house',
      },
    },
    // sale a manger
    hasDiningRoom: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Dining room is required',
      ],
      validate: {
        validator,
        message: 'Dining rooms are only for a house',
      },
    },
    // salon
    hasLivingRoom: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Living room is required',
      ],
      validate: {
        validator,
        message: 'Living rooms are only for a house',
      },
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
    // cloturé
    fenced: {
      type: Boolean,
      default: false,
      required: [true, 'Fenced is required'],
    },

    hasPool: {
      type: Boolean,
      default: false,
      required: [
        function () {
          return this.type === 'house';
        },
        'Pool is required',
      ],
      validate: {
        validator,
        message: 'Pool is only for a house',
      },
    },
    tags: String,
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// indexes
propertySchema.index({
  title: 'text',
  story: 'text',
  tags: 'text',
});

propertySchema.index({
  location: '2dsphere',
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
  const { CLOUDFRONT_URL } = process.env;

  return imagesNames.map(({ sourceName, names }) => {
    return {
      sourceName: sourceName,
      src: `${CLOUDFRONT_URL}/${sourceName}`,
      srcset: names.map(name => `${CLOUDFRONT_URL}/${name}`),
    };
  });
});

// hooks

// methods
propertySchema.methods.toJSON = function () {
  // account clone
  const property = this.toObject();
  // remove props from user object
  deleteProps(property, 'imagesNames', '__v');
  // return value will be sent to client
  return property;
};

const Property = mongoose.model('Property', propertySchema);

Property.on('index', e => {
  console.log(e);
});

const fetchProperties = catchAsyncErrors(async (req, res, next) => {
  console.log(req.query);
  // latitude of client
  const latitude = Number(req.headers.latitude);
  // longitude of client
  const longitude = Number(req.headers.longitude);
  // radius default to 1000 meters for now
  Number(req.headers.radius) || 1000;
  // this filter finds properties near a given client location
  const geoFilter = {
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        // $maxDistance: radius,
      },
    },
  };

  const { search, type, documented, page = 1, limit = 15 } = req.query;
  // object containg search query
  const searchObject = {};
  // search query
  const searchQuery = { $text: { $search: search } };
  // only assign search query to search object when present
  search && objectAssign(searchQuery, searchObject);
  // contains all filters
  const filterObject = {};
  // only try finding properties near location if longitude and latitude is present
  longitude && latitude && objectAssign(geoFilter, filterObject);

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
  console.log('Body: ', req.body);

  // create new property
  const property = new Property(req.body);

  // if promo period hasn't expired auto publish property for free
  // promo is 1 year so convert down to milliseconds
  const promoPeriod =
    parseInt(process.env.PROMO_PERIOD) * 12 * 30 * 24 * 60 * 60 * 1000;

  const promoStartDate = parseInt(process.env.PROMO_START_DATE);

  // promo is still running
  if (promoStartDate + promoPeriod > Date.now()) property.published = true;

  console.log('Published: ', property.published);

  // associate property to it's owner
  property.ownerId = req.account.id;

  // save property to DB
  await property.save();

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
      new ServerError('This property does not exist on our server', 404)
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
      new ServerError('This property does not exist on our server', 404)
    );
  }

  if (!property.ownerId.equals(req.account.id)) {
    return next(
      new ServerError(
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
      new ServerError('This property does not exist on our server', 404)
    );
  }

  // only property owner and admin allowed accounts can delete
  const allowedAccounts = ['admin', 'sub-admin', 'agent'];

  const sameAccount = property.ownerId.equals(req.account.id);
  const isAllowed = allowedAccounts.includes(req.account.role);

  console.log('Same account: ', property.ownerId.equals(req.account.id));

  console.log('Allowed: ', allowedAccounts.includes(req.account.role));

  if (!sameAccount || (!sameAccount && !isAllowed)) {
    return next(
      new ServerError(
        'You do not have enough credentials to perform this action',
        403
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
      new ServerError('This property does not exist on our server', 404)
    );
  }

  // how many images are stored for this property
  const propertyImagesLength = property.imagesNames.length;
  // uploaded images
  const uploadedImages = req.files || [];

  // maximum number of images allowed for a single property
  const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 40;

  if (
    propertyImagesLength >= maxImagesLength ||
    propertyImagesLength + uploadedImages.length > maxImagesLength
  ) {
    return next(
      new ServerError(
        `A property cannot have more than ${maxImagesLength} images`,
        400
      )
    );
  }

  await uploadPropertyImages(uploadedImages, property);

  res.json(property);
});

const removePropertyImages = catchAsyncErrors(async (req, res, next) => {
  // account
  const { account } = req;

  // imageName and propertyId
  const { propertyId } = req.params;

  const { names } = req.body;

  console.log(names);

  // find property
  const property = await Property.findById(propertyId);

  // send an error if property is not found
  if (!property) {
    return next(
      new ServerError('This property does not exist on our server', 404)
    );
  }

  // allow only owner and admin to delete image

  if (!property.ownerId.equals(account.id)) {
    return next(
      new ServerError('You are not allowed to perform this action', 403)
    );
  }

  // imageNames
  const { imagesNames } = property;

  for (let imageName of names) {
    // try to find the image to be deleted
    const image = imagesNames.find(
      imageObject => imageObject.sourceName === imageName
    );

    // remove image and all it's duplicates from s3
    await removeFroms3(image.names);

    // remove image info from db
    property.imagesNames = property.imagesNames.filter(
      imageObject => imageObject.sourceName !== imageName
    );
  }

  await property.save();

  res.status(204).json();
});

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

  if (passwordLength < minlength || passwordLength > maxlength) {
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
    'tokens',
    'verificationCode',
    'verificationCodeExpirationDate',
    'resetToken',
    'resetTokenExpirationDate'
  );
  // return value will be sent to client
  return account;
};

const Account = mongoose.model('Account', accountSchema);

const authenticate = (type = 'client') => {
  return catchAsyncErrors(async (req, res, next) => {
    let query;

    const authFailError = new ServerError('You are not authenticated', 401);
    // get token
    const token = req.cookies.token || req.headers['authorization'];

    // req.cookies.AUTH_TOKEN;
    console.log(token);

    // verify token
    try {
      jsonwebtoken.verify(token, process.env.JWT_SECRET || 'secret');
    } catch (error) {
      return next(authFailError);
    }

    // query will use system auth if type = 'system' & client auth otherwise
    query =
      type === 'system'
        ? { tokens: token, role: { $in: ['admin', 'sub-admin', 'agent'] } }
        : { tokens: token, role: 'client' };

    // find account that has role as client
    const account = await Account.findOne(query);

    if (!account) {
      return next(authFailError);
    }

    req.authenticated = true;
    req.account = account;
    req.token = token;

    return next();
  });
};

const allowAccessTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.account.role)) {
      return next(
        new ServerError(
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
        new ServerError(
          'Please verify your account to access this ressource',
          403
        )
      );
    }

    next();
  }
);

const router$2 = express.Router();

const properties = '/properties';
const propertyRoute = `${properties}/:propertyId`;

router$2.route(properties).get(fetchProperties).post(
  authenticate(),
  // uploader({ files: 12 }).any(),
  preventUnverifiedAccounts,
  createProperty
);

router$2.get(`${properties}/my-properties`, authenticate(), fetchMyProperties);

router$2
  .route(propertyRoute)
  .get(fetchProperty)
  .patch(authenticate(), updateProperty)
  .delete(authenticate(), removeProperty);

// add images to property
router$2.post(
  `${propertyRoute}/images`,
  authenticate(),
  uploader({ files: 12 }).any(),
  addPropertyImages
);

// remove a property image
router$2.post(
  `${propertyRoute}/images/delete`,
  authenticate(),
  removePropertyImages
);

// SYSTEM SPECIFIC ROUTES
router$2
  .route('system/properties/:propertyId')
  .patch(authenticate('system'), updateProperty)
  .delete(authenticate('system'), removeProperty);

// REGULAR USER HANDLERS
const signup = catchAsyncErrors(async (req, res, next) => {
  // make sure this account does not exist before we create one
  if (await Account.findOne({ email: req.body.email })) {
    return next(
      new ServerError('This account already exist. Please Log In!', 400)
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
  const avatar = req.file;

  // proccess and upload avatar to s3
  await uploadAvatar(avatar, account);

  res.setHeader('token', token);

  setCookie(res, 'token', token);

  res.json(account);
});

const signin = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;

  console.log(email, password);
  // find account
  const account = await Account.findOne({ email, role: 'client' });

  console.log(account);

  if (!account) {
    // account does not exist err
    return next(new ServerError('Account not found', 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError('Invalid password', 401));
  }

  // store ip and last time user logged in
  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // regular users have long expiration tokens while admins and agents' expire in 1d
  const token = generateJwt(account.id);

  // don't allow more than specified login
  const tokensLength = account.tokens.length;

  // if logged in token + this login token > specified
  // wipe old tokens to logout previous devices

  if (tokensLength + 1 > parseInt(process.env.MAX_LOGIN_TOKENS || 5)) {
    account.tokens = [];
  }
  // store token
  account.tokens.push(token);

  await account.save();

  setCookie(res, 'token', token);

  res.setHeader('token', token);

  res.json(account);
});

const signout = catchAsyncErrors(async (req, res, next) => {
  const { account, token } = req;

  // log user out from server
  account.signedOut = Date.now();
  account.tokens = account.tokens.filter(t => t !== token);

  await account.save();

  // remove cookie (not required)
  setCookie(res, 'token', undefined, { maxAge: 0 });

  res.status(204).json({});
});

const changeMyPassword = catchAsyncErrors(async (req, res, next) => {
  // consider logging out user when password change

  // user current pwd and new pwd
  const { currentPassword, newPassword: password } = req.body;

  // account
  const { account } = req;

  if (currentPassword === password)
    return next(
      new ServerError('Your current and new password cannnot be the same', 400)
    );

  // validate pwd
  const isPasswordValid = await account.validatePassword(currentPassword);

  // send error if not valid
  if (!isPasswordValid) {
    return next(new ServerError('Invalid password', 401));
  }

  // update pwd
  objectAssign({ password }, account);

  // update tokens
  const token = generateJwt(account.id);

  account.tokens = [token];

  // sign account in
  setCookie(res, 'token', token);

  res.setHeader('token', token);

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
  await uploadAvatar(avatar, account);

  res.json(account);
});

const forgotMyPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;

  const account = await Account.findOne({ email, role: 'client' });

  // send error
  if (!account) {
    return next(
      new ServerError('This account does not exist on our server', 401)
    );
  }

  // generate reset token
  const resetToken = await account.generateResetToken();

  // construct a url to send to the user to reset their password

  const resetUrl = `${req.protocol}://${req.hostname}:3000/my-account/reset-my-password/${resetToken}`;

  // console.log(resetUrl);
  // send email to client
  const mail = {
    from: 'rallygene0@gmail.com', // sender address
    to: email, // list of receivers
    subject: 'Reset Password Instructions ✔', // Subject line
    text: resetUrl, // plain text body
    // html: '<b>Hello world?</b>', // html body
  };

  try {
    await sendEmail(mail);
  } catch (e) {
    console.log(e);
    return next(
      new ServerError('Unfortunately we could not send you an email!')
    );
  }

  // res.json({ resetToken });
  res.json({});
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
      new ServerError('This account does not exist on our server', 404)
    );
  }

  // don't allow account to use the same password as current one
  if (await account.validatePassword(password)) {
    return next(
      new ServerError('Your current and new password cannot be the same', 400)
    );
  }

  // update password and default reset token & exp date
  // didn't use objectAssign because it's strict will not assign falsy values
  account.resetToken = undefined;
  account.resetTokenExpirationDate = undefined;
  account.password = password;

  console.log(account);

  // logout all tokens stored before pwd change and store new token
  const token = generateJwt(account.id);

  account.tokens = [token];

  // sign user in

  setCookie(res, 'token', token);

  res.setHeader('token', token);

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
      new ServerError('Unfortunately, we could not verify your account', 400)
    );
  }

  if (account.verified) {
    return next(new ServerError('Your account is already verified', 400));
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
    return next(new ServerError('This account is already verified', 400));
  }

  // generate verification code
  const verificationCode = await account.generateVerificationCode();

  // generate verification code url
  const verifyUrl = `${req.protocol}://${req.hostname}:3000/verify/${verificationCode}`;

  // send email to client
  const mail = {
    from: 'rallygene0@gmail.com',
    to: account.email,
    subject: 'Verify Account Instructions ✔',
    text: verifyUrl,
  };

  try {
    await sendEmail(mail);
  } catch (e) {
    console.log(e);
    return next(
      new ServerError('Unfortunately we could not send you an email!')
    );
  }

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
    return next(new ServerError('Account not found', 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError('Invalid password', 401));
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
const systemAdminCreateAccount = catchAsyncErrors(
  async (req, res, next) => {
    // don't allow admin accounts creations
    if (req.body.role === 'admin') {
      return next(
        new ServerError(
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
  }
);

const systemAdminAccountUpdate = catchAsyncErrors(
  async (req, res, next) => {
    const { firstname, lastname, contacts } = req.body;
    const account = await Account.findById(req.params.accountId);
    // if account does not exist send err
    if (!account) {
      return next(new ServerError('Account not found', 401));
    }
    // update properties
    objectAssign({ firstname, lastname }, account);

    await account.save();

    res.json(account);
  }
);

const systemAdminRemoveAccount = catchAsyncErrors(
  async (req, res, next) => {
    const account = await Account.findById(req.params.accountId);

    if (!account) return next(new ServerError('Account not found', 404));

    if (
      account.role === 'admin' ||
      (req.account.role === 'sub-admin' &&
        account.role === 'sub-admin' &&
        !account._id.equals(req.account.id))
    )
      return next(
        new ServerError("You're not allowed to perform these actions", 404)
      );
    // delete account
    await Account.deleteOne({ _id: req.params.accountId });
    // send response
    res.status(204).json();
  }
);

const systemAdminPasswordChange = catchAsyncErrors(
  async (req, res, next) => {
    const account = await Account.findOne({
      _id: req.params.accountId,
      role: { $in: ['admin', 'sub-admin', 'agent'] },
    });
    // if account does not exist send err
    if (!account) {
      return next(new ServerError('Account not found', 401));
    }

    // if (account.role === 'admin'account._id.equals(req.account.id)) {

    // }
    // reset password to default and force account to update password
    account.password = generateDfPassword(account.firstname, account.lastname);

    await account.save();

    res.json();
  }
);

const router$1 = express.Router();

const parentRoute = '/accounts';

const systemParentRoute = `/system${parentRoute}`;

/** AUTHENTICATED */

// logout
router$1.post(`${parentRoute}/signout`, authenticate(), signout);

// fetch my account
router$1.get(`${parentRoute}/my-account`, authenticate(), getMyAccount);

/** NOT AUTHENTICATED */

router$1.post(`${parentRoute}/signup`, uploader().single('avatar'), signup);

router$1.post(`${parentRoute}/signin`, signin);

router$1.post(`${parentRoute}/forgot-my-password`, forgotMyPassword);

router$1.patch(`${parentRoute}/reset-my-password/:resetToken`, resetMyPassword);

/** AUTHENTICATED */

router$1.patch(
  `${parentRoute}/change-my-password`,
  authenticate(),
  changeMyPassword
);

router$1.patch(
  `${parentRoute}/update-my-account`,
  authenticate(),
  updateMyAccount
);

// verify account
router$1.get(`${parentRoute}/verify/:code`, authenticate(), verifyAccount);

// send verification code
router$1.get(
  `${parentRoute}/verification-code`,
  authenticate(),
  sendVerficationCode
);

// SYSTEM ROUTES
router$1.post(`${systemParentRoute}/signin`, systemSignIn);
router$1.post(`${systemParentRoute}/signout`, authenticate('system'), signout);
router$1.patch(
  `${systemParentRoute}/change-my-password`,
  authenticate('system'),
  changeMyPassword
);

// ADMIN ROUTES
router$1.get(
  `${systemParentRoute}/my-account`,
  authenticate('system'),
  getMyAccount
);

router$1.post(
  `${systemParentRoute}/create-account`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminCreateAccount
);
router$1.patch(
  `${systemParentRoute}/update-account/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminAccountUpdate
);
router$1.delete(
  `${systemParentRoute}/delete-account/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminRemoveAccount
);
router$1.patch(
  `${systemParentRoute}/change-password/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminPasswordChange
);

const router = express.Router();

// server main routes
router.use('/', router$1);
router.use('/', router$2);

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

// setup all middleware functions
const setupExpressMiddleware = server => {
  // setup environment variables
  dotenv.config();

  // parse json
  server.use(express.json());

  // parse form data
  server.use(express.urlencoded({ extended: true }));

  // setup cors
  // server.use(cors());
  server.use(
    cors({
      origin: 'http://localhost:3000',
      credentials: true,
    })
  );

  // parse cookies
  server.use(cookieParser());

  // setup compression
  server.use(compress());

  // setup helmet to protect server
  server.use(helmet());

  // serve static files
  server.use(express.static(path.resolve(__dirname, 'public')));

  // sanitize every source of user input
  // Request Body, URL Parameters, URL Query Parameters
  server.use(mongoSanitize());

  // server.get('api./subdomain', (req, res) => res.send('Test working...'));

  // WEB SERVER ROUTES
  server.use('/', router$3);

  // API ROUTES
  server.use('/api/v1', router);

  // Handle 404 Not found
  server.all('*', unroutable);

  // Global Error handler
  server.use(globalErrorHandler);
};

// Port listener
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
