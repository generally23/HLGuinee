import express from 'express';
import { uploader } from '../utils';
import {
  fetchProperties,
  fetchProperty,
  createProperty,
  updateProperty,
  removeProperty,
  addPropertyImages,
  removePropertyImages,
  // fetchMyProperties,
  // fetchMyOtherProperties,
} from '../handlers/property/index';
import { authenticate, preventUnverifiedAccounts } from '../handlers/auth';

const router = express.Router();

const propertiesRoute = '/properties';
const propertyRoute = `${propertiesRoute}/:propertyId`;

router
  .route(propertiesRoute)
  .get(fetchProperties)
  .post(authenticate(), preventUnverifiedAccounts, createProperty);

// could be in account's router but already went for this approach
// ALIAS ROUTES
// router.get(`/my-properties`, authenticate(), fetchMyProperties);

// router.get(`/my-other-properties`, fetchMyOtherProperties);

router
  .route(propertyRoute)
  .get(fetchProperty)
  .patch(authenticate(), updateProperty)
  .delete(authenticate(), removeProperty);

// add images to property
router.post(
  `${propertyRoute}/images`,
  authenticate(),
  uploader({ files: 40 }).any(),
  addPropertyImages
);

// remove a property image
router.post(
  `${propertyRoute}/images/delete`,
  authenticate(),
  removePropertyImages
);

// SYSTEM SPECIFIC ROUTES
router
  .route('system/properties/:propertyId')
  .patch(authenticate('system'), updateProperty)
  .delete(authenticate('system'), removeProperty);

export default router;
