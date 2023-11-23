import express from 'express';
const router = express.Router();
import propertyRouter from './property';
import accountRouter from './account';
import geocodeRouter from './geocode';

// API main routes

// Accounts Router
router.use('/', accountRouter);
// Properties Router
router.use('/', propertyRouter);
// Geocoding Router
router.use('/', geocodeRouter);

export default router;
