import { DataTypes } from "sequelize";
import bcrypt from "bcryptjs";
import { sequelize } from "../config/database.js";

export const User = sequelize.define("User", {
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } },
  phone: DataTypes.STRING,
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  authProvider: { type: DataTypes.STRING, defaultValue: "email" },
  providerId: DataTypes.STRING,
  rewardPoints: { type: DataTypes.INTEGER, defaultValue: 0 },
  resetPasswordToken: DataTypes.STRING,
  resetPasswordExpiresAt: DataTypes.DATE,
  role: { type: DataTypes.ENUM("customer", "admin"), defaultValue: "customer" },
  status: { type: DataTypes.ENUM("active", "blocked"), defaultValue: "active" }
});

User.beforeCreate(async (user) => {
  user.passwordHash = await bcrypt.hash(user.passwordHash, 10);
});

export const Destination = sequelize.define("Destination", {
  name: { type: DataTypes.STRING, allowNull: false },
  country: { type: DataTypes.STRING, defaultValue: "India" },
  region: DataTypes.STRING,
  imageUrl: DataTypes.TEXT,
  highlights: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  description: DataTypes.TEXT
});

export const City = sequelize.define("City", {
  name: { type: DataTypes.STRING, allowNull: false },
  state: DataTypes.STRING,
  country: { type: DataTypes.STRING, defaultValue: "India" },
  transportModes: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: ["bus", "flight", "train"] },
  isInternational: { type: DataTypes.BOOLEAN, defaultValue: false },
  externalProvider: DataTypes.STRING,
  externalBusCityId: DataTypes.STRING,
  airportCode: DataTypes.STRING,
  externalHotelCityId: DataTypes.STRING,
  hasLiveBusSearch: { type: DataTypes.BOOLEAN, defaultValue: false },
  hasLiveFlightSearch: { type: DataTypes.BOOLEAN, defaultValue: false },
  hasLiveHotelSearch: { type: DataTypes.BOOLEAN, defaultValue: false },
  externalPayload: { type: DataTypes.JSONB, defaultValue: {} }
});

export const TourPackage = sequelize.define("TourPackage", {
  title: { type: DataTypes.STRING, allowNull: false },
  category: { type: DataTypes.ENUM("family", "honeymoon", "adventure", "pilgrimage", "luxury", "corporate"), allowNull: false },
  durationDays: { type: DataTypes.INTEGER, allowNull: false },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  imageUrl: DataTypes.TEXT,
  inclusions: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  itinerary: { type: DataTypes.JSONB, defaultValue: [] },
  rating: { type: DataTypes.FLOAT, defaultValue: 4.7 },
  seatsAvailable: { type: DataTypes.INTEGER, defaultValue: 24 },
  status: { type: DataTypes.ENUM("active", "draft"), defaultValue: "active" }
});

export const Hotel = sequelize.define("Hotel", {
  name: { type: DataTypes.STRING, allowNull: false },
  city: { type: DataTypes.STRING, allowNull: false },
  starRating: { type: DataTypes.INTEGER, defaultValue: 4 },
  pricePerNight: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  imageUrl: DataTypes.TEXT,
  amenities: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  roomTypes: { type: DataTypes.JSONB, defaultValue: [] },
  rating: { type: DataTypes.FLOAT, defaultValue: 4.6 },
  externalProvider: DataTypes.STRING,
  externalHotelCode: DataTypes.STRING,
  externalPayload: { type: DataTypes.JSONB, defaultValue: {} }
});

export const TransportRoute = sequelize.define("TransportRoute", {
  type: { type: DataTypes.ENUM("bus", "flight", "train"), allowNull: false },
  providerName: { type: DataTypes.STRING, allowNull: false },
  routeCode: { type: DataTypes.STRING, allowNull: false },
  origin: { type: DataTypes.STRING, allowNull: false },
  destination: { type: DataTypes.STRING, allowNull: false },
  departureTime: { type: DataTypes.DATE, allowNull: false },
  arrivalTime: { type: DataTypes.DATE, allowNull: false },
  price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  classType: DataTypes.STRING,
  vehicleType: DataTypes.STRING,
  amenities: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  seatLayout: { type: DataTypes.JSONB, defaultValue: {} },
  baggage: DataTypes.STRING,
  externalProvider: DataTypes.STRING,
  externalRouteId: DataTypes.STRING,
  externalPayload: { type: DataTypes.JSONB, defaultValue: {} },
  rating: { type: DataTypes.FLOAT, defaultValue: 4.5 },
  cancellationPolicy: DataTypes.STRING
});

export const Booking = sequelize.define("Booking", {
  bookingCode: { type: DataTypes.STRING, unique: true, allowNull: false },
  type: { type: DataTypes.ENUM("bus", "flight", "train", "hotel", "package"), allowNull: false },
  status: { type: DataTypes.ENUM("pending", "confirmed", "cancel_requested", "cancelled", "rescheduled", "completed"), defaultValue: "confirmed" },
  travelDate: DataTypes.DATEONLY,
  passengers: { type: DataTypes.JSONB, defaultValue: [] },
  selectedSeats: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  contact: { type: DataTypes.JSONB, defaultValue: {} },
  totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  paymentStatus: { type: DataTypes.ENUM("unpaid", "paid", "refunded"), defaultValue: "paid" },
  metadata: { type: DataTypes.JSONB, defaultValue: {} }
});

export const SupportTicket = sequelize.define("SupportTicket", {
  category: { type: DataTypes.ENUM("general", "boarding", "delay", "technical_issue", "accident", "cancellation", "refund", "grievance", "feedback"), defaultValue: "general" },
  priority: { type: DataTypes.ENUM("normal", "urgent", "emergency"), defaultValue: "normal" },
  subject: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.ENUM("open", "in_progress", "resolved"), defaultValue: "open" }
});

export const ChatMessage = sequelize.define("ChatMessage", {
  sender: { type: DataTypes.ENUM("customer", "assistant", "admin"), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  intent: { type: DataTypes.STRING, defaultValue: "travel_assistance" },
  metadata: { type: DataTypes.JSONB, defaultValue: {} }
});

export const TrackingEvent = sequelize.define("TrackingEvent", {
  latitude: DataTypes.FLOAT,
  longitude: DataTypes.FLOAT,
  status: { type: DataTypes.STRING, defaultValue: "On schedule" },
  locationName: DataTypes.STRING,
  etaMinutes: DataTypes.INTEGER,
  speedKmph: DataTypes.FLOAT
});

export const Review = sequelize.define("Review", {
  rating: { type: DataTypes.INTEGER, allowNull: false },
  comment: DataTypes.TEXT
});

User.hasMany(Booking);
Booking.belongsTo(User);

Destination.hasMany(TourPackage);
TourPackage.belongsTo(Destination);

Destination.hasMany(Hotel);
Hotel.belongsTo(Destination);

TourPackage.hasMany(Booking);
Booking.belongsTo(TourPackage);

Hotel.hasMany(Booking);
Booking.belongsTo(Hotel);

TransportRoute.hasMany(Booking);
Booking.belongsTo(TransportRoute);

User.hasMany(SupportTicket);
SupportTicket.belongsTo(User);
Booking.hasMany(SupportTicket);
SupportTicket.belongsTo(Booking);

User.hasMany(ChatMessage);
ChatMessage.belongsTo(User);
Booking.hasMany(ChatMessage);
ChatMessage.belongsTo(Booking);

Booking.hasMany(TrackingEvent);
TrackingEvent.belongsTo(Booking);

User.hasMany(Review);
Review.belongsTo(User);
TourPackage.hasMany(Review);
Review.belongsTo(TourPackage);

export const models = { User, City, Destination, TourPackage, Hotel, TransportRoute, Booking, SupportTicket, ChatMessage, TrackingEvent, Review };
