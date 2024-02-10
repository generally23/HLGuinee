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
  fetchMyProperties,
} from '../handlers/property/index';
import { authenticate, preventUnverifiedAccounts } from '../handlers/auth';

const router = express.Router();

const properties = '/properties';
const propertyRoute = `${properties}/:propertyId`;

router
  .route(properties)
  .get(fetchProperties)
  .post(authenticate(), preventUnverifiedAccounts, createProperty);

router.get(`${properties}/my-properties`, authenticate(), fetchMyProperties);

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
