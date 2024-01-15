import multer from 'multer';
import sharp from 'sharp';
import { uploadToS3 } from './s3';
import { ServerError } from './handlers/errors';
import uniqid from 'uniqid';
import { sign } from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import { booleanPointInPolygon, point, polygon } from '@turf/turf';

export const objectAssign = (source, target, options = { mode: '' }) => {
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
export const deleteProps = (src, ...props) =>
  props.forEach(prop => delete src[prop]);

export const generateJwt = (
  id,
  expiresIn = process.env.JWT_EXPIRATION_TIME || '30d'
) => {
  return sign({ id }, process.env.JWT_SECRET || 'secret', {
    expiresIn,
  });
};

export const uploader = limits => {
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

export const isFullHd = async file => {
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

export const createFileCopies = async (source, dimensions = []) => {
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

export const convertToWebp = async (file, quality = 100) => {
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

export const uploadAvatar = async (file, account) => {
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

export const uploadPropertyImages = async (images, property) => {
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
};

export const sendEmail = async content => {
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

export const hashToken = raw => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

export const setCookie = (res, name, value, options = {}) => {
  options = { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, ...options };
  res.cookie(name, value, options);
};

export const generateAccountEmail = (fn = '', ln = '') => {
  // random number from 0 - 1000
  const random = Math.round(Math.random() * 1000);
  // company email extension @company.com
  const ext = process.env.SYSTEM_EMAIL_EXT;
  // combine user info and random num + ext to generate a unique email
  return fn + ln + random + ext;
};

export const generateDfPassword = (fn = '', ln = '') => {
  return `PASS-${fn.slice(0, 2)}${ln.slice(0, 2)}`;
};

export const parseStringToBoolean = (source = {}, ...properties) => {
  for (let property of properties) {
    if (source[property] === 'true' || source[property] === '')
      source[property] = true;
    if (source[property] === 'false') source[property] = false;
  }
  return source;
};

export const formatSrset = srcSet => {
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

export const insideGuinea = async coordinates => {
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

    const place = point(coordinates);

    const area = polygon(guineaCoordinates);

    return booleanPointInPolygon(place, area);
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

export const buildSearchStage = (
  searchTerm,
  { northEastBounds, southWestBounds }
) => {
  console.log('northEastBounds', northEastBounds);
  console.log('southWestBounds', southWestBounds);

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

  console.log('SearchStage', searchStage);

  // return built search stage based on above scenarios
  return searchStage;
};

export const buildFilterStage = query => {
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
    $match: JSON.parse(filterObjectString),
  };
};

export const buildSortStage = string => {
  if (!string) return;

  const sortObject = {};

  // -createdAt createdAt
  const firstLetter = string[0];

  if (firstLetter === '-') {
    // copy string but exclude the -
    const propertyName = string.slice(1);
    // set sortObject to decending
    sortObject[propertyName] = -1;
  }
  // set sortObject property to ascending
  else sortObject[string] = 1;
  // return stage

  return {
    $sort: sortObject,
  };
};

export const buildLimitStage = limit => ({ $limit: limit });

export const buildCountStage = fieldName => {
  // if user doesn't pass a field name return
  if (!fieldName || !fieldName.length) return;
  return { $count: fieldName };
};

export const buildSkipStage = offset => ({
  $skip: offset,
});

export const imageLookupStage = {
  from: 'propertyImages',
  localField: '_id',
  foreignField: 'propertyId',
  as: 'images',
};

export const ownerLookupStage = [
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

export const between = (num, min, max) => {
  if (num < min) num = min;
  if (num > max) num = max;
  return num;
};

export const calculatePagination = (total, page = 1, limit) => {
  // minimum limit permitted
  const minLimit = 1;
  // maximum limit permitted
  const maxLimit = 200;
  // parsed limit defaults to 50 if not provided
  // const limitInt = parseInt(limit) || 100;
  const limitInt = parseInt(limit) || 5;

  // get limit number between min & max
  limit = between(limitInt, minLimit, maxLimit);

  const pageInt = parseInt(page) || 1;
  // minimum page permitted
  const firstPage = total > 0 ? 1 : 0;
  // calculated number of pages
  const pages = Math.ceil(total / limit);
  // maximum page permitted
  const lastPage = pages;
  // get page number between min & max
  page = between(pageInt, firstPage, lastPage);

  // calculate prev
  const prevPage = firstPage < page ? page - 1 : null;
  // calculate next
  const nextPage = lastPage > page ? page + 1 : null;

  // calculate skip
  let skip = (page - 1) * limit;

  // make sure skip is not negative
  skip = skip >= 0 ? skip : 0;

  // return pagination info
  return {
    limit,
    page,
    pages,
    total,
    prevPage,
    nextPage,
    skip,
  };
};

// this takes stages and exclude empty stage
export const buildPipeline = (...stages) => stages.filter(stage => stage);

export const preProcessImage = property => {
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
