import express from 'express';
import { resolve } from 'path';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import compress from 'compression';
import cookieParser from 'cookie-parser';
// import { default: helmet } from "helmet";
import propertyRouter from './routers/property';
import accountRouter from './routers/account';
import dotenv from 'dotenv';
import { unroutable, globalErrorHandler } from './handlers/errors';
import Account from './schemas/account';

// start db connection
export const connectToDb = async () => {
  try {
    await mongoose.connect(
      process.env.DATABASE_URL || 'mongodb://localhost:27017/houses&lands'
    );
    console.log('sucessfull connection to db');

    const admin = await Account.findOne({
      email: process.env.ADMIN_EMAIL || 'abdourahmanedbalde@gmail.com',
    });

    if (!admin) {
      const account = new Account({
        firstname: process.env.ADMIN_FIRSTNAME,
        lastname: process.env.ADMIN_LASTNAME,
        email: process.env.ADMIN_EMAIL,
        contacts: ['(716)-314-35-33', '(917)-284-4425'],
        password: process.env.ADMIN_PASSWORD,
        type: process.env.ADMIN_TYPE,
        // year month (begin at 0 march = idx 2) day
        dob: new Date(2000, 2, 17),
      });

      await account.save();
    }
  } catch (error) {
    console.log('failed db connection');
  }
};

export const setupExpressMiddleware = (server) => {
  // setup environment variables
  dotenv.config();
  // parse json
  server.use(express.json());
  // setup cors
  server.use(cors());
  // parse cookies
  server.use(cookieParser());
  // setup compression
  server.use(compress());
  // setup helmet to protect server
  server.use(helmet());

  // serve static files
  server.use(express.static(resolve(__dirname, 'Public')));

  // server main routes
  server.use('/api/v1', accountRouter);
  server.use('/api/v1', propertyRouter);

  // handles all unmacthing routes
  server.all('*', unroutable);

  // error handler
  server.use(globalErrorHandler);
};

// port listeners
export const listen = async (server, port = process.env.PORT || 9090) => {
  try {
    await server.listen(port, console.log);
    console.log('listening on port 9090');
    console.clear();
  } catch (error) {
    console.log('failing to listen on port 9090');
  }
};
