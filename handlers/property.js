import { ServerError, catchAsyncErrors } from './errors';
import Property from '../schemas/property';
import { removeFroms3 } from '../s3';
import { objectAssign, paginateModel, uploadPropertyImages } from '../utils';

export const fetchProperties = catchAsyncErrors(async (req, res, next) => {
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

export const createProperty = catchAsyncErrors(async (req, res, next) => {
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

export const fetchProperty = catchAsyncErrors(async (req, res, next) => {
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

export const fetchMyProperties = catchAsyncErrors(async (req, res, next) => {
  res.json(await Property.find({ ownerId: req.account.id }));
});

export const updateProperty = catchAsyncErrors(async (req, res, next) => {
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

export const removeProperty = catchAsyncErrors(async (req, res, next) => {
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

  if (
    !property.ownerId.equals(req.account.id) ||
    !allowedAccounts.includes(req.account.role)
  ) {
    return next(
      new ServerError(
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

export const addPropertyImages = catchAsyncErrors(async (req, res, next) => {
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

  console.log(uploadedImages);
  // maximum number of images allowed for a single property
  const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 12;

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

  await uploadPropertyImages(uploadedImages, property, next);

  res.json(property);
});

export const removePropertyImage = catchAsyncErrors(async (req, res, next) => {
  // account
  const { account } = req;

  // imageName and propertyId
  const { imageName, propertyId } = req.params;

  // find property
  const property = await Property.findById(propertyId);

  // send an error if property is not found
  if (!property) {
    return next(
      new ServerError('This property does not exist on our server', 404)
    );
  }

  // allow only owner and admin to delete image
  console.log(property.ownerId.equals(account.id));
  if (!property.ownerId.equals(account.id)) {
    return next(
      new ServerError('You are not allowed to perform this action', 403)
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
      new ServerError('This image does not exist on our server', 404)
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
