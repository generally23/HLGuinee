export const NO_LOCATION_ERROR_MESSAGE =
  'Vous ne pouvez pas poster un bien sans les coordonées geographiques';

export const LOCATION_INVALID_ERROR_MESSAGE =
  'Cannot create a property outside of Guinea';

export const PROPERTY_NOTFOUND_ERROR_MESSAGE =
  'This property does not exist on our server';

const maxImagesLength = parseInt(process.env.MAX_PROPERTY_IMAGES) || 40;

export const MAX_IMAGE_ALLOWED_ERROR_MESSAGE = `Un bien ne peut pas avoir plus de ${maxImagesLength} photos`;
