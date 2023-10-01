import express from 'express';
import { uploader } from '../utils';
import {
  fetchProperties,
  fetchProperty,
  createProperty,
  updateProperty,
  removeProperty,
  addPropertyImages,
  removePropertyImage,
  fetchMyProperties,
} from '../handlers/property';
import { authenticate, preventUnverifiedAccounts } from '../handlers/auth';

const router = express.Router();

const properties = '/properties';
const propertyRoute = `${properties}/:propertyId`;

router
  .route(properties)
  .get(fetchProperties)
  .post(
    authenticate(),
    uploader({ files: 12 }).any(),
    preventUnverifiedAccounts,
    createProperty
  );

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
  uploader({ files: 12 }).any(),
  addPropertyImages
);

// remove a property image
router.delete(
  `${propertyRoute}/images/:imageName`,
  authenticate(),
  removePropertyImage
);

// SYSTEM SPECIFIC ROUTES
router
  .route('system/properties/:propertyId')
  .patch(authenticate('system'), updateProperty)
  .delete(authenticate('system'), removeProperty);

export default router;
