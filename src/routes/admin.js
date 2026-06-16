import express from "express";
import { Booking, ChatMessage, Hotel, SupportTicket, TourPackage, TrackingEvent, TransportRoute, User } from "../models/index.js";
import { adminOnly, auth } from "../middleware/auth.js";

export const adminRouter = express.Router();
adminRouter.use(auth, adminOnly);

adminRouter.get("/overview", async (_req, res) => {
  const [bookings, users, revenue, oauthUsers, rewardPoints, busBookings, flightBookings, trainBookings] = await Promise.all([
    Booking.count(),
    User.count({ where: { role: "customer" } }),
    Booking.sum("totalAmount"),
    User.count({ where: { role: "customer", authProvider: ["google", "facebook", "apple"] } }),
    User.sum("rewardPoints", { where: { role: "customer" } }),
    Booking.count({ where: { type: "bus" } }),
    Booking.count({ where: { type: "flight" } }),
    Booking.count({ where: { type: "train" } })
  ]);
  res.json({
    bookings,
    users,
    revenue: Number(revenue || 0),
    oauthUsers,
    rewardPoints: Number(rewardPoints || 0),
    byType: { bus: busBookings, flight: flightBookings, train: trainBookings }
  });
});

adminRouter.get("/bookings", async (_req, res) => {
  res.json(await Booking.findAll({ include: [User, TransportRoute, Hotel, TourPackage], order: [["createdAt", "DESC"]] }));
});

adminRouter.get("/bookings/by-type/:type", async (req, res) => {
  res.json(await Booking.findAll({ where: { type: req.params.type }, include: [User, TransportRoute, Hotel, TourPackage], order: [["createdAt", "DESC"]] }));
});

adminRouter.get("/customers", async (_req, res) => {
  res.json(await User.findAll({ where: { role: "customer" }, include: [Booking], order: [["createdAt", "DESC"]] }));
});

adminRouter.get("/support", async (_req, res) => {
  res.json(await SupportTicket.findAll({ include: [User, Booking], order: [["createdAt", "DESC"]] }));
});

adminRouter.get("/chat", async (_req, res) => {
  res.json(await ChatMessage.findAll({ include: [User, Booking], order: [["createdAt", "DESC"]] }));
});

adminRouter.get("/tracking", async (_req, res) => {
  res.json(await TrackingEvent.findAll({ include: [{ model: Booking, include: [User, TransportRoute] }], order: [["createdAt", "DESC"]] }));
});

adminRouter.patch("/bookings/:id/status", async (req, res) => {
  const booking = await Booking.findByPk(req.params.id);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  await booking.update({ status: req.body.status });
  res.json(booking);
});
