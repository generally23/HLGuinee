import express from 'express';
import { autocompletePlaces } from '../handlers/geocode';

const router = express.Router();

router.get('/places', autocompletePlaces);

// takes a place id => address of place
// router.get('/geocode/forward');

// takes a longitude & latitude => address
// router.get('/geocode/reverse');

export default router;
