import express from "express";
import { Booking, Hotel, TourPackage, TrackingEvent, TransportRoute, User } from "../models/index.js";
import { auth } from "../middleware/auth.js";

export const bookingRouter = express.Router();

const code = (type) => `TT-${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

bookingRouter.post("/", auth, async (req, res) => {
  const { type, itemId, passengers, selectedSeats, contact, travelDate, totalAmount, metadata } = req.body;
  if (!type || !totalAmount) return res.status(400).json({ message: "Booking type and total amount are required" });

  const booking = await Booking.create({
    bookingCode: code(type),
    type,
    UserId: req.user.id,
    TransportRouteId: ["bus", "flight", "train"].includes(type) ? itemId : null,
    HotelId: type === "hotel" ? itemId : null,
    TourPackageId: type === "package" ? itemId : null,
    passengers,
    selectedSeats,
    contact,
    travelDate,
    totalAmount,
    metadata
  });

  if (["bus", "train"].includes(type)) {
    await TrackingEvent.create({
      BookingId: booking.id,
      latitude: 19.076,
      longitude: 72.8777,
      locationName: metadata?.origin || "Boarding terminal",
      status: "Vehicle assigned",
      etaMinutes: 0,
      speedKmph: 0
    });
  }

  const earnedPoints = Math.max(25, Math.floor(Number(totalAmount) / 100));
  await User.increment({ rewardPoints: earnedPoints }, { where: { id: req.user.id } });

  res.status(201).json(await Booking.findByPk(booking.id, { include: [TransportRoute, Hotel, TourPackage] }));
});

bookingRouter.get("/mine", auth, async (req, res) => {
  res.json(await Booking.findAll({ where: { UserId: req.user.id }, include: [TransportRoute, Hotel, TourPackage], order: [["createdAt", "DESC"]] }));
});

bookingRouter.patch("/:id/cancel", auth, async (req, res) => {
  const booking = await Booking.findOne({ where: { id: req.params.id, UserId: req.user.id } });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  await booking.update({ status: "cancel_requested", metadata: { ...booking.metadata, cancelReason: req.body.reason } });
  res.json(booking);
});

bookingRouter.patch("/:id/reschedule", auth, async (req, res) => {
  const booking = await Booking.findOne({ where: { id: req.params.id, UserId: req.user.id } });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  await booking.update({ status: "rescheduled", travelDate: req.body.travelDate, metadata: { ...booking.metadata, rescheduleNote: req.body.note } });
  res.json(booking);
});

bookingRouter.get("/:id/tracking", auth, async (req, res) => {
  const booking = await Booking.findOne({ where: { id: req.params.id, UserId: req.user.id }, include: [TrackingEvent, TransportRoute] });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  res.json(booking);
});
