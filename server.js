import express from 'express';
import { connectToDb, setupExpressMiddleware, listen } from './setup';

const server = express();

const maintenanceServer = express();

// connect to mongodb
connectToDb();
// setup express middlewares
setupExpressMiddleware(server);
// listen on determined port
listen(server);

// when server is under maintainance shut it down and use maintenance server
// listen(maintenanceServer);

console.clear();
