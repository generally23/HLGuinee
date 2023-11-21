import { ServerError, catchAsyncErrors } from './errors';
import Property from '../schemas/property';
import { removeFroms3 } from '../s3';
import {
  buildFilterStage,
  buildPipeline,
  buildSearchStage,
  buildSortStage,
  calculatePagination,
  insideGuinea,
  objectAssign,
  ownerLookupStage,
  paginateModel,
  preProcessImage,
  uploadPropertyImages,
} from '../utils';

export const fetchProperties = catchAsyncErrors(async (req, res, next) => {
  const { north_east_bounds } = req.headers;
  const { south_west_bounds } = req.headers;

  // location of user fetching properties
  const userLocation = {
    // latitude of client
    latitude: parseFloat(req.headers.latitude),
    // longitude of client
    longitude: parseFloat(req.headers.longitude),

    // bounds comes coupled as a comma separated string (lng,lat)
    // split it and parse it to be a float number
    northEastBounds: north_east_bounds
      ? north_east_bounds.split(',').map(parseFloat)
      : north_east_bounds,
    southWestBounds: south_west_bounds
      ? south_west_bounds.split(',').map(parseFloat)
      : south_west_bounds,
  };

  console.log('User Location: ', userLocation);

  // request queries
  const { search, sortBy, limit, page } = req.query;

  // search stage
  const searchStage = buildSearchStage(search, userLocation);

  // filter stage
  const filterStage = buildFilterStage(req.query);

  // get properties count
  const countPipeline = buildPipeline(searchStage, filterStage);

  const countResults = await Property.aggregate(countPipeline).count('total');

  const propertyCount = countResults.length ? countResults[0].total : 0;

  console.log('Property count: ', propertyCount);

  // get pagination info
  const pagination = calculatePagination(propertyCount, page, limit);

  console.log(pagination);

  // sort stage
  const sortObject = buildSortStage(sortBy);

  const pipeline = buildPipeline(searchStage, filterStage, sortObject);

  const properties = await Property.aggregate(pipeline)

    .skip(pagination.skip)
    .limit(pagination.limit)
    // use append because owner is an array to be transformed into an object
    .append(ownerLookupStage);

  // preprocess images for this property to serve client the right content
  properties.forEach(property => {
    property.images = preProcessImage(property);
    // remove property names from the property object
    delete property.imagesNames;
  });

  console.log('Filters: ', filterStage);
  // console.log('Filter Stage: ', filterStage);
  console.log('Sort Object: ', sortObject);

  res.json({ ...pagination, properties });
});

export const createProperty = catchAsyncErrors(async (req, res, next) => {
  const { location } = req.body;

  // send an error if no location is passed
  if (!location)
    return next(
      new ServerError('Cannot create a property without a location', 400)
    );

  // check to see if coordinates are in Guinea
  const fullyInGuinea = true; // await insideGuinea(location.coordinates);

  console.log('In Guinea ?: ', fullyInGuinea);

  if (!fullyInGuinea)
    return next(
      new ServerError('Cannot create a property outside of Guinea', 400)
    );

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

  /* 
    run this in the background
    don't wait for this to finish before responding to client for better UI exp
  */

  uploadPropertyImages(uploadedImages, property);

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

    if (image) {
      // remove image and all it's duplicates from s3
      // run this in the background to save time of response
      removeFroms3(image.names);

      // remove image info from db
      property.imagesNames = property.imagesNames.filter(
        imageObject => imageObject.sourceName !== imageName
      );
    }
  }

  await property.save();

  res.status(204).json();
});
