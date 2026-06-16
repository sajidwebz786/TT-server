import express from "express";
import { Booking, ChatMessage, SupportTicket, User } from "../models/index.js";
import { auth } from "../middleware/auth.js";

export const supportRouter = express.Router();

supportRouter.post("/tickets", auth, async (req, res) => {
  const ticket = await SupportTicket.create({
    UserId: req.user.id,
    BookingId: req.body.bookingId || null,
    category: req.body.category || "general",
    priority: req.body.priority || "normal",
    subject: req.body.subject || "Travel support request",
    message: req.body.message
  });
  res.status(201).json(ticket);
});

supportRouter.get("/tickets/mine", auth, async (req, res) => {
  res.json(await SupportTicket.findAll({ where: { UserId: req.user.id }, include: [Booking], order: [["createdAt", "DESC"]] }));
});

supportRouter.post("/chat", auth, async (req, res) => {
  const userMessage = await ChatMessage.create({
    UserId: req.user.id,
    BookingId: req.body.bookingId || null,
    sender: "customer",
    message: req.body.message,
    intent: req.body.intent || "travel_assistance"
  });
  const replyText = buildAssistantReply(req.body.intent, req.body.message);
  const assistantMessage = await ChatMessage.create({
    UserId: req.user.id,
    BookingId: req.body.bookingId || null,
    sender: "assistant",
    message: replyText,
    intent: req.body.intent || "travel_assistance"
  });
  res.status(201).json({ userMessage, assistantMessage });
});

supportRouter.get("/chat/mine", auth, async (req, res) => {
  res.json(await ChatMessage.findAll({ where: { UserId: req.user.id }, include: [Booking], order: [["createdAt", "ASC"]] }));
});

const buildAssistantReply = (intent, message = "") => {
  const text = message.toLowerCase();
  if (intent === "emergency" || text.includes("accident") || text.includes("technical")) {
    return "We have marked this as urgent. Please stay safe, share your current location if possible, and our operations team will review this immediately.";
  }
  if (text.includes("cancel")) return "I can help with cancellation. Open your booking card and choose Request cancellation; the support team will review policy and refund details.";
  if (text.includes("boarding")) return "Please keep your ticket and ID ready. Boarding point, reporting time and operator contact are available in your booking details.";
  return "I am here to help with booking, boarding, cancellation, journey tracking and feedback until your trip is complete.";
};
