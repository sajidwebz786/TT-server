import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { sequelize } from "./config/database.js";
import "./models/index.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { bookingRouter } from "./routes/bookings.js";
import { catalogRouter } from "./routes/catalog.js";
import { transportRouter } from "./routes/transport.js";
import { supportRouter } from "./routes/support.js";
import { Booking, ChatMessage, City, SupportTicket, TrackingEvent, TransportRoute } from "./models/index.js";
import { errorResponse, wrapAsyncRoutes } from "./utils/asyncRoutes.js";

dotenv.config();

const app = express();
// const defaultOrigins = ["https://orbita.co.in", "https://www.orbita.co.in"];
// const envOrigins = [process.env.CLIENT_URL, process.env.ADMIN_URL, process.env.FRONTEND_URL]
//   .filter(Boolean)
//   .join(",")
//   .split(",")
//   .map(url => url.trim())
//   .filter(Boolean);
// const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

// app.use(cors({
//   origin: allowedOrigins.length ? allowedOrigins : true,
//   credentials: true
// }));
// app.use(express.json());

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.get("/api/health", (_req, res) => res.json({ status: "ok", name: "Orbita Travels API" }));
app.use("/api/auth", wrapAsyncRoutes(authRouter));
app.use("/api/catalog", wrapAsyncRoutes(catalogRouter));
app.use("/api/transport", wrapAsyncRoutes(transportRouter));
app.use("/api/bookings", wrapAsyncRoutes(bookingRouter));
app.use("/api/support", wrapAsyncRoutes(supportRouter));
app.use("/api/admin", wrapAsyncRoutes(adminRouter));
app.use(errorResponse);

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

const port = Number(process.env.PORT || 5000);

await sequelize.authenticate();
await sequelize.sync({ alter: true });

const cityCount = await City.count();
if (cityCount === 0) {
  console.log("Database empty, seeding...");
  const { seedDatabase } = await import("./seed/index.js");
  await seedDatabase();
}

const sampleRouteCodes = ["BUS-MUM-GOA-01", "BUS-MUM-GOA-02", "FLT-DEL-GOA-01", "FLT-BLR-KER-01", "TRN-MUM-GOA-01", "TRN-DEL-KAS-01"];
const sampleRoutes = await TransportRoute.findAll({ where: { routeCode: sampleRouteCodes }, attributes: ["id"] });
const sampleRouteIds = sampleRoutes.map((route) => route.id);
const sampleBookings = sampleRouteIds.length ? await Booking.findAll({ where: { TransportRouteId: sampleRouteIds }, attributes: ["id"] }) : [];
const sampleBookingIds = sampleBookings.map((booking) => booking.id);
if (sampleBookingIds.length) {
  await Promise.all([
    TrackingEvent.destroy({ where: { BookingId: sampleBookingIds } }),
    SupportTicket.destroy({ where: { BookingId: sampleBookingIds } }),
    ChatMessage.destroy({ where: { BookingId: sampleBookingIds } })
  ]);
  await Booking.destroy({ where: { id: sampleBookingIds } });
}
const removedSampleRoutes = sampleRouteIds.length ? await TransportRoute.destroy({ where: { id: sampleRouteIds } }) : 0;
if (removedSampleRoutes) console.log(`Removed ${removedSampleRoutes} sample transport routes.`);

app.listen(port, () => console.log(`Orbita Travels API running on http://localhost:${port}`));
