import express from 'express';
const router = express.Router();
import propertyRouter from './property';
import accountRouter from './account';

// server main routes
router.use('/', accountRouter);
router.use('/', propertyRouter);

export default router;
