import { verify } from 'jsonwebtoken';
import { ServerError } from './errors';
import Account from '../schemas/account';
import { catchAsyncErrors } from './errors';
import axios from 'axios';

export const authenticate = (type = 'client') => {
  return catchAsyncErrors(async (req, res, next) => {
    let query;

    const authFailError = new ServerError('You are not authenticated', 401);
    // get token
    const token = req.cookies.token || req.headers['authorization'];

    // req.cookies.AUTH_TOKEN;
    console.log(token);

    // verify token
    try {
      verify(token, process.env.JWT_SECRET || 'secret');
    } catch (error) {
      return next(authFailError);
    }

    // query will use system auth if type = 'system' & client auth otherwise
    query =
      type === 'system'
        ? { tokens: token, role: { $in: ['admin', 'sub-admin', 'agent'] } }
        : { tokens: token, role: 'client' };

    // find account that has role as client
    const account = await Account.findOne(query);

    if (!account) {
      return next(authFailError);
    }

    req.authenticated = true;
    req.account = account;
    req.token = token;

    return next();
  });
};

export const allowAccessTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.account.role)) {
      return next(
        new ServerError(
          'You do not have enough credentials to access or perform these actions',
          403
        )
      );
    }
    next();
  };
};

export const preventUnverifiedAccounts = catchAsyncErrors(
  async (req, res, next) => {
    const { account } = req;

    if (!account.verified) {
      return next(
        new ServerError(
          'Please verify your account to access this ressource',
          403
        )
      );
    }

    next();
  }
);
