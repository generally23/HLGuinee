import express from 'express';
import { connectToDb, setupExpressMiddleware, listen } from './setup';

const server = express();

// connect to mongodb
connectToDb();
// setup express middlewares
setupExpressMiddleware(server);
// listen on determined port
listen(server);

console.clear();
