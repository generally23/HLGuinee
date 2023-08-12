import multer from 'multer';
import sharp from 'sharp';
import { uploadToS3 } from './s3';
import { ServerError } from './handlers/errors';
import uid from 'uniqid';
import { sign } from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

export const objectAssign = (source, target) => {
  if (!source || !target) {
    return;
  }
  for (let key in source) {
    if (source[key]) target[key] = source[key];
  }
};

// delete properties from a source object
export const deleteProps = (src, ...props) => {
  props.forEach((prop) => delete src[prop]);
};

export const generateJwt = (
  id,
  expiresIn = process.env.JWT_EXPIRATION_TIME || '30d'
) => {
  return sign({ id }, process.env.JWT_SECRET_KEY || 'secret', {
    expiresIn,
  });
};

export const uploader = (limits) => {
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

export const isFullHd = async (file) => {
  if (!file) return;
  // get image dimensions
  const { width, height } = await sharp(file.buffer).metadata();
  // if width & height >= FHD image passes test
  if (width >= 1920 && height >= 1080) return true;
  // image fails test
  return false;
};

export const createFileCopies = async (source, dimensions = []) => {
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

export const convertToWebp = async (file, quality = 100) => {
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

export const uploadAvatar = async (file, account, next) => {
  if (file && account) {
    // change avatar name
    file.originalname = `avatar-${account.id}`;
    // check if image is at least 1920x1080(FHD)
    const isAccepted = isFullHd(file);

    // send error if image is low quality < FHD
    if (!isAccepted) {
      return next(new ServerError('Please upload a high quality image', 400));
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

export const uploadPropertyImages = async (images, property, next) => {
  for (let image of images) {
    // rename property images
    image.originalname = `property-img-${uid()}`;

    // make sure images match our criterias
    const isHighRes = await isFullHd(image);

    // send error if images are not clear (hd)
    if (!isHighRes) {
      return next(new ServerError('Please upload high resolution images', 400));
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

export const paginateModel = async (
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

export const sendEmail = async (content) => {
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

export const hashToken = (raw) => {
  return crypto.createHash('sha256').update(raw).digest('hex');
};

export const setCookie = (res, name, value, options) => {
  options = { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, ...options };
  res.cookie(name, value, options);
};
