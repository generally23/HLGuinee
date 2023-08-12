import Account from '../schemas/account';
import { ServerError, catchAsyncErrors } from './errors';
import {
  generateJwt,
  hashToken,
  objectAssign,
  sendEmail,
  setCookie,
  uploadAvatar,
} from '../utils';
import Property from '../schemas/property';
import Offer from '../schemas/offer';
import { removeFroms3 } from '../s3';

// REGULAR USER HANDLERS
export const signup = catchAsyncErrors(async (req, res, next) => {
  // make sure this account does not exist before we create one
  if (await Account.findOne({ email: req.body.email })) {
    return next(
      new ServerError('This account already exist. Please Log In!', 400)
    );
  }
  // create new account
  const account = new Account(req.body);

  // store ip and last time user logged in
  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // generate an auth token for this account and save it to our DB
  const token = generateJwt(account.id);

  // store token
  account.tokens.push(token);

  // save account
  await account.save();

  // get account avatar if uploaded
  const avatar = req.files[0];

  // proccess and upload avatar to s3
  await uploadAvatar(avatar, account, next);

  // setCookie(res, 'Auth-Token', token);
  res.setHeader('auth_token', token);

  res.json(account);
});

export const signin = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;
  // find account
  const account = await Account.findOne({ email, role: 'client' });

  if (!account) {
    // account does not exist err
    return next(new ServerError('Account not found', 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError('Invalid password', 401));
  }

  // store ip and last time user logged in
  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // regular users have long expiration tokens while admins and agents' expire in 1d
  const token = generateJwt(account.id);

  // store token
  account.tokens.push(token);

  await account.save();

  //setCookie(res, 'Auth-Token', token);

  res.setHeader('auth_token', token);

  res.json(account);
});

export const signout = catchAsyncErrors(async (req, res, next) => {
  const { account, token } = req;

  // log user out
  account.signedOut = Date.now();
  account.tokens = account.tokens.filter((t) => t !== token);

  await account.save();
  // remove cookie (not required)
  // setCookie(res, 'Auth-Token', undefined, { maxAge: 0 });

  res.status(204).json();
});

export const changeMyPassword = catchAsyncErrors(async (req, res, next) => {
  // consider logging out user when password change

  // user current pwd and new pwd
  const { currentPassword, newPassword: password } = req.body;

  // account
  const { account } = req;

  if (currentPassword === password)
    return next(
      new ServerError('Your current and new password cannnot be the same', 400)
    );

  // validate pwd
  const isPasswordValid = await account.validatePassword(currentPassword);

  // send error if not valid
  if (!isPasswordValid) {
    return next(new ServerError('Invalid password', 401));
  }

  // update pwd
  objectAssign({ password }, account);

  // update tokens
  account.tokens = [];

  // save
  await account.save();

  res.json(account);
});

export const getMyAccount = catchAsyncErrors(async (req, res, next) => {
  res.json(req.account);
});

export const updateMyAccount = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  const avatar = req.files[0];

  const { firstname, lastname } = req.body;

  objectAssign({ firstname, lastname }, account);

  await account.save();

  // process and update avatar
  await uploadAvatar(avatar, account, next);

  res.json(account);
});

export const deleteMyAccount = catchAsyncErrors(async (req, res, next) => {
  // alongside delete offers and properties created by this account
  // id of logged in account
  const accountId = req.account.id;
  // find all properties owned by this account
  const myProperties = await Property.find({ ownerId: accountId }).lean();
  // remove images of all properties made by this account from s3 bucket
  for (let property of myProperties) {
    const images = property.imagesNames;
    for (let image of images) {
      await removeFroms3(image.names);
    }
  }
  // delete properties owned by this account
  await Property.deleteMany({ ownerId: accountId });
  // delete all offers made by this account
  await Offer.deleteMany({ offererId: accountId });
  // finally delete account
  await Account.deleteOne({ _id: req.account.id });
  // respond to client
  res.status(204).json();
});

export const forgotMyPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;

  const account = await Account.findOne({ email });

  // send error
  if (!account) {
    return next(
      new ServerError('This account does not exist on our server', 401)
    );
  }

  // send email to user
  const resetToken = await account.generateResetToken();

  res.json({ resetToken });
});

export const resetMyPassword = catchAsyncErrors(async (req, res, next) => {
  // reset token
  const { resetToken } = req.params;

  // pwd
  const { password } = req.body;

  // hashed reset token
  const hash = hashToken(resetToken);

  // find account
  const account = await Account.findOne({
    resetToken: hash,
    resetTokenExpirationDate: { $gt: Date.now() },
  });

  // send error
  if (!account) {
    return next(
      new ServerError('This account does not exist on our server', 401)
    );
  }

  // update password and default reset token & exp date
  objectAssign(
    { password, resetToken: undefined, resetTokenExpirationDate: undefined },
    account
  );

  // logout all tokens stored before pwd change
  account.tokens = [];

  // save account
  await account.save();

  res.json({ account });
});

export const verifyAccount = catchAsyncErrors(async (req, res, next) => {
  // verfication code
  const { code } = req.params;

  const hash = hashToken(code);

  console.log('code: ', code, 'hash: ', hash);
  // find account with this code and make sure it has not expired
  const account = await Account.findOne({
    verificationCode: hash,
    verificationCodeExpirationDate: { $gt: Date.now() },
  });

  // send error, no account found
  if (!account) {
    return next(
      new ServerError('Unfortunately, we could not verify your account', 400)
    );
  }

  if (account.verified) {
    return next(new ServerError('Your account is already verified', 400));
  }

  // mark account as verified
  objectAssign(
    {
      verified: true,
      verificationCode: undefined,
      verificationCodeExpirationDate: undefined,
    },
    account
  );

  // save account
  await account.save();

  // respond to client
  res.json({ message: 'Your account is successfully verfified' });
});

export const sendVerficationCode = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  // don't send code to email if user is already verified
  if (account.verfied) {
    return next(new ServerError('This account is already verified', 400));
  }

  // generate verification code
  const code = await account.generateVerificationCode();

  const verficationLink = `${req.protocol}://${req.hostname}/api/v1/accounts/verify/${code}`; // https://localhost:80/

  console.log(verficationLink);

  // send email to logged in account
  const info = await sendEmail({
    from: 'abdourahmanedbalde@gmail.com',
    to: account.email,
    subject: 'Hello',
    html: `this is your verification code. Please send a request to <a href='${verficationLink}'>${verficationLink}</a>`,
  });

  console.log(info);

  res.json(code);
});

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
    return next(new ServerError('Account not found', 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError('Invalid password', 401));
  }

  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // store token
  const token = generateJwt(account.id, '1d');

  account.tokens.push(token);

  await account.save();

  setCookie(res, 'Auth-Token', token);

  res.json(account);
});

// ADMIN ONLY FUNCTIONS
export const systemAdminCreateAccount = catchAsyncErrors(
  async (req, res, next) => {
    const account = new Account(req.body);

    account.password = process.env.DEFAULT_SYSTEM_PASSWORD;

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
      return next(new ServerError('Account not found', 401));
    }
    // update properties
    objectAssign({ firstname, lastname }, account);

    await account.save();

    res.json(account);
  }
);

export const systemAdminRemoveAccount = catchAsyncErrors(
  async (req, res, next) => {
    await Account.deleteOne({ _id: req.params.accountId });
    res.status(204).json();
  }
);

export const systemAdminPasswordChange = catchAsyncErrors(
  async (req, res, next) => {
    const account = await Account.findById(req.params.accountId);
    // if account does not exist send err
    if (!account) {
      return next(new ServerError('Account not found', 401));
    }

    account.password = process.env.DEFAULT_SYSTEM_PASSWORD || 'DFSP-APP';

    await account.save();

    res.json();
  }
);
