import Account from '../../schemas/account/index';
import { ServerError, catchAsyncErrors } from '../errors';
import {
  generateJwt,
  hashToken,
  objectAssign,
  sendEmail,
  setCookie,
  uploadAvatar,
} from '../../utils';
import Property from '../../schemas/property/index';
import { removeFroms3 } from '../../s3';

import {
  EXISTING_ACCOUNT_ERROR_MESSGE,
  UNEXISTING_ACCOUNT_ERROR_MESSAGE,
  INVALID_PASSWORD_ERROR_MESSAGE,
  SAME_PASSWORD_ERROR_MESSAGE,
  VERIFIED_ACCOUNT_ERROR_MESSAGE,
  VERFIFY_ACCOUNT_FAIL_ERROR_MESSAGE,
  MAIL_DELIVERY_FAIL_ERROR_MESSAGE,
} from './error_messages';

// REGULAR USER HANDLERS
export const signup = catchAsyncErrors(async (req, res, next) => {
  // make sure this account does not exist before we create one
  if (await Account.findOne({ email: req.body.email })) {
    return next(
      new ServerError(`${EXISTING_ACCOUNT_ERROR_MESSGE}. Connecter vous`, 400)
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
  const avatar = req.file;

  // proccess and upload avatar to s3
  await uploadAvatar(avatar, account, next);

  res.setHeader('token', token);

  setCookie(res, 'token', token);

  res.json(account);
});

export const signin = catchAsyncErrors(async (req, res, next) => {
  const { email, password } = req.body;

  console.log(email, password);
  // find account
  const account = await Account.findOne({ email, role: 'client' });

  console.log(account);

  if (!account) {
    // account does not exist err
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
  }

  // verify password
  const isPasswordValid = await account.validatePassword(password);

  if (!isPasswordValid) {
    return next(new ServerError(INVALID_PASSWORD_ERROR_MESSAGE, 401));
  }

  // store ip and last time user logged in
  objectAssign({ ip: req.ip, signedIn: Date.now() }, account);

  // regular users have long expiration tokens while admins and agents' expire in 1d
  const token = generateJwt(account.id);

  // don't allow more than specified login
  const tokensLength = account.tokens.length;

  // if logged in token + this login token > specified
  // wipe old tokens to logout previous devices

  if (tokensLength + 1 > parseInt(process.env.MAX_LOGIN_TOKENS || 5)) {
    account.tokens = [];
  }
  // store token
  account.tokens.push(token);

  await account.save();

  setCookie(res, 'token', token);

  res.setHeader('token', token);

  res.json(account);
});

export const signout = catchAsyncErrors(async (req, res, next) => {
  const { account, token } = req;

  // record signout date
  account.signedOut = Date.now();

  // log user out from server
  account.tokens = account.tokens.filter(t => t !== token);

  await account.save();

  // remove cookie (not required)
  res.clearCookie('token');

  res.status(204).json({});
});

export const changeMyPassword = catchAsyncErrors(async (req, res, next) => {
  // consider logging out user when password change

  // user current pwd and new pwd
  const { currentPassword, newPassword: password } = req.body;

  // account
  const { account } = req;

  if (currentPassword === password)
    return next(new ServerError(SAME_PASSWORD_ERROR_MESSAGE, 400));

  // validate pwd
  const isPasswordValid = await account.validatePassword(currentPassword);

  // send error if not valid
  if (!isPasswordValid) {
    return next(new ServerError(INVALID_PASSWORD_ERROR_MESSAGE, 401));
  }

  // update pwd
  objectAssign({ password }, account);

  // update tokens
  const token = generateJwt(account.id);

  account.tokens = [token];

  // sign account in
  setCookie(res, 'token', token);

  res.setHeader('token', token);

  // save
  await account.save();

  res.json(account);
});

export const getMyAccount = catchAsyncErrors(async (req, res, next) => {
  res.json(req.account);
});

export const updateMyAccount = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  const avatar = req.files ? req.files[0] : undefined;

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
  const myProperties = await Property.find({ ownerId: accountId });

  // remove images of all properties made by this account from s3 bucket
  for (let property of myProperties) {
    const images = property.imagesNames;
    for (let image of images) {
      await removeFroms3(image.names);
    }
  }
  // delete all properties owned by this account
  await Property.deleteMany({ ownerId: accountId });

  // finally delete account
  await Account.deleteOne({ _id: req.account.id });
  // respond to client
  res.status(204).json();
});

export const forgotMyPassword = catchAsyncErrors(async (req, res, next) => {
  const { email } = req.body;

  const account = await Account.findOne({ email, role: 'client' });

  // send error
  if (!account) {
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 401));
  }

  // generate reset token
  const resetToken = await account.generateResetToken();

  // construct a url to send to the user to reset their password

  const resetUrl = `${req.protocol}://${req.hostname}:3000/my-account/reset-my-password/${resetToken}`;

  // console.log(resetUrl);
  // send email to client
  const mail = {
    from: 'rallygene0@gmail.com', // sender address
    to: email, // list of receivers
    subject: 'Reset Password Instructions ✔', // Subject line
    text: resetUrl, // plain text body
    // html: '<b>Hello world?</b>', // html body
  };

  try {
    await sendEmail(mail);
  } catch (e) {
    // console.log(e);
    return next(new ServerError(MAIL_DELIVERY_FAIL_ERROR_MESSAGE));
  }

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
    return next(new ServerError(UNEXISTING_ACCOUNT_ERROR_MESSAGE, 404));
  }

  // don't allow account to use the same password as current one
  if (await account.validatePassword(password)) {
    return next(new ServerError(SAME_PASSWORD_ERROR_MESSAGE, 400));
  }

  // update password and default reset token & exp date

  const newUpdates = {
    resetToken: undefined,
    resetTokenExpirationDate: undefined,
    password: undefined,
  };

  objectAssign(newUpdates, account, { mode: 'nostrict' });

  // logout all tokens stored before pwd change
  account.tokens = [];

  // save account
  await account.save();

  res.json(account);
});

export const verifyAccount = catchAsyncErrors(async (req, res, next) => {
  // verfication code
  const { code } = req.params;

  const hash = hashToken(code);

  // find account with this code and make sure it has not expired
  const account = await Account.findOne({
    verificationCode: hash,
    verificationCodeExpirationDate: { $gt: Date.now() },
  });

  // send error, no account found
  if (!account) {
    return next(new ServerError(VERFIFY_ACCOUNT_FAIL_ERROR_MESSAGE, 400));
  }

  if (account.verified) {
    return next(new ServerError(VERIFIED_ACCOUNT_ERROR_MESSAGE, 400));
  }

  // mark account as verified
  objectAssign(
    {
      verified: true,
      verificationCode: undefined,
      verificationCodeExpirationDate: undefined,
    },
    account,
    { mode: 'nostrict' }
  );

  // save account
  await account.save();

  // respond to client
  res.json({ message: 'votre compte à été verifier avec succès' });
});

export const sendVerficationCode = catchAsyncErrors(async (req, res, next) => {
  const { account } = req;

  // don't send code to email if user is already verified
  if (account.verified) {
    return next(new ServerError(VERIFIED_ACCOUNT_ERROR_MESSAGE, 400));
  }

  // generate verification code
  const verificationCode = await account.generateVerificationCode();

  // generate verification code url
  const verifyUrl = `${req.protocol}://${req.hostname}:3000/verify/${verificationCode}`;

  // send email to client
  const mail = {
    from: 'rallygene0@gmail.com',
    to: account.email,
    subject: 'Verify Account Instructions ✔',
    text: verifyUrl,
  };

  try {
    await sendEmail(mail);
  } catch (e) {
    return next(new ServerError(MAIL_DELIVERY_FAIL_ERROR_MESSAGE));
  }

  res.json({ verificationCode });
});
