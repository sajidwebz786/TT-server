import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/index.js";
import { auth } from "../middleware/auth.js";
import { buildResetLink, sendPasswordResetEmail } from "../utils/mailer.js";

export const authRouter = express.Router();

const issueToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || "traveltimes-premium-secret", { expiresIn: "7d" });

const userView = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  authProvider: user.authProvider,
  rewardPoints: user.rewardPoints || 0
});

const urlsFromEnv = (...values) =>
  values
    .flatMap((value) => String(value || "").split(","))
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);
const configuredFrontendUrls = () => urlsFromEnv(process.env.FRONTEND_URL, process.env.CLIENT_URL);
const defaultFrontendUrl = () => configuredFrontendUrls()[0] || "https://traveltimes-web.onrender.com";
const googleCallbackUrl = () => process.env.GOOGLE_CALLBACK_URL || "https://tt-server-2a68.onrender.com/api/auth/google/callback";
const oauthStateSecret = () => process.env.JWT_SECRET || "traveltimes-premium-secret";

const safeFrontendUrl = (returnTo) => {
  const requested = String(returnTo || "").trim().replace(/\/$/, "");
  const allowed = configuredFrontendUrls();
  return allowed.includes(requested) ? requested : defaultFrontendUrl();
};

const redirectToFrontendCallback = (res, params, returnTo) => {
  const hash = new URLSearchParams(params).toString();
  res.redirect(`${safeFrontendUrl(returnTo)}/auth/google/callback#${hash}`);
};

const createOAuthState = (returnTo) =>
  jwt.sign(
    { provider: "google", nonce: crypto.randomBytes(16).toString("hex"), returnTo: safeFrontendUrl(returnTo) },
    oauthStateSecret(),
    { expiresIn: "10m" }
  );

const readOAuthState = (state) => {
  try {
    const payload = jwt.verify(String(state || ""), oauthStateSecret());
    return payload.provider === "google" ? payload : null;
  } catch {
    return null;
  }
};

authRouter.post("/register", async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
  const user = await User.create({ name, email, phone, passwordHash: password });
  res.status(201).json({ token: issueToken(user), user: userView(user) });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }
  res.json({ token: issueToken(user), user: userView(user) });
});

authRouter.post("/oauth", async (req, res) => {
  const { provider, providerId, name, email, phone } = req.body;
  if (!provider || !email) return res.status(400).json({ message: "Provider and email are required" });
  const safeProvider = String(provider).toLowerCase();
  const [user] = await User.findOrCreate({
    where: { email },
    defaults: {
      name: name || email.split("@")[0],
      email,
      phone,
      passwordHash: `${safeProvider}-${providerId || Date.now()}-${Math.random().toString(36).slice(2)}`,
      authProvider: safeProvider,
      providerId: providerId || email
    }
  });
  if (user.authProvider === "email") {
    await user.update({ authProvider: safeProvider, providerId: providerId || email, phone: phone || user.phone });
  }
  res.json({ token: issueToken(user), user: userView(user) });
});

authRouter.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return redirectToFrontendCallback(res, { error: "Google sign-in is not configured" });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleCallbackUrl(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state: createOAuthState(req.query.returnTo)
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRouter.get("/google/callback", async (req, res) => {
  const { code, error, state } = req.query;
  const oauthState = readOAuthState(state);
  const returnTo = oauthState?.returnTo;
  if (error) return redirectToFrontendCallback(res, { error: String(error) }, returnTo);
  if (!code) return redirectToFrontendCallback(res, { error: "Google did not return an authorization code" }, returnTo);
  if (!oauthState) return redirectToFrontendCallback(res, { error: "Google sign-in session expired. Please try again." }, returnTo);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectToFrontendCallback(res, { error: "Google sign-in is not configured" }, returnTo);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleCallbackUrl(),
        grant_type: "authorization_code"
      })
    });

    if (!tokenRes.ok) {
      throw new Error("Google token exchange failed");
    }

    const tokenData = await tokenRes.json();
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!profileRes.ok) {
      throw new Error("Google profile lookup failed");
    }

    const profile = await profileRes.json();
    if (!profile.email) {
      return redirectToFrontendCallback(res, { error: "Google account email is required" }, returnTo);
    }
    if (profile.email_verified === false || profile.email_verified === "false") {
      return redirectToFrontendCallback(res, { error: "Google account email is not verified" }, returnTo);
    }

    const [user] = await User.findOrCreate({
      where: { email: profile.email },
      defaults: {
        name: profile.name || profile.email.split("@")[0],
        email: profile.email,
        passwordHash: `google-${profile.sub || Date.now()}-${Math.random().toString(36).slice(2)}`,
        authProvider: "google",
        providerId: profile.sub || profile.email
      }
    });

    if (user.authProvider === "email" || !user.providerId) {
      await user.update({
        name: user.name || profile.name || profile.email.split("@")[0],
        authProvider: "google",
        providerId: profile.sub || profile.email
      });
    }

    redirectToFrontendCallback(res, { token: issueToken(user) }, returnTo);
  } catch (err) {
    console.error("Google OAuth failed:", err.message);
    redirectToFrontendCallback(res, { error: "Google sign-in failed" }, returnTo);
  }
});

authRouter.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email address is required" });

  const user = await User.findOne({ where: { email } });
  if (!user) {
    return res.json({ message: "If an account exists for this email, password reset instructions will be sent." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await user.update({
    resetPasswordToken: token,
    resetPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });

  const resetLink = buildResetLink(token);
  const mail = await sendPasswordResetEmail({ to: user.email, name: user.name, resetLink });
  res.json({
    message: "If an account exists for this email, password reset instructions will be sent.",
    resetLink: process.env.NODE_ENV === "production" ? undefined : mail.preview?.resetLink
  });
});

authRouter.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ message: "Reset token and new password are required" });
  if (String(password).length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  const user = await User.findOne({ where: { resetPasswordToken: token } });
  if (!user || !user.resetPasswordExpiresAt || new Date(user.resetPasswordExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ message: "Reset link is invalid or expired" });
  }

  await user.update({
    passwordHash: await bcrypt.hash(password, 10),
    resetPasswordToken: null,
    resetPasswordExpiresAt: null,
    authProvider: user.authProvider || "email"
  });

  res.json({ token: issueToken(user), user: userView(user), message: "Password updated successfully" });
});

authRouter.get("/me", auth, (req, res) => {
  res.json({ user: userView(req.user) });
});
