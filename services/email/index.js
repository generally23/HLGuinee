// import { render } from '@react-email/render';
import { getEmailTransporter, getMailService } from './setup';
import { getHTMLTemplate } from './templates/index';
// import { ResetPasswordComponent } from './templates/reset-password';

const createEmail = (to, subject = '', text = '', html = '') => {
  return {
    from: process.env.SERVER_EMAIL,
    to,
    subject,
    text,
    html,
  };
};

export const sendEmail = async email => {
  const transporter = getEmailTransporter();

  return transporter.sendMail(email);

  const mailService = getMailService();
};

export const sendWelcomeEmail = account => {
  // generate template from account data
  const welcomeTemplate = getHTMLTemplate('welcome.pug', { account });

  // send email to client
  const mail = {
    // from: 'rallygene0@gmail.com',
    to: account.email,
    subject: 'Verify Account Instructions ✔',
    html: welcomeTemplate,
  };

  // use mail service to send email
  sendEmail(mail);
};

export const sendVerificationEmail = async (emailAddress, verificationUrl) => {
  // send email to client
  const subject = 'Verifiez votre compte';

  const to = emailAddress;

  const html = getHTMLTemplate('verification.pug', { verificationUrl });

  const email = createEmail(to, subject, '', html);

  return sendEmail(email);
};

export const sendForgotPasswordEmail = async (receiverEmail, resetUrl) => {
  const subject = 'Reset Password Instructions ✔';

  // const html = getHTMLTemplate('reset-password.pug', { resetUrl });

  const html = render(ResetPasswordComponent({ resetUrl }));

  // send email to client
  const email = createEmail(receiverEmail, subject, '', html);

  return sendEmail(email);
};
