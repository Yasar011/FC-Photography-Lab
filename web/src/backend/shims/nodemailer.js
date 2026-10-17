// nodemailer → not available in the browser; emails go through the Google Sheet.
export default {
  createTransport() {
    return {
      async sendMail() {
        throw new Error('SMTP is not available here — emails are sent through the Google Sheet.');
      },
    };
  },
};
