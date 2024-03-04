import Account from '../../schemas/account/index';
import { ServerError, catchAsyncErrors } from '../errors';
import {
  generateAccountEmail,
  generateDfPassword,
  generateJwt,
  objectAssign,
} from '../../utils';

import { NOT_PERMITTED_ERROR_MESSAGE } from '../error_messages';
import {
  UNEXISTING_ACCOUNT_ERROR_MESSAGE,
  INVALID_PASSWORD_ERROR_MESSAGE,
} from './error_messages';

// SYSTEM ROUTE HANDLERS
// ONLY ACCESSIBLE TO ADMIN AND ADMIN PERMITTED ACCOUNTS

// AGENT FUCTIONS
export const systemSignIn = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;
  const systemRoles = ['admin', 'sub-admin', 'agent'];
  // find account
  const account = await Account.findOne({
    email,
    role: { $in: systemRoles },
  });

  if (!account) {
    // account does not exist err
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError(INVALID_PASSWORD_ERROR_MESSAGE, 401));
  }

  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // store token
  const token = generateJwt(account.id, '1d');

  account.tokens.push(token);

  await account.save();

  // setCookie(res, 'Auth-Token', token);

  res.setHeader('auth_token', token);

  res.json(account);
});

// ADMIN ONLY FUNCTIONS
export const systemAdminCreateAccount = catchAsyncErrors(
  async (req, res, next) => {
    // don't allow admin accounts creations
    if (req.body.role === 'admin') {
      return next(new ServerError(NOT_PERMITTED_ERROR_MESSAGE, 403));
    }

    const account = new Account(req.body);

    const { firstname, lastname } = account;

    // generate email
    account.email = generateAccountEmail(firstname, lastname);

    // generate default for account
    account.password = generateDfPassword(firstname, lastname);
    // set these accounts as verified (unnecessary anyways)
    account.verified = true;
    // save account
    await account.save();

    res.status(201).json(account);
  }
);

export const systemAdminAccountUpdate = catchAsyncErrors(
  async (req, res, next) => {
    const { firstname, lastname, contacts } = req.body;
    const account = await Account.findById(req.params.accountId);
    // if account does not exist send err
    if (!account) {
      return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
    }
    // update properties
    objectAssign({ firstname, lastname }, account);

    await account.save();

    res.json(account);
  }
);

export const systemAdminRemoveAccount = catchAsyncErrors(
  async (req, res, next) => {
    const account = await Account.findById(req.params.accountId);

    if (!account)
      return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 404));

    if (
      account.role === 'admin' ||
      (req.account.role === 'sub-admin' &&
        account.role === 'sub-admin' &&
        !account._id.equals(req.account.id))
    )
      return next(new ServerError(NOT_PERMITTED_ERROR_MESSAGE, 403));
    // delete account
    await Account.deleteOne({ _id: req.params.accountId });
    // send response
    res.status(204).json();
  }
);

export const systemAdminPasswordChange = catchAsyncErrors(
  async (req, res, next) => {
    const account = await Account.findOne({
      _id: req.params.accountId,
      role: { $in: ['admin', 'sub-admin', 'agent'] },
    });
    // if account does not exist send err
    if (!account) {
      return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
    }

    // if (account.role === 'admin'account._id.equals(req.account.id)) {

    // }
    // reset password to default and force account to update password
    account.password = generateDfPassword(account.firstname, account.lastname);

    await account.save();

    res.json();
  }
);

export const systemGetAccounts = catchAsyncErrors(async (req, res, next) => {
  const accounts = await Account.find();
  res.json(accounts);
});
