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
