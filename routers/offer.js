import express from 'express';
import {
  createOffer,
  getOffer,
  getOffers,
  removeOffer,
  updateOffer,
} from '../handlers/offer';
import { authenticate, preventUnverifiedAccounts } from '../handlers/auth';

const router = express.Router({ mergeParams: true });

router
  .route('/')
  .get(getOffers)
  .post(authenticate(), preventUnverifiedAccounts, createOffer);

router
  .route('/:offerId')
  .get(getOffer)
  .patch(authenticate(), updateOffer)
  .delete(authenticate(), removeOffer);

export default router;
