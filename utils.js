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

export const objectAssign = (source, target) => {
  if (!source || !target) {
    return;
  }
  for (let key in source) {
    if (source[key]) target[key] = source[key];
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

export const uploadAvatar = async (file, account, next) => {
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

export const paginateModel = async (
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

export const insideGuinea = async ({ longitude, latitude }) => {
  try {
    // read file
    const file = await fs.readFile(
      path.resolve(`${__dirname}/public/assets/guinea.geojson`)
    );

    // parse file to json
    const parsedFile = JSON.parse(file);

    // get coordinates from file
    const coordinates = parsedFile.features[0].geometry.coordinates;

    const place = point([longitude, latitude]);

    const area = polygon(coordinates);

    return booleanPointInPolygon(place, area);
  } catch (e) {
    throw e;
  }
};

export const isNearGuinea = coordinates => {
  if (!coordinates || coordinates.length !== 2) return false;

  const place = point(coordinates);

  const area = polygon([
    [
      [-15.1303112452, 7.3090373804],
      [-7.83210038902, 7.3090373804],
      [-7.83210038902, 12.5861829696],
      [-15.1303112452, 12.5861829696],
      [-15.1303112452, 7.3090373804],
    ],
  ]);

  return booleanPointInPolygon(place, area);
};

export const buildSearchStage = (
  searchTerm,
  { longitude, latitude, radius }
) => {
  const coordinates = [longitude, latitude];
  // check to see if the user is inside guinea's bounding box
  const isGeoSearchAllowed =
    longitude && latitude ? isNearGuinea(coordinates) : false;

  const textStage = {
    $search: {
      index: '',
      text: {
        query: searchTerm,
        path: ['title', 'tags'],
      },
    },
  };

  const geoStage = {
    $search: {
      index: '',
      geoWithin: {
        circle: {
          center: {
            type: 'Point',
            coordinates: coordinates,
          },
          radius,
        },
        path: 'location',
      },
    },
  };

  // user has not serched for anything and they're not allowed to geo search
  if (!searchTerm && !isGeoSearchAllowed) return;

  if (searchTerm && isGeoSearchAllowed) {
    // use th readius to determine which order to carry out query
    return {
      $search: {
        index: '',
        compound: {
          must: [textStage, geoStage],
        },
      },
    };
  }

  if (searchTerm && !isGeoSearchAllowed) return textStage;

  if (!searchTerm && isGeoSearchAllowed) return geoStage;
};

export const buildFilterStage = query => {
  const filterObject = {};

  const filters = [
    'type',
    'title',
    'price',
    'area',
    'areaBuilt',
    'yearBuilt',
    'fenced',
    'hasBathroom',
    'hasGarage',
    'hasCuisine',
    'hasLivingRoom',
    'hasDiningRoom',
    'hasPool',
    'rooms',
    'externalBathrooms',
    'internalBathrooms',
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

export const buildLimitStage = limit => {
  const maxLimit = 100;

  const numberLimit = parseInt(limit);

  limit = numberLimit <= maxLimit ? numberLimit : maxLimit;

  return { $limit: limit };
};

export const skipStage = page => {};

// export const buildLimitStage = limit => {

// }

// this takes stages and exclude empty stage
export const buildPipeline = (...stages) => stages.filter(stage => stage);
