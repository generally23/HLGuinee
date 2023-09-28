import express from 'express';
import { resolve } from 'path';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import compress from 'compression';
import cookieParser from 'cookie-parser';
// import { default: helmet } from "helmet";

import SERVER_ROUTER from './routers/Webserver';
import API_ROUTER from './routers/Api';

import dotenv from 'dotenv';
import { unroutable, globalErrorHandler } from './handlers/errors';
import Account from './schemas/account';
import { generateDfPassword } from './utils';

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

    // console.log(admin);

    if (!admin) {
      const firstname = process.env.ADMIN_FIRSTNAME;
      const lastname = process.env.ADMIN_LASTNAME;
      const email = process.env.ADMIN_EMAIL;
      const contacts = ['(716)-314-35-33', '(917)-284-4425'];
      const password = generateDfPassword(firstname, lastname);
      const role = process.env.MASTER_ROLE;

      const account = new Account({
        firstname,
        lastname,
        email,
        contacts,
        password,
        role,
        // ip,
        // year month (begin at 0 march = idx 2) day
        dob: new Date(2000, 2, 17),
      });

      console.log(account);
      await account.save();

      console.log(account);
    }
  } catch (error) {
    console.log('Failed db connection');
    console.log(error);
  }
};

export const setupExpressMiddleware = server => {
  // setup environment variables
  dotenv.config({});

  // parse json
  server.use(express.json());

  // parse form data
  server.use(express.urlencoded({ extended: true }));

  // setup cors
  // server.use(cors());
  server.use(
    cors({
      origin: 'http://localhost:3000',
      credentials: true,
    })
  );

  // parse cookies
  server.use(cookieParser());

  // setup compression
  server.use(compress());

  // setup helmet to protect server
  server.use(helmet());

  // serve static files
  server.use(express.static(resolve(__dirname, 'public')));

  // server.get('api./subdomain', (req, res) => res.send('Test working...'));

  // WEB SERVER ROUTES
  server.use('/', SERVER_ROUTER);

  // API ROUTES
  server.use('/api/v1', API_ROUTER);

  // Handle 404 Not found
  server.all('*', unroutable);

  // Global Error handler
  server.use(globalErrorHandler);
};

// Port listener
export const listen = async (server, port = process.env.PORT || 9090) => {
  try {
    await server.listen(port, console.log);
    console.log('listening on port 9090');
    console.clear();
  } catch (error) {
    console.log('failing to listen on port 9090');
  }
};
