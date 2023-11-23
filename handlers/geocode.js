import axios from 'axios';
import { ServerError, catchAsyncErrors } from './errors';

export const autocompletePlaces = catchAsyncErrors(async (req, res, next) => {
  // google access key
  const { GOOGLE_ACCESS_KEY } = process.env;
  // user typed input
  const { address } = req.query;

  if (!address)
    return next(
      new ServerError('An address is required to perform places autocomplete')
    );
  // request options
  const options = `language=fr&components=country:gn`;
  // url to google places API
  const placesUrl =
    'https://maps.googleapis.com/maps/api/place/autocomplete/json';

  const response = await axios({
    url: `${placesUrl}?input=${address}&${options}&key=${GOOGLE_ACCESS_KEY}`,
  });

  console.log(response);

  res.json(response.data);
});

export const forwardLookup = catchAsyncErrors(async (req, res, next) => {});

export const reverseLookup = catchAsyncErrors(async (req, res, next) => {});
