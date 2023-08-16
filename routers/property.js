import express from 'express';
import { uploader } from '../utils';
import offerRouter from './offer';
import {
  fetchProperties,
  fetchProperty,
  createProperty,
  updateProperty,
  removeProperty,
  addPropertyImages,
  removePropertyImage,
} from '../handlers/property';
import { authenticate, preventUnverifiedAccounts } from '../handlers/auth';

const router = express.Router();

const parentRoute = '/properties';
const childRoute = `${parentRoute}/:propertyId`;

router
  .route(`${parentRoute}`)
  .get(fetchProperties)
  .post(
    uploader({ files: 12 }).any(),
    authenticate(),
    preventUnverifiedAccounts,
    createProperty
  );

router
  .route(childRoute)
  .get(fetchProperty)
  .patch(authenticate(), updateProperty)
  .delete(authenticate(), removeProperty);

router.post(
  `${childRoute}/images`,
  authenticate(),
  uploader({ files: 12 }).any(),
  addPropertyImages
);

router.delete(
  `${childRoute}/images/:imageName`,
  authenticate(),
  removePropertyImage
);

router.use(`${childRoute}/offers`, offerRouter);

// SYSTEM SPECIFIC ROUTES
router
  .route('system/properties/:propertyId')
  .patch(authenticate('system'), updateProperty)
  .delete(authenticate('system'), removeProperty);

export default router;
