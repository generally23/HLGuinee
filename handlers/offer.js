import Offer from '../schemas/offer';
import Property from '../schemas/property';
import { objectAssign } from '../utils';
import { ServerError, catchAsyncErrors } from './errors';

export const createOffer = catchAsyncErrors(async (req, res, next) => {
  // only create offer if property exist
  const property = await Property.findById(req.params.propertyId);
  const accountId = req.account.id;

  console.log('Account ID: ', accountId);

  if (!property) {
    return next(
      new ServerError('Cannot create offer for an unexisting property', 404)
    );
  }

  // don't allow property owner to create offer on their property
  if (property.ownerId.equals(accountId)) {
    return next(
      new ServerError('You cannot make offers on your own properties', 400)
    );
  }

  const potentialOffer = await Offer.findOne({
    propertyId: property.id,
    offererId: accountId,
  });

  // cannot make offers to the same property 2x
  if (potentialOffer) {
    return next(
      new ServerError("You've already sent an offer for this property", 400)
    );
  }

  // create offer
  const offer = new Offer(req.body);
  // tie offer to creator
  offer.offererId = req.account.id;
  // tie offer to property
  offer.propertyId = property.id;
  // save offer
  await offer.save();
  // send created offer
  res.status(201).json(offer);
});

export const getOffers = catchAsyncErrors(async (req, res, next) => {
  const offers = await Offer.find({ propertyId: req.params.propertyId })
    .populate('offerer')
    .populate('property');
  res.json(offers);
});

export const getOffer = catchAsyncErrors(async (req, res, next) => {
  // find offer
  const offer = await Offer.findById(req.params.offerId)
    .populate('offerer')
    .populate('property');

  // send an error if offer does not exist
  if (!offer) {
    return next(
      new ServerError('This offer does not exist on our server', 404)
    );
  }
  // send offer
  res.json(offer);
});

export const updateOffer = catchAsyncErrors(async (req, res, next) => {
  // don't allow anyone to update offerer
  delete req.body.offererId;

  // find offer
  const offer = await Offer.findById(req.params.offerId);

  // send error if offer is not found
  if (!offer) {
    return next(
      new ServerError('This offer does not exist on our server', 404)
    );
  }

  // only offer owner and admin allowed to remove offer
  if (!offer.offererId.equals(req.account.id)) {
    return next(
      new ServerError(
        'You do not have enough credentials to perform this action',
        403
      )
    );
  }

  objectAssign(req.body, offer);

  await offer.save();

  res.json(offer);
});

export const removeOffer = catchAsyncErrors(async (req, res, next) => {
  // find offer
  const offer = await Offer.findById(req.params.offerId);

  // error if offer not found
  if (!offer) {
    return next(
      new ServerError('This offer does not exist on our server', 404)
    );
  }

  // only offer owner and admin allowed to remove offer
  if (!offer.offererId.equals(req.account.id)) {
    return next(
      new ServerError(
        'You do not have enough credentials to perform this action',
        403
      )
    );
  }

  // delete offer
  await Offer.deleteOne({ _id: offer.id });

  res.status(204).json();
});
