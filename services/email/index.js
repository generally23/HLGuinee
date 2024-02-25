import nodemailer from 'nodemailer';

export const sendEmail = content => {
  const { SMTP_HOSTNAME, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD } =
    process.env;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOSTNAME,
    port: SMTP_PORT,
    auth: {
      user: SMTP_USERNAME,
      pass: SMTP_PASSWORD,
    },
  });

  return transporter.sendMail(content);
};

// export const sendEmail = content => {
//   let attempts = 0;
//   let maxAttempts = 3;
//   let timeout = 0;

//   const { SMTP_HOSTNAME, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD } =
//     process.env;

//   const transporter = nodemailer.createTransport({
//     host: SMTP_HOSTNAME,
//     port: SMTP_PORT,
//     auth: {
//       user: SMTP_USERNAME,
//       pass: SMTP_PASSWORD,
//     },
//   });

//   return new Promise((resolve, reject) => {
//     const sender = async () => {
//       attempts++;

//       console.log('I am sending the email ', attempts);

//       if (attempts >= maxAttempts) return reject('failed to send mail');

//       try {
//         await transporter.sendMail(content);

//         resolve('sent');
//       } catch (error) {
//         timeout += 1000;
//         setTimeout(sender, timeout);
//       }
//     };

//     return sender();
//   });
// };
