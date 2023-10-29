import { ServerError, catchAsyncErrors } from './errors';
import Property from '../schemas/property';
import { removeFroms3 } from '../s3';
import {
  Pipeline,
  buildFilterStage,
  buildPipeline,
  buildSearchStage,
  buildSortStage,
  insideGuinea,
  isNearGuinea,
  objectAssign,
  paginateModel,
  uploadPropertyImages,
} from '../utils';

export const fetchProperties = catchAsyncErrors(async (req, res, next) => {
  console.log('Request Query: ', req.query);
  // latitude of client
  const latitude = parseFloat(req.headers.latitude);
  // longitude of client
  const longitude = parseFloat(req.headers.longitude);
  // radius is in km convert it to meters 1km => 1000m
  const radius = parseInt(req.headers.radius) * 1000 || 10_000;

  console.log('Lng: ', longitude, 'Lat: ', latitude, 'Radius: ', radius);

  // this filter finds properties near a given client location
  const geoFilter = {
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        // $maxDistance: radius,
      },
    },
  };

  const { search, type, documented, page = 1, limit = 100 } = req.query;
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

export const fetchProperties2 = catchAsyncErrors(async (req, res, next) => {
  // latitude of client
  const latitude = parseFloat(req.headers.latitude);
  // longitude of client
  const longitude = parseFloat(req.headers.longitude);
  // radius is in km convert it to meters 1km => 1000m
  const radius = parseInt(req.headers.radius) * 1000 || 500_000;

  console.log('Lng: ', longitude, 'Lat: ', latitude, 'Radius: ', radius);

  const { search, sortBy, limit, page } = req.query;

  // search stage
  const searchStage = buildSearchStage(search, { longitude, latitude, radius });

  // filter stage
  const filterStage = buildFilterStage(req.query);

  // sort stage
  const sortStage = buildSortStage(sortBy);

  // contains pagination info
  const pagination = {};
  // paginate data

  const pipeline = buildPipeline(searchStage, filterStage, sortStage);

  const properties = await Property.aggregate(pipeline);

  res.json(properties);
});

export const createProperty = catchAsyncErrors(async (req, res, next) => {
  const { location } = req.body;

  // send an error if no location is passed
  if (!location)
    return next(
      new ServerError('Cannot create a property without a location', 400)
    );

  // check to see if coordinates are in Guinea
  const fullyInGuinea = await insideGuinea(location.coordinates);

  if (!fullyInGuinea)
    return new ServerError('Cannot create a property outside of Guinea', 400);

  // create new property
  const property = new Property(req.body);

  // if promo period hasn't expired auto publish property for free
  // promo is 1 year so convert down to milliseconds
  const promoPeriod =
    parseInt(process.env.PROMO_PERIOD) * 12 * 30 * 24 * 60 * 60 * 1000;

  const promoStartDate = parseInt(process.env.PROMO_START_DATE);

  // promo is still running
  if (promoStartDate + promoPeriod > Date.now()) property.published = true;

  // associate property to it's owner
  property.ownerId = req.account.id;

  // save property to DB
  await property.save();

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

export const removePropertyImages = catchAsyncErrors(async (req, res, next) => {
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
