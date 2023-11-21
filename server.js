import express from 'express';
import { connectToDb, setupExpressMiddleware, listen } from './setup';

const server = express();

const maintenanceServer = express();

// setup express middlewares
setupExpressMiddleware(server);
// connect to mongodb
connectToDb();

// listen on determined port
listen(server);

// when server is under maintainance shut it down and use maintenance server
// listen(maintenanceServer);

console.clear();
