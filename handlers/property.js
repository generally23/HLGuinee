import { ServerError, catchAsyncErrors } from './errors';
import Property from '../schemas/property';
import { removeFroms3 } from '../s3';
import { objectAssign, paginateModel, uploadPropertyImages } from '../utils';

export const fetchProperties = catchAsyncErrors(async (req, res, next) => {
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

export const createProperty = catchAsyncErrors(async (req, res, next) => {
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

export const updateProperty = catchAsyncErrors(async (req, res, next) => {
  // don't allow anyone to update property owner
  delete req.body.ownerId;

  const property = await Property.findById(req.params.id);

  if (!property) {
    // error
    return next(
      new ServerError('This property does not exist on our server', 404)
    );
  }

  if (
    !property.ownerId.equals(req.account.id) ||
    req.account.role !== process.env.MASTER_ROLE ||
    'admin'
  ) {
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
  const property = await property.findById(req.params.id);

  if (!property) {
    return next(
      new ServerError('This property does not exist on our server', 404)
    );
  }

  if (
    !property.ownerId.equals(req.account.id) ||
    req.account.role !== process.env.MASTER_ROLE ||
    'admin'
  ) {
    return next(
      new ServerError(
        'You do not have enough credentials to perform this action',
        404
      )
    );
  }

  await Property.deleteOne({ _id: property.id });

  res.status(204).json();
});

export const addPropertyImages = catchAsyncErrors(async (req, res, next) => {
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
      new ServerError('This property does not exist on our server', 404)
    );
  }

  // only owner is allowed to add images to a property
  if (!property.ownerId.equals(req.account.id)) {
    return next(
      new ServerError('You are not allowed to perform this action', 404)
    );
  }

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

  await uploadPropertyImages(images, property, next);

  res.json(property);
});

export const removePropertyImage = catchAsyncErrors(async (req, res, next) => {
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
      new ServerError('This property does not exist on our server', 404)
    );
  }

  // allow only owner and admin to delete image
  if (!property.ownerId.equals(account.id)) {
    return next(
      new ServerError('You are not allowed to perform this action', 403)
    );
  }

  // try to find the image to be deleted
  const image = property.imagesNames.find(
    (imageObject) => imageObject.sourceName === imageName
  );

  if (!image) {
    return next(
      new ServerError('This image does not exist on our server', 404)
    );
  }

  await removeFroms3(imageName);

  property.imagesNames = imagesNames.filter(
    (imageObject) => imageObject.sourceName !== imageName
  );

  await property.save();

  res.json();
});
