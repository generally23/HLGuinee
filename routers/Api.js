import express from 'express';
const router = express.Router();
import propertyRouter from './property';
import accountRouter from './account';
import { unroutable } from '../handlers/errors';

// API main routes

// Accounts Router
router.use('/', accountRouter);
// Properties Router
router.use('/', propertyRouter);

// Handle 404 Not found
router.all('/*', unroutable);

export default router;
