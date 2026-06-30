import express from "express";
import { Booking, Hotel, TourPackage, TrackingEvent, TransportRoute, User } from "../models/index.js";
import { auth } from "../middleware/auth.js";
import { bookBdsdBus, cancelBdsdBusBooking } from "../services/bdsdClient.js";
import { createRazorpayOrder, razorpayConfigured, refundRazorpayPayment, verifyRazorpayPayment } from "../services/razorpayClient.js";

export const bookingRouter = express.Router();

const code = (type) => `TT-${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
const paymentsRequired = () => process.env.PAYMENTS_REQUIRED !== "false" && razorpayConfigured();

const refundPercentFor = (booking) => {
  const travelTime = booking.travelDate ? new Date(booking.travelDate).getTime() : NaN;
  if (!Number.isFinite(travelTime)) return 75;
  const hours = (travelTime - Date.now()) / (60 * 60 * 1000);
  if (hours > 24) return 90;
  if (hours > 12) return 75;
  if (hours > 6) return 50;
  if (hours > 0) return 25;
  return 0;
};

bookingRouter.get("/payments/status", auth, (_req, res) => {
  res.json({ razorpay: { enabled: razorpayConfigured(), paymentsRequired: paymentsRequired() } });
});

bookingRouter.post("/payments/order", auth, async (req, res) => {
  if (!razorpayConfigured()) return res.status(503).json({ message: "Razorpay is not configured" });
  const { amount, type, routeLine } = req.body;
  const order = await createRazorpayOrder({
    amount,
    receipt: code(type || "pay"),
    notes: {
      userId: String(req.user.id),
      customer: req.user.email,
      type: String(type || "booking"),
      route: String(routeLine || "").slice(0, 120)
    }
  });
  res.status(201).json(order);
});

bookingRouter.post("/", auth, async (req, res) => {
  const { type, itemId, passengers, selectedSeats, contact, travelDate, totalAmount, metadata, payment } = req.body;
  if (!type || !totalAmount) return res.status(400).json({ message: "Booking type and total amount are required" });
  if (paymentsRequired()) {
    const verified = verifyRazorpayPayment(payment || {});
    if (!verified) return res.status(402).json({ message: "Payment verification failed. Booking was not created." });
  }

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
    paymentStatus: paymentsRequired() ? "paid" : "unpaid",
    metadata: {
      ...(metadata || {}),
      payment: payment ? {
        provider: "razorpay",
        orderId: payment.razorpay_order_id,
        paymentId: payment.razorpay_payment_id,
        verified: paymentsRequired()
      } : { provider: "manual", verified: !paymentsRequired() }
    }
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

  if (type === "bus") {
    const route = await TransportRoute.findByPk(itemId);
    if (route?.externalProvider === "bdsd") {
      try {
        const providerBooking = await bookBdsdBus(route, { passengers, selectedSeats, contact, travelDate, totalAmount, metadata });
        if (providerBooking) {
          await booking.update({ metadata: { ...booking.metadata, bdsdBooking: providerBooking } });
        }
      } catch (error) {
        await booking.update({ metadata: { ...booking.metadata, bdsdBookingError: error.message } });
      }
    }
  }

  const earnedPoints = Math.max(25, Math.floor(Number(totalAmount) / 100));
  await User.increment({ rewardPoints: earnedPoints }, { where: { id: req.user.id } });

  res.status(201).json(await Booking.findByPk(booking.id, { include: [TransportRoute, Hotel, TourPackage] }));
});

bookingRouter.get("/mine", auth, async (req, res) => {
  res.json(await Booking.findAll({ where: { UserId: req.user.id }, include: [TransportRoute, Hotel, TourPackage], order: [["createdAt", "DESC"]] }));
});

bookingRouter.patch("/:id/cancel", auth, async (req, res) => {
  const booking = await Booking.findOne({ where: { id: req.params.id, UserId: req.user.id }, include: [TransportRoute, Hotel, TourPackage] });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  if (["cancel_requested", "cancelled", "completed"].includes(booking.status)) {
    return res.status(400).json({ message: `Booking is already ${booking.status}` });
  }

  const reason = req.body.reason || "Customer requested cancellation";
  const refundPercent = refundPercentFor(booking);
  const refundAmount = Math.round((Number(booking.totalAmount || 0) * refundPercent) / 100);
  const cancellation = { reason, refundPercent, refundAmount, requestedAt: new Date().toISOString() };

  let bdsdCancellation = null;
  if (booking.type === "bus" && booking.TransportRoute?.externalProvider === "bdsd") {
    try {
      bdsdCancellation = await cancelBdsdBusBooking(booking.TransportRoute, booking, reason);
    } catch (error) {
      bdsdCancellation = { error: error.message };
    }
  }

  let refund = null;
  const paymentId = booking.metadata?.payment?.paymentId;
  if (paymentId && refundAmount > 0 && razorpayConfigured()) {
    try {
      refund = await refundRazorpayPayment({
        paymentId,
        amount: refundAmount,
        notes: { bookingCode: booking.bookingCode, reason }
      });
    } catch (error) {
      refund = { error: error.message };
    }
  }

  const refundFailed = refund?.error;
  const bdsdFailed = bdsdCancellation?.error;
  const nextStatus = refundFailed || bdsdFailed ? "cancel_requested" : "cancelled";
  await booking.update({
    status: nextStatus,
    paymentStatus: refund && !refund.error ? "refunded" : booking.paymentStatus,
    metadata: {
      ...booking.metadata,
      cancelReason: reason,
      cancellation: {
        ...cancellation,
        status: nextStatus,
        bdsdCancellation,
        refund
      }
    }
  });
  res.json(await Booking.findByPk(booking.id, { include: [TransportRoute, Hotel, TourPackage] }));
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
