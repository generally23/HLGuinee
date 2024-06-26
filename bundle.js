'use strict';

var express = require('express');
var path = require('path');
var mongoose = require('mongoose');
var helmet = require('helmet');
var cors = require('cors');
var compress = require('compression');
var cookieParser = require('cookie-parser');
var dotenv = require('dotenv');
var mongoSanitize = require('express-mongo-sanitize');
var multer = require('multer');
var sharp = require('sharp');
var clientS3 = require('@aws-sdk/client-s3');
var uniqid = require('uniqid');
var jsonwebtoken = require('jsonwebtoken');
var crypto = require('crypto');
var fs = require('fs/promises');
var turf = require('@turf/turf');
var argon = require('argon2');
var emailValidator = require('email-validator');
var resend = require('resend');
var pug = require('pug');
var expressQueryParser = require('express-query-parser');

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
  // console.error('The Error Happened Here!!! : ', err, err.operational);

  const { ENVIRONMENT = 'dev' } = process.env;

  console.log(ENVIRONMENT);

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
        .json({ message: `Une erreur s'est produite`, statusCode: 500 });
    }
  }
};

const objectAssign = (source, target, options = { mode: '' }) => {
  if (!source || !target) return;

  for (let key in source) {
    //  non strict mode just assign values even falsy ones
    if (options.mode === 'nostrict') target[key] = source[key];
    // use strict mode
    else {
      if (source[key]) target[key] = source[key];
    }
  }
};

// delete properties from a source object
const deleteProps = (src, ...props) =>
  props.forEach(prop => delete src[prop]);

const generateJwt = (
  id,
  expiresIn = process.env.JWT_EXPIRATION_TIME
) => {
  return jsonwebtoken.sign({ id }, process.env.JWT_SECRET, {
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

  // if width or height is not FHD+ test fails
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

const uploadAvatar = async (file, account) => {
  if (file && account) {
    // change avatar name
    file.originalname = `avatar-${account.id}-${uniqid()}`;

    // convert original file to webp
    const webpAvatar = await convertToWebp(file);

    // resize image to 500px with while maintaing aspect ratio
    webpAvatar.buffer = await sharp(webpAvatar.buffer).resize(500).toBuffer();

    await uploadToS3([webpAvatar]);

    account.avatarUrl = `${process.env.CLOUDFRONT_URL}/${webpAvatar.originalname}`;

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
      throw new ServerError(
        'Seul des images de haute qualité (hd) sont permises',
        400
      );
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

const formatSrset = srcSet => {
  srcSet = !srcSet ? [] : srcSet;

  let formatted = '';

  const { length } = srcSet;

  for (let i = 0; i < length; i++) {
    // get current source
    const source = srcSet[i];

    // split url string by -
    const parts = source.split('-');

    // width is the last item and is a string number
    const width = parts[parts.length - 1];

    // formatted will add newly constructed string with a comma and a space if not last item
    formatted +=
      i < length - 1
        ? `${parts.join('-')} ${width}w, `
        : `${parts.join('-')} ${width}w`;
  }

  return formatted;
};

const insideGuinea = async coordinates => {
  if (!coordinates || coordinates.length !== 2) return false;

  try {
    // read file
    const file = await fs.readFile(
      path.resolve(`${__dirname}/public/assets/guinea.geojson`)
    );

    // parse file to json
    const parsedFile = JSON.parse(file);

    // get coordinates from file
    const guineaCoordinates = parsedFile.features[0].geometry.coordinates;

    const place = turf.point(coordinates);

    const area = turf.multiPolygon(guineaCoordinates);

    return turf.booleanPointInPolygon(place, area);
  } catch (e) {
    throw e;
  }
};

const isGeoSearchAllowed = (northEastBounds, southWestBounds) => {
  return (
    northEastBounds &&
    northEastBounds.length === 2 &&
    southWestBounds &&
    southWestBounds.length === 2
  );
};

const buildSearchStage = (
  searchTerm,
  { northEastBounds, southWestBounds }
) => {
  // console.log('northEastBounds', northEastBounds);
  // console.log('southWestBounds', southWestBounds);

  // mongodb atlas search index name
  const index = 'main_search';
  // check to see if the user is inside guinea's bounding box
  const geoSearchAllowed = isGeoSearchAllowed(northEastBounds, southWestBounds);

  if (!geoSearchAllowed) return;

  // search stage
  const searchStage = { $search: { index } };

  // text search query
  // const textQuery = {
  //   query: searchTerm,
  //   path: ['title', 'tags', 'description', 'address'],
  //   fuzzy: {},
  // };

  // geo search query
  const geoQuery = {
    path: 'location',
    box: {
      bottomLeft: {
        type: 'Point',
        coordinates: southWestBounds,
      },
      topRight: {
        type: 'Point',
        coordinates: northEastBounds,
      },
    },
  };

  searchStage.$search.geoWithin = geoQuery;

  // return built search stage based on above scenarios
  return searchStage;
};

const buildFilterStage = query => {
  const today = new Date();

  const weekAgo = new Date();

  weekAgo.setDate(weekAgo.getDate() - 7);

  const filterObject = {};

  const filters = [
    'type',
    'purpose',
    'price',
    'area',
    'areaBuilt',
    'yearBuilt',
    'fenced',
    'bathrooms',
    'garages',
    'kitchens',
    'livingRooms',
    'diningRooms',
    'pools',
    'rooms',
  ];

  for (let filter of filters) filterObject[filter] = query[filter];

  const regexp = /(lte)|(gte)/g;

  const filterObjectString = JSON.stringify(filterObject).replace(
    regexp,
    value => `$${value}`
  );

  return {
    $match: {
      // these are default filters
      $or: [
        { status: { $in: ['listed', 'pending'] } },
        {
          status: { $in: ['sold', 'rented'] },
          statusChangeDate: { $lte: today, $gte: weekAgo },
        },
      ],
      ...JSON.parse(filterObjectString),
    },
  };
};

const buildSortStage = sortBy => {
  if (!sortBy || typeof sortBy !== 'string') return;

  // use _id as a separator when sort ties
  const ascSort = { [sortBy]: 1, _id: -1 };

  const descSort = { [sortBy.slice(1)]: -1, _id: -1 };

  if (sortBy.startsWith('-')) return { $sort: descSort };

  return { $sort: ascSort };
};

const ownerLookupStage = [
  {
    $lookup: {
      from: 'accounts',
      localField: 'ownerId',
      foreignField: '_id',
      as: 'owner',
    },
  },
  {
    $set: {
      owner: { $arrayElemAt: ['$owner', 0] },
    },
  },
];

const calculatePagination = (total, page = 1, limit = 50) => {
  // Minimum and maximum limits permitted
  const MIN_LIMIT = 1;
  const MAX_LIMIT = 200;

  // Parse limit to integer and ensure it's within limits
  const parsedLimit = Math.min(Math.max(parseInt(limit), MIN_LIMIT), MAX_LIMIT);

  // Parse page to integer and ensure it's within limits
  const parsedPage = Math.max(1, parseInt(page));

  // Calculate number of pages
  const totalPages = Math.ceil(total / parsedLimit);

  // Calculate previous page number
  const prevPage = parsedPage > 1 ? parsedPage - 1 : null;

  // Calculate next page number
  const nextPage = parsedPage < totalPages ? parsedPage + 1 : null;

  // Calculate skip (offset)
  const skip = Math.max(0, (parsedPage - 1) * parsedLimit);

  return {
    limit: parsedLimit,
    page: parsedPage,
    pages: totalPages,
    total,
    prevPage,
    nextPage,
    skip,
  };
};

// this takes stages and exclude empty stage
const buildPipeline = (...stages) => stages.filter(stage => stage);

const preProcessImage = property => {
  if (!property) return;

  const { CLOUDFRONT_URL } = process.env;
  const { imagesNames } = property;

  return imagesNames.map(({ sourceName, names }) => {
    const smallestImage = names[0];
    return {
      sourceName: sourceName,
      src: `${CLOUDFRONT_URL}/${smallestImage}`,
      srcset: formatSrset(names.map(name => `${CLOUDFRONT_URL}/${name}`)),
    };
  });
};

const getPropertyThumbnail = images => {
  const { CLOUDFRONT_URL } = process.env;
  const placeholderImage = {
    src: `${CLOUDFRONT_URL}/default-property-thumbnail.png`,
    srcset: '',
  };

  return images[0] || placeholderImage;
};

const locationSchema = new mongoose.Schema({
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

const imageSchema = new mongoose.Schema({
  sourceName: {
    type: String,
    required: [true, 'sourceName est réquis'],
  },
  names: [String],
});

const price = {
  type: Number,
  required: [true, 'Un bien doit avoir un prix'],
  validate: {
    validator: function () {
      const { purpose, price } = this;

      const rentMin = 100_000;
      const rentMax = 10_000_000;

      const buyMin = 10_000_000;
      const buyMax = 900_000_000_000;

      if (purpose === 'rent') return price >= rentMin && price <= rentMax;

      if (purpose === 'sell') return price >= buyMin && price <= buyMax;

      return false;
    },
    message:
      "Le prix d'un bien doit être entre 100.000FG et 10.000.000FG pour les maisons à louer et 10.000.000FG à 900.000.000.000FG pour les biens à vendre",
  },
};

// create ascending & desc index in a field in one go
const createAscDescIndex = (schema, field) => {
  schema.index({ [field]: 1 });
  schema.index({ [field]: -1 });
};

// house validator
// const validator = value => value !== 'house';

// SCHEMA
const propertySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, 'Un bien doit être soit une maison où un terrain'],
      enum: ['house', 'land'],
      lowercase: true,
    },

    purpose: {
      type: String,
      enum: ['rent', 'sell'],
      required: [true, 'Un motif du bien est réquis, soit a vendre où a louer'],
      validate: {
        validator(value) {
          // property can't be land and be rented for now
          if (this.type === 'land' && value !== 'sell') return false;
          return true;
        },
      },
    },

    price,

    // only allowed for houses
    // rentPeriod: {
    //   type: String,
    //   default: function () {
    //     return this.type === 'house' ? 'monthly' : undefined;
    //   },
    //   enum: ['monthly'],
    // },

    ownerId: {
      required: [true, 'Un bien doit avoir un propriétaire'],
      type: mongoose.Schema.Types.ObjectId,
    },

    location: {
      type: locationSchema,
      required: [true, 'Un bien doit avoir une localisation GPS'],
    },

    // documented: {
    //   type: Boolean,
    // },

    address: {
      type: String,
      required: [true, 'Un bien doit avoir un quartier'],
      lowercase: true,
    },

    imagesNames: [imageSchema],

    area: {
      type: Number,
      required: [true, 'Surface est réquise'],
    },

    areaBuilt: {
      type: Number,
      required: [
        function () {
          this.type === 'house';
        },
        'Surface Batie est réquise',
      ],
    },

    areaUnit: {
      type: String,
      required: [true, 'Unité de surface réquise'],
      default: 'm²',
    },

    title: {
      type: String,
      max: [60, 'Un titre ne peut pas être plus de 60 lettres'],
      required: [true, `Un bien a besoin d'un titre`],
    },

    description: {
      type: String,
      required: ['Une description est réquise'],
      max: [1500, 'Une description ne peut pas être plus de 512 lettres'],
    },

    status: {
      type: String,
      required: [true, 'Status est réquis'],
      enum: ['reviewing', 'unlisted', 'listed', 'pending', 'sold', 'rented'],
      default: 'unlisted',
    },

    rooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'Chambres est réquise',
      ],
    },

    bathrooms: {
      type: Number,
      required: [
        function () {
          return this.type === 'house';
        },
        'Douches est réquis is required',
      ],
    },

    kitchens: {
      type: Number,
      default: function () {
        return this.type === 'house' ? 0 : undefined;
      },
      required: [
        function () {
          return this.type === 'house';
        },
        'Cuisine est réquise',
      ],
    },

    garages: {
      type: Number,
      default: function () {
        return this.type === 'house' ? 0 : undefined;
      },
      required: [
        function () {
          return this.type === 'house';
        },
        'Garages est réquis',
      ],
    },

    diningRooms: {
      type: Number,
      default: function () {
        return this.type === 'house' ? 0 : undefined;
      },
      required: [
        function () {
          return this.type === 'house';
        },
        'diningRooms is required',
      ],
    },

    livingRooms: {
      type: Number,
      default: function () {
        return this.type === 'house' ? 0 : undefined;
      },
      required: [
        function () {
          return this.type === 'house';
        },
        'livingRooms is required',
      ],
    },

    yearBuilt: {
      type: Number,
      // minium property built year
      min: [1800, 'Un bien ne peut pas etre construit avant 1800'],
      // don't allow property buil year to be in the future
      max: [
        new Date().getFullYear(),
        'Un bien ne peut pas etre construit dans le future',
      ],
      required: [
        function () {
          return this.type === 'house';
        },
        'Une maison doit avoir une année de construction',
      ],
    },

    // cloturé
    fenced: {
      type: Boolean,
      default: function () {
        return this.type === 'house' ? false : undefined;
      },
      required: [true, 'Cloture est réquise'],
    },

    pools: {
      type: Number,
      default: function () {
        return this.type === 'house' ? 0 : undefined;
      },
      required: [
        function () {
          return this.type === 'house';
        },
      ],
    },

    tags: [String],

    // platform related properties
    publishDate: Date,
    unPublishDate: Date,

    statusChangeDate: Date,

    paymentStatus: {
      type: String,
      enum: ['paid', 'unpaid'],
      default: 'unpaid',
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Index all sortable fields

createAscDescIndex(propertySchema, 'price');
createAscDescIndex(propertySchema, 'title');
createAscDescIndex(propertySchema, 'rooms');
// createAscDescIndex(propertySchema, 'address');
createAscDescIndex(propertySchema, 'area');

// virtuals
propertySchema.virtual('owner', {
  ref: 'Account',
  localField: 'ownerId',
  foreignField: '_id',
  justOne: true,
});

propertySchema.virtual('images').get(function () {
  // property
  return preProcessImage(this);
});

// methods
propertySchema.methods.toJSON = function () {
  // property clone
  const property = this.toObject();

  property.images = preProcessImage(property);

  // append it a thumbnail image as the 1st image
  property.thumbnail = getPropertyThumbnail(property.images);

  // remove props from user object
  deleteProps(property, 'imagesNames', '__v');

  // return value will be sent to client
  return property;
};

propertySchema.methods.changeStatus = async function (newStatus, errorMessage) {
  const allStates = ['unlisted', 'listed', 'pending', 'sold', 'rented'];

  const transitions = {
    listed: allStates,
    unlisted: ['unlisted', 'listed'],
    sold: ['sold', 'listed'],
    rented: ['rented', 'listed'],
    pending: allStates,
  };
  // get status from property
  const property = this;

  const isAllowed = transitions[property.status].includes(newStatus);

  if (!isAllowed) throw Error(errorMessage);

  property.status = newStatus;
  property.statusChangeDate = Date.now();

  return property.save();
};

propertySchema.methods.list = async function () {
  // make sure user has payed

  await this.changeStatus('listed', 'This property already listed!');
};

propertySchema.methods.unlist = async function () {
  await this.changeStatus('unlisted', "You can't unlist this property now");
};

propertySchema.methods.markPending = async function () {
  await this.changeStatus('pending', 'There are some errors in your data');
};

propertySchema.methods.isBuyout = function () {
  return this.purpose === 'sell';
};

propertySchema.methods.isRental = function () {
  return this.purpose === 'rent';
};

propertySchema.methods.markSold = async function () {
  // make sure this is a buyout
  if (!this.isBuyout()) throw Error("Can't mark as sold a renting property!");

  await this.changeStatus('sold', 'This property is not available for sale');
};

propertySchema.methods.markRented = async function () {
  // make sure this is a rental
  if (!this.isRental()) throw Error("Can't mark as rent a selling property!");

  await this.changeStatus('rented', 'This property is not available for rent');
};

const Property = mongoose.model('Property', propertySchema);

const NO_LOCATION_ERROR_MESSAGE =
  'Vous ne pouvez pas poster un bien sans les coordonées geographiques';

const LOCATION_INVALID_ERROR_MESSAGE =
  'Cannot create a property outside of Guinea';

const PROPERTY_NOTFOUND_ERROR_MESSAGE =
  'This property does not exist on our server';

const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 40;

const MAX_IMAGE_ALLOWED_ERROR_MESSAGE = `Un bien ne peut pas avoir plus de ${maxImagesLength} photos`;

const NOT_PERMITTED_ERROR_MESSAGE = `Vous n'êtes pas permis de performer ces actions`;

// don't allow anyone to update these properties
const immutableProps = [
  'ownerId',
  'status',
  'publishDate',
  'unPublishDate',
  'statusChangeDate',
];

// this is used as a patch for now but is to be redesigned later
const houseOnlyProps = [
  'areaBuilt',
  'rooms',
  'bathrooms',
  'kitchens',
  'garages',
  'diningRooms',
  'livingRooms',
  'yearBuilt',
  'pools',
];

const fetchProperties = catchAsyncErrors(async (req, res, next) => {
  const { north_east_bounds, south_west_bounds } = req.headers;

  // location of user fetching properties
  const userLocation = {
    // bounds comes coupled as a comma separated string (lng,lat)
    // split it and parse it to be a float number
    northEastBounds: north_east_bounds
      ? north_east_bounds.split(',').map(parseFloat)
      : north_east_bounds,
    southWestBounds: south_west_bounds
      ? south_west_bounds.split(',').map(parseFloat)
      : south_west_bounds,
  };

  // console.log('User Location: ', userLocation);

  // request queries
  const { search, sortBy, limit, page } = req.query;

  // search stage
  const searchStage = buildSearchStage(search, userLocation);

  // filter stage
  const filterStage = buildFilterStage(req.query);

  // sort stage
  const sortStage = buildSortStage(sortBy);

  const pipeline = buildPipeline(searchStage, filterStage, sortStage);

  // get properties count
  const countResults = await Property.aggregate(pipeline).count('total');

  const propertyCount = countResults.length ? countResults[0].total : 0;

  // get pagination info
  const pagination = calculatePagination(propertyCount, page, limit);

  const properties = await Property.aggregate(pipeline)

    .skip(pagination.skip)
    .limit(pagination.limit)
    // use append because owner is an array to be transformed into an object
    .append(ownerLookupStage);

  // preprocess images for this property to serve client the right content
  properties.forEach(property => {
    property.images = preProcessImage(property);

    // append it a thumbnail image as the 1st image
    property.thumbnail = getPropertyThumbnail(property.images);

    // remove property names from the property object
    delete property.imagesNames;
  });

  console.log('Filters: ', filterStage);

  // console.log('Sort Object: ', sortStage);

  res.json({ ...pagination, properties, filterStage });
});

const createProperty = catchAsyncErrors(async (req, res, next) => {
  // don't allow anyone to preset these properties at creation time
  deleteProps(req.body, ...immutableProps);

  const { location } = req.body;

  const { account } = req;

  // send an error if no location is passed
  if (!location) return next(new ServerError(NO_LOCATION_ERROR_MESSAGE, 400));

  // check to see if coordinates are in Guinea
  const fullyInGuinea = await insideGuinea(location.coordinates);

  // console.log('In Guinea ?: ', fullyInGuinea);

  if (!fullyInGuinea)
    return next(new ServerError(LOCATION_INVALID_ERROR_MESSAGE, 400));

  // patch delete house props when land type is being created
  if (req.body.type === 'land') deleteProps(req.body, ...houseOnlyProps);

  // create new property
  const property = new Property(req.body);

  // if promo period hasn't expired auto list property for free
  // promo is 1 year so convert down to milliseconds
  const promoPeriod =
    parseInt(process.env.PROMO_PERIOD) * 12 * 30 * 24 * 60 * 60 * 1000;

  const promoStartDate = parseInt(process.env.PROMO_START_DATE);

  // promo is still running
  if (promoStartDate + promoPeriod > Date.now()) property.status = 'listed';

  // associate property to it's owner
  property.ownerId = req.account.id;

  // save property to DB
  await property.save();

  // increment properties count on user's account objectxs
  account.totalListing += 1;
  account.listingCount += 1;

  await account.save();

  res.status(201).json(property);
});

const fetchProperty = catchAsyncErrors(async (req, res, next) => {
  // fetch property
  const property = await Property.findById(req.params.propertyId).populate(
    'owner'
  );

  // send an error if property does not exist
  if (!property) {
    return next(new ServerError(PROPERTY_NOTFOUND_ERROR_MESSAGE, 404));
  }
  // send property
  res.json(property);
});

// gets all other properties except the one being viewed right now
const fetchMyProperties = catchAsyncErrors(async (req, res) => {
  // const { limit = 20, page = 1 } = req.params;

  // const myPropertyCount = await Property.countDocuments({
  //   owner: req.account._id,
  // });

  const { excludedPropertyId, status } = req.query;

  const filterObject = {};

  const ownerId = req.params.accountId || req?.account?.id;

  objectAssign(
    { _id: { $ne: excludedPropertyId }, status, ownerId },
    filterObject
  );

  // const pagination = calculatePagination(myPropertyCount.length, page, limit);

  const myProperties = await Property.find(filterObject)
    .populate('owner')
    .sort('-createdAt');

  // .skip(pagination.skip)
  // .limit(pagination.limit);

  res.json(myProperties);
});

const updateProperty = catchAsyncErrors(async (req, res, next) => {
  deleteProps(req.body, ...immutableProps);

  const property = await Property.findById(req.params.propertyId);

  // error
  if (!property)
    return next(new ServerError(PROPERTY_NOTFOUND_ERROR_MESSAGE, 404));

  // make sure only owner is allowed to update
  if (!property.ownerId.equals(req.account.id))
    return next(new ServerError(NOT_PERMITTED_ERROR_MESSAGE, 403));

  // patch delete house props when updating a land type property
  if (property.type === 'land') deleteProps(req.body, ...houseOnlyProps);

  console.log(req.body);

  objectAssign(req.body, property, { mode: 'nostrict' });

  await property.save();

  res.json(property);
});

const changePropertyStatus = catchAsyncErrors(async (req, res, next) => {
  const property = await Property.findById(req.params.propertyId);

  const { newStatus } = req.query;

  if (!property) return next(new ServerError('Property not found'));

  const actions = {
    listed: 'list',
    unlisted: 'unlist',
    pending: 'markPending',
    sold: 'markSold',
    rented: 'markRented',
  };

  const currentAction = actions[newStatus];

  if (currentAction) await property[currentAction]();

  res.status(201).json(property);
});

const removeProperty = catchAsyncErrors(async (req, res, next) => {
  return res.json();
});

const addPropertyImages = catchAsyncErrors(async (req, res, next) => {
  // find property
  const property = await Property.findOne({
    _id: req.params.propertyId,
    ownerId: req.account.id,
  });

  // send an error if property is not found
  if (!property) {
    return next(new ServerError(PROPERTY_NOTFOUND_ERROR_MESSAGE, 404));
  }

  // how many images are stored for this property
  const propertyImagesLength = property.imagesNames.length;
  // uploaded images
  const uploadedImages = req.files || [];

  // maximum number of images allowed for a single property
  const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 30;

  if (
    propertyImagesLength >= maxImagesLength ||
    propertyImagesLength + uploadedImages.length > maxImagesLength
  ) {
    return next(new ServerError(MAX_IMAGE_ALLOWED_ERROR_MESSAGE, 400));
  }

  res.json(property);

  /* 
    run this in the background
    don't wait for this to finish before responding to client for better UI exp
  */
  uploadPropertyImages(uploadedImages, property);
});

const removePropertyImages = catchAsyncErrors(async (req, res, next) => {
  // account
  const { account } = req;

  // imageName and propertyId
  const { propertyId } = req.params;

  const { names } = req.body;

  // find property
  const property = await Property.findById(propertyId);

  // send an error if property is not found
  if (!property) {
    return next(new ServerError(PROPERTY_NOTFOUND_ERROR_MESSAGE, 404));
  }

  // allow only owner and admin to delete image

  const isOwner = property.ownerId.equals(account.id);

  if (!isOwner) return next(new ServerError(NOT_PERMITTED_ERROR_MESSAGE, 403));

  // imageNames
  const { imagesNames } = property;

  for (let imageName of names) {
    // try to find the image to be deleted
    const image = imagesNames.find(
      imageObject => imageObject.sourceName === imageName
    );

    if (!image) return;

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
      default: 'http://192.169.1.197/assets/images/avatar.avif',
    },

    avatarNames: {
      type: [String],
      unique: true,
    },

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

    // all time total listings
    totalListings: {
      type: Number,
      default: 0,
      required: [true],
    },

    // current total listings
    listingCount: {
      type: Number,
      default: 0,
      required: [true],
    },
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

const authenticate = (type = 'client') => {
  return catchAsyncErrors(async (req, res, next) => {
    let query;

    const authFailError = new ServerError('You are not authenticated', 401);
    // get token
    const token = req.cookies.token || req.headers['authorization'];

    // req.cookies.AUTH_TOKEN;
    // console.log(token);

    // verify token
    try {
      jsonwebtoken.verify(token, process.env.JWT_SECRET);
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
    if (!roles.includes(req.account.role))
      return next(
        new ServerError(
          'You do not have enough credentials to access or perform these actions',
          403
        )
      );

    next();
  };
};

const preventUnverifiedAccounts = catchAsyncErrors(
  async (req, res, next) => {
    const { account } = req;

    if (!account.verified)
      return next(
        new ServerError(
          'Please verify your account to access this ressource',
          403
        )
      );

    next();
  }
);

const router$2 = express.Router();

const propertiesRoute = '/properties';
const propertyRoute = `${propertiesRoute}/:propertyId`;

router$2
  .route(propertiesRoute)
  .get(fetchProperties)
  .post(authenticate(), preventUnverifiedAccounts, createProperty);

// could be in account's router but already went for this approach
// ALIAS ROUTES
// router.get(`/my-properties`, authenticate(), fetchMyProperties);

// router.get(`/my-other-properties`, fetchMyOtherProperties);

router$2
  .route(propertyRoute)
  .get(fetchProperty)
  .patch(authenticate(), updateProperty)
  .delete(authenticate(), removeProperty);

router$2.patch(
  `${propertyRoute}/change-status`,
  authenticate(),
  changePropertyStatus
);

// add images to property
router$2.post(
  `${propertyRoute}/images`,
  authenticate(),
  uploader({ files: 40 }).any(),
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

const EXISTING_ACCOUNT_ERROR_MESSGE = 'Ce compte existe déjà';

const UNEXISTING_ACCOUNT_ERROR_MESSAGE = `Ce compte n'existe pas`;

const INVALID_PASSWORD_ERROR_MESSAGE = 'Ce mot de passe est non valide';

const SAME_PASSWORD_ERROR_MESSAGE = `Votre nouveau mot de passe doit être different de l'actuel`;

const VERIFIED_ACCOUNT_ERROR_MESSAGE = `Votre compte est déjà verifié`;

const VERFIFY_ACCOUNT_FAIL_ERROR_MESSAGE = `Malheureusement, nous n'avions pas pu vérifier votre compte`;

const MAIL_DELIVERY_FAIL_ERROR_MESSAGE = `Malheuresement notre service email n'a pas pu vous délivrer l'email`;

// export const getEmailTransporter = () => {
//   const { SMTP_HOSTNAME, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD } =
//     process.env;

//   const transporter = nodemailer.createTransport({
//     host: SMTP_HOSTNAME,
//     port: SMTP_PORT,
//     auth: {
//       user: SMTP_USERNAME,
//       pass: SMTP_PASSWORD,
//     },
//   });

//   return transporter;
// };

// export const sendEmail = content => {
//   let attempts = 0;
//   let maxAttempts = 3;
//   let timeout = 0;

//   const { SMTP_HOSTNAME, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD } =
//     process.env;

//   const transporter = nodemailer.createTransport({
//     host: SMTP_HOSTNAME,
//     port: SMTP_PORT,
//     auth: {
//       user: SMTP_USERNAME,
//       pass: SMTP_PASSWORD,
//     },
//   });

//   return new Promise((resolve, reject) => {
//     const sender = async () => {
//       attempts++;

//       console.log('I am sending the email ', attempts);

//       if (attempts >= maxAttempts) return reject('failed to send mail');

//       try {
//         await transporter.sendMail(content);

//         resolve('sent');
//       } catch (error) {
//         timeout += 1000;
//         setTimeout(sender, timeout);
//       }
//     };

//     return sender();
//   });
// };

// console.log('API KEY: ', process.env);

const getMailService = () => new resend.Resend(process.env.RESEND_API_KEY);

const getHTMLTemplate = (templateName, locals) => {
  const templatePath = path.resolve(
    __dirname,
    'services',
    'email',
    'templates',
    templateName
  );

  try {
    return pug.renderFile(templatePath, locals);
  } catch (e) {
    return '';
  }
};

const createEmail = (to, subject = '', text = '', html = '', react = '') => {
  return {
    from: process.env.SERVER_EMAIL,
    to,
    subject,
    text,
    html,
    react,
  };
};

const sendEmail = async email => getMailService().emails.send(email);

const sendVerificationEmail = (emailAddress, verificationUrl) => {
  // send email to client
  const subject = 'Verifiez votre compte';

  const to = emailAddress;

  const html = getHTMLTemplate('verification.pug', { verificationUrl });

  const email = createEmail(to, subject, '', html);

  return sendEmail(email);
};

const sendForgotPasswordEmail = (receiverEmail, resetUrl) => {
  const subject = 'Reinitialiser votre mot de passe ✔';

  const html = getHTMLTemplate('reset-password.pug', { resetUrl });

  // send email to client
  const email = createEmail(receiverEmail, subject, '', html, '');

  return sendEmail(email);
};

// REGULAR USER HANDLERS
const signup = catchAsyncErrors(async (req, res, next) => {
  // make sure this account does not exist before we create one
  if (await Account.findOne({ email: req.body.email })) {
    return next(
      new ServerError(`${EXISTING_ACCOUNT_ERROR_MESSGE}. Connecter vous`, 400)
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

  // proccess and upload avatar to s3 => run in background
  uploadAvatar(avatar, account);

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
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError(INVALID_PASSWORD_ERROR_MESSAGE, 401));
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

  // record signout date
  account.signedOut = Date.now();

  // log user out from server
  account.tokens = account.tokens.filter(t => t !== token);

  await account.save();

  // remove cookie (not required)
  res.clearCookie('token');

  res.json({ message: 'Votre compte à été déconnecter avec succès' });
});

const changeMyPassword = catchAsyncErrors(async (req, res, next) => {
  // consider logging out user when password change

  // user current pwd and new pwd
  const { currentPassword, newPassword: password } = req.body;

  // account
  const { account } = req;

  if (currentPassword === password)
    return next(new ServerError(SAME_PASSWORD_ERROR_MESSAGE, 400));

  // validate pwd
  const isPasswordValid = await account.validatePassword(currentPassword);

  // send error if not valid
  if (!isPasswordValid) {
    return next(new ServerError(INVALID_PASSWORD_ERROR_MESSAGE, 401));
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

  const avatar = req.file;

  const { firstname, lastname } = req.body;

  objectAssign({ firstname, lastname }, account);

  await account.save();

  // respond to user
  res.json(account);

  // remove old avatars from s3
  // const oldAvatarNames = account.avatarNames;

  // await removeFroms3(account.);

  // process and update avatar
  uploadAvatar(avatar, account);
});

const deleteMyAccount = catchAsyncErrors(async (req, res, next) => {
  // logout account . remove cookie (not required)
  // res.clearCookie('token');

  // respond to client
  return res.json({ message: 'Votre compte à été supprimer de nos serveurs' });
});

const forgotMyPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;

  const account = await Account.findOne({ email, role: 'client' });

  // send error
  if (!account) {
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
  }

  // generate reset token
  const resetToken = await account.generateResetToken();

  // construct a url to send to the user to reset their password
  const resetUrl = `${req.protocol}://${req.hostname}:3000/reset-password/${resetToken}`;

  try {
    const response = await sendForgotPasswordEmail(email, resetUrl);

    console.log(response);
  } catch (e) {
    console.log(e);

    return next(new ServerError(MAIL_DELIVERY_FAIL_ERROR_MESSAGE));
  }

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
      new ServerError(
        `${UNEXISTING_ACCOUNT_ERROR_MESSAGE} ou le code de verification à expiré`,
        404
      )
    );
  }

  // don't allow account to use the same password as current one
  if (await account.validatePassword(password)) {
    return next(new ServerError(SAME_PASSWORD_ERROR_MESSAGE, 400));
  }

  // update password and default reset token & exp date
  const newUpdates = {
    resetToken: undefined,
    resetTokenExpirationDate: undefined,
    password,
  };

  objectAssign(newUpdates, account, { mode: 'nostrict' });

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
    return next(new ServerError(VERFIFY_ACCOUNT_FAIL_ERROR_MESSAGE, 400));
  }

  if (account.verified) {
    return next(new ServerError(VERIFIED_ACCOUNT_ERROR_MESSAGE, 400));
  }

  // mark account as verified
  objectAssign(
    {
      verified: true,
      verificationCode: undefined,
      verificationCodeExpirationDate: undefined,
    },
    account,
    { mode: 'nostrict' }
  );

  // save account
  await account.save();

  // respond to client
  res.json({ message: 'votre compte à été verifier avec succès' });
});

const sendVerificationCode = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  // don't send code to email if user is already verified
  if (account.verified) {
    return next(new ServerError(VERIFIED_ACCOUNT_ERROR_MESSAGE, 400));
  }

  // generate verification code
  const verificationCode = await account.generateVerificationCode();

  // generate verification code url
  const verificationUrl = `${req.protocol}://${req.hostname}:3000/verify/${verificationCode}`;

  try {
    // send email to client
    await sendVerificationEmail(account, verificationUrl);
  } catch (e) {
    return next(new ServerError(MAIL_DELIVERY_FAIL_ERROR_MESSAGE));
  }

  res.json({ verificationCode, message: 'Email delivré avec succès' });
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
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError(INVALID_PASSWORD_ERROR_MESSAGE, 401));
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
      return next(new ServerError(NOT_PERMITTED_ERROR_MESSAGE, 403));
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
      return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
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

    if (!account)
      return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 404));

    if (
      account.role === 'admin' ||
      (req.account.role === 'sub-admin' &&
        account.role === 'sub-admin' &&
        !account._id.equals(req.account.id))
    )
      return next(new ServerError(NOT_PERMITTED_ERROR_MESSAGE, 403));
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
      return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
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

router$1.get(`${parentRoute}/my-properties`, authenticate(), fetchMyProperties);

// this route gets all my properties & my other properties given an id of property to exclude
router$1.get(`${parentRoute}/:accountId/my-properties`, fetchMyProperties);

// router.get(`${parentRoute}/:accountId/my-other-properties`, fetchMyOtherProperties);

/** AUTHENTICATED */

router$1
  .route(`${parentRoute}/my-account`)

  // fetch my account
  .get(authenticate(), getMyAccount)

  // update my account
  .patch(authenticate(), uploader().single('avatar'), updateMyAccount)

  // remove my account
  .delete(authenticate(), deleteMyAccount);

// logout
router$1.post(`${parentRoute}/signout`, authenticate(), signout);

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

// verify account
router$1.get(`${parentRoute}/verify/:code`, authenticate(), verifyAccount);

// send verification code
router$1.get(
  `${parentRoute}/verification-code`,
  authenticate(),
  sendVerificationCode
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

// API main routes

// Accounts Router
router.use('/', router$1);
// Properties Router
router.use('/', router$2);

// Handle 404 Not found
router.all('/*', unroutable);

// configure  environment variables
dotenv.config();

// start db connection
const connectToDb = async () => {
  try {
    await mongoose.connect(
      process.env.DATABASE_URL
      // || 'mongodb://localhost:27017/houses&lands'
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

    // we can't do anything without db access, shutdown server
    process.exit();
  }
};

const cacheJsFiles = (res, path) => {
  if (!path.endsWith('.js')) return;
  // Enable caching for all javascript files.
  res.setHeader('Cache-Control', 'public, max-age=3600');
};

// setup all middleware functions
const setupExpressMiddleware = server => {
  // parse json
  server.use(express.json());

  // parse form data
  server.use(express.urlencoded({ extended: true }));

  // parse req params
  server.use(expressQueryParser.queryParser({ parseBoolean: true, parseNumber: true }));

  // setup cors
  // server.use(cors());

  server.use(
    cors({
      origin: 'http://192.168.1.197:3000',
      // origin: 'http://localhost:3000',
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
  server.use(
    express.static(path.resolve(__dirname, 'public'), {
      setHeaders: cacheJsFiles,
    })
  );

  // sanitize every source of user input (body, params, req params)
  server.use(mongoSanitize());

  // API ROUTES
  server.use('/api/v1', router);

  // WEB SERVER ROUTES
  // server.use('*', SERVER_ROUTER);

  /* 
    Always serve the same html file since this is a single page app
    React will handle the routing on the client
  */
  server.all('*', (req, res) =>
    res.sendFile(path.resolve(__dirname, 'public', 'index.html'))
  );

  // Global Error handler
  server.use(globalErrorHandler);
};

// Port listener
const listen = async (
  server,
  port = parseInt(process.env.PORT) || 80
) => {
  try {
    await server.listen(port, console.log);
  } catch (error) {
    // we must be able to listen for connection on this port shutdown server
    process.exit();
  }
};

const server = express();

// const maintenanceServer = express();

// setup express middlewares
setupExpressMiddleware(server);

// connect to mongodb
connectToDb();

// listen on determined port
listen(server);

// when server is under maintainance shut it down and use maintenance server
// listen(maintenanceServer);
