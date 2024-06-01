import { getMailService } from './setup';
import { getHTMLTemplate } from './templates/index';

const createEmail = (to, subject = '', text = '', html = '', react = '') => {
  return {
    from: process.env.SERVER_EMAIL,
    to,
    subject,
    text,
    html,
    react,
  };
};

export const sendEmail = async email => getMailService().emails.send(email);

export const sendWelcomeEmail = account => {
  // generate template from account data
  const welcomeTemplate = getHTMLTemplate('welcome.pug', { account });

  // send email to client
  createEmail(account.email, 'Compte crée avec succès', '', welcomeTemplate);

  // use mail service to send email
  return sendEmail(mail);
};

export const sendVerificationEmail = (emailAddress, verificationUrl) => {
  // send email to client
  const subject = 'Verifiez votre compte';

  const to = emailAddress;

  const html = getHTMLTemplate('verification.pug', { verificationUrl });

  const email = createEmail(to, subject, '', html);

  return sendEmail(email);
};

export const sendForgotPasswordEmail = (receiverEmail, resetUrl) => {
  const subject = 'Reinitialiser votre mot de passe ✔';

  const html = getHTMLTemplate('reset-password.pug', { resetUrl });

  // send email to client
  const email = createEmail(receiverEmail, subject, '', html, '');

  return sendEmail(email);
};
