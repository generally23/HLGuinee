import express from 'express';
const router = express.Router();
import propertyRouter from './property';
import accountRouter from './account';

// API main routes

// Accounts Router
router.use('/', accountRouter);
// Properties Router
router.use('/', propertyRouter);

export default router;
