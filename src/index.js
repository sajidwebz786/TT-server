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
import { City } from "./models/index.js";
import { errorResponse, wrapAsyncRoutes } from "./utils/asyncRoutes.js";

dotenv.config();

const app = express();
const defaultOrigins = ["https://orbita.co.in", "https://www.orbita.co.in"];
const envOrigins = [process.env.CLIENT_URL, process.env.ADMIN_URL, process.env.FRONTEND_URL]
  .filter(Boolean)
  .join(",")
  .split(",")
  .map(url => url.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true
}));
app.use(express.json());

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

app.listen(port, () => console.log(`Orbita Travels API running on http://localhost:${port}`));
