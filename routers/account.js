import express from 'express';
import { allowAccessTo, authenticate } from '../handlers/auth';
import {
  signup,
  signin,
  signout,
  getMyAccount,
  forgotMyPassword,
  resetMyPassword,
  deleteMyAccount,
  updateMyAccount,
  changeMyPassword,
  systemAdminCreateAccount,
  systemAdminPasswordChange,
  systemAdminRemoveAccount,
  systemAdminAccountUpdate,
  systemSignIn,
  verifyAccount,
  sendVerficationCode,
} from '../handlers/account';
import { uploader } from '../utils';

const router = express.Router();

const parentRoute = '/accounts';

const systemParentRoute = `/system${parentRoute}`;

/** AUTHENTICATED */

// logout
router.post(`${parentRoute}/signout`, authenticate(), signout);

// fetch my account
router.get(`${parentRoute}/my-account`, authenticate(), getMyAccount);

/** NOT AUTHENTICATED */

router.post(`${parentRoute}/signup`, uploader().single('avatar'), signup);

router.post(`${parentRoute}/signin`, signin);

router.post(`${parentRoute}/forgot-my-password`, forgotMyPassword);

router.patch(`${parentRoute}/reset-my-password/:resetToken`, resetMyPassword);

/** AUTHENTICATED */

router.patch(
  `${parentRoute}/change-my-password`,
  authenticate(),
  changeMyPassword
);

router.patch(
  `${parentRoute}/update-my-account`,
  authenticate(),
  updateMyAccount
);

// verify account
router.get(`${parentRoute}/verify/:code`, authenticate(), verifyAccount);

// send verification code
router.get(
  `${parentRoute}/verification-code`,
  authenticate(),
  sendVerficationCode
);

// SYSTEM ROUTES
router.post(`${systemParentRoute}/signin`, systemSignIn);
router.post(`${systemParentRoute}/signout`, authenticate('system'), signout);
router.patch(
  `${systemParentRoute}/change-my-password`,
  authenticate('system'),
  changeMyPassword
);

// ADMIN ROUTES
router.get(
  `${systemParentRoute}/my-account`,
  authenticate('system'),
  getMyAccount
);

router.post(
  `${systemParentRoute}/create-account`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminCreateAccount
);
router.patch(
  `${systemParentRoute}/update-account/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminAccountUpdate
);
router.delete(
  `${systemParentRoute}/delete-account/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminRemoveAccount
);
router.patch(
  `${systemParentRoute}/change-password/:accountId`,
  authenticate('system'),
  allowAccessTo('admin', 'sub-admin'),
  systemAdminPasswordChange
);

export default router;
