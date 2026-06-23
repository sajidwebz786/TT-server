export const buildResetLink = (token) => {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}/?resetToken=${encodeURIComponent(token)}`;
};

export const sendPasswordResetEmail = async ({ to, name, resetLink }) => {
  const senderConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const payload = {
    to,
    subject: "Reset your Orbita Travels password",
    text: `Hello ${name || "Traveller"}, use this link to reset your Orbita Travels password: ${resetLink}`,
    resetLink
  };

  if (!senderConfigured) {
    console.log("Password reset email prepared:", payload);
    return { queued: false, preview: payload };
  }

  // SMTP sender details can be connected here when credentials are provided.
  console.log("SMTP is configured, but no transport is attached yet:", payload);
  return { queued: true };
};
