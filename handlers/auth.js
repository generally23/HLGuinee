import { verify } from 'jsonwebtoken';
import { ServerError } from './errors';
import Account from '../schemas/account';
import { catchAsyncErrors } from './errors';

export const authenticate = (type = 'client') => {
  return catchAsyncErrors(async (req, res, next) => {
    let query;

    const noAuthError = new ServerError('You are not authenticated', 401);
    // get token
    const token = req.headers['authorization'];

    // req.cookies.AUTH_TOKEN;
    console.log(token);

    // verify token
    const decoded = verify(token, process.env.JWT_SECRET_KEY || 'secret');

    if (!decoded) {
      return next(noAuthError);
    }
    // system auth
    if (type === 'system')
      query = { tokens: token, role: { $in: ['admin', 'sub-admin', 'agent'] } };
    // client auth
    else if (type === 'client') query = { tokens: token, role: 'client' };
    // unknown auth
    else return next(noAuthError);

    // find account that has role as client
    const account = await Account.findOne(query);

    if (!account) return next(noAuthError);

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
