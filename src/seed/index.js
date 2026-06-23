import dotenv from "dotenv";
import { sequelize } from "../config/database.js";
import { ChatMessage, City, Destination, Hotel, SupportTicket, TourPackage, TrackingEvent, TransportRoute, User } from "../models/index.js";

dotenv.config();

const seatLayout = (rows = 10, cols = 4, sleeper = false) => {
  const seats = [];
  for (let row = 0; row < rows; row += 1) {
    if (sleeper) {
      // 1-2 configuration with walkway: A, [WALKWAY], B, C
      const rowNum = row + 1;
      seats.push(
        { id: `A${rowNum}`, deck: row > 5 ? "upper" : "lower", fareMultiplier: 1 },
        { id: `W${rowNum}`, deck: row > 5 ? "upper" : "lower", isWalkway: true },
        { id: `B${rowNum}`, deck: row > 5 ? "upper" : "lower", fareMultiplier: 1 },
        { id: `C${rowNum}`, deck: row > 5 ? "upper" : "lower", fareMultiplier: 1 }
      );
    } else {
      // Standard 4-column seater layout
      ["A", "B", "C", "D"].forEach((col) => {
        seats.push({
          id: `${col}${row + 1}`,
          deck: sleeper && row > 5 ? "upper" : "lower",
          fareMultiplier: col === "A" || col === "D" ? 1.1 : 1
        });
      });
    }
  }
  return {
    rows,
    cols: sleeper ? 4 : cols,
    type: sleeper ? "sleeper" : "seater",
    unavailable: ["A3", "B4", "C7"],
    seats
  };
};

export const seedDatabase = async () => {
  const indianCities = [
    ["Agra", "Uttar Pradesh"], ["Ahmedabad", "Gujarat"], ["Amritsar", "Punjab"], ["Bengaluru", "Karnataka"],
    ["Bhopal", "Madhya Pradesh"], ["Bhubaneswar", "Odisha"], ["Chandigarh", "Chandigarh"], ["Chennai", "Tamil Nadu"],
    ["Coimbatore", "Tamil Nadu"], ["Dehradun", "Uttarakhand"], ["Delhi", "Delhi"], ["Goa", "Goa"],
    ["Guwahati", "Assam"], ["Hyderabad", "Telangana"], ["Indore", "Madhya Pradesh"], ["Jaipur", "Rajasthan"],
    ["Jammu", "Jammu and Kashmir"], ["Jodhpur", "Rajasthan"], ["Kanpur", "Uttar Pradesh"], ["Kochi", "Kerala"],
    ["Kolkata", "West Bengal"], ["Kozhikode", "Kerala"], ["Lucknow", "Uttar Pradesh"], ["Madurai", "Tamil Nadu"],
    ["Mangaluru", "Karnataka"], ["Mumbai", "Maharashtra"], ["Mysuru", "Karnataka"], ["Nagpur", "Maharashtra"],
    ["Nashik", "Maharashtra"], ["Patna", "Bihar"], ["Pune", "Maharashtra"], ["Raipur", "Chhattisgarh"],
    ["Rajkot", "Gujarat"], ["Ranchi", "Jharkhand"], ["Shimla", "Himachal Pradesh"], ["Srinagar", "Jammu and Kashmir"],
    ["Surat", "Gujarat"], ["Thiruvananthapuram", "Kerala"], ["Udaipur", "Rajasthan"], ["Vadodara", "Gujarat"],
    ["Varanasi", "Uttar Pradesh"], ["Vijayawada", "Andhra Pradesh"], ["Visakhapatnam", "Andhra Pradesh"]
  ];

  await City.bulkCreate(indianCities.map(([name, state]) => ({ name, state })));

  const [goa, kerala, kashmir] = await Destination.bulkCreate([
    {
      name: "Goa",
      region: "West Coast",
      imageUrl: "https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1400&q=80",
      highlights: ["Beaches", "Cruises", "Nightlife"],
      description: "Premium beach escapes, private transfers and coastal experiences."
    },
    {
      name: "Kerala",
      region: "South India",
      imageUrl: "https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=1400&q=80",
      highlights: ["Backwaters", "Ayurveda", "Houseboats"],
      description: "Backwater stays, hill stations, wellness resorts and family itineraries."
    },
    {
      name: "Kashmir",
      region: "North India",
      imageUrl: "https://images.unsplash.com/photo-1595815771614-ade9d652a65d?auto=format&fit=crop&w=1400&q=80",
      highlights: ["Snow", "Shikara", "Meadows"],
      description: "Curated mountain holidays with scenic drives and premium stays."
    }
  ], { returning: true });

  await TourPackage.bulkCreate([
    { title: "Royal Goa Family Retreat", category: "family", durationDays: 5, price: 34999, DestinationId: goa.id, imageUrl: goa.imageUrl, inclusions: ["Hotel", "Breakfast", "Airport transfers", "Sightseeing"], itinerary: ["North Goa", "South Goa", "Dolphin cruise"], seatsAvailable: 18 },
    { title: "Kerala Backwater Luxury Trail", category: "luxury", durationDays: 6, price: 52999, DestinationId: kerala.id, imageUrl: kerala.imageUrl, inclusions: ["Houseboat", "Private cab", "Wellness spa"], itinerary: ["Munnar", "Thekkady", "Alleppey"], seatsAvailable: 12 },
    { title: "Kashmir Snow and Meadows", category: "honeymoon", durationDays: 7, price: 64999, DestinationId: kashmir.id, imageUrl: kashmir.imageUrl, inclusions: ["Houseboat", "Gulmarg cable car", "Meals"], itinerary: ["Srinagar", "Gulmarg", "Pahalgam"], seatsAvailable: 10 }
  ]);

  await Hotel.bulkCreate([
    { name: "Azure Coast Grand", city: "Goa", DestinationId: goa.id, starRating: 5, pricePerNight: 8999, imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80", amenities: ["Pool", "Spa", "Sea view"], roomTypes: ["Deluxe", "Suite"] },
    { name: "Emerald Backwater Resort", city: "Kerala", DestinationId: kerala.id, starRating: 5, pricePerNight: 10999, imageUrl: "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1200&q=80", amenities: ["Houseboat dock", "Ayurveda", "Private dining"], roomTypes: ["Lake Villa", "Heritage Suite"] },
    { name: "Cedar Palace Srinagar", city: "Kashmir", DestinationId: kashmir.id, starRating: 4, pricePerNight: 7499, imageUrl: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80", amenities: ["Heated rooms", "Mountain view", "Shikara desk"], roomTypes: ["Premier", "Family"] }
  ]);

  const now = new Date();
  const addHours = (h) => new Date(now.getTime() + h * 60 * 60 * 1000);
  const addDays = (d) => { const dt = new Date(now); dt.setDate(dt.getDate() + d); return dt; };
  await TransportRoute.bulkCreate([
    { type: "bus", providerName: "Orbita Travels Prime Bus", routeCode: "BUS-MUM-GOA-01", origin: "Mumbai", destination: "Goa", departureTime: addHours(8), arrivalTime: addHours(20), price: 1499, classType: "AC Sleeper", vehicleType: "Volvo Multi Axle", amenities: ["Live tracking", "Blanket", "Charging"], seatLayout: seatLayout(10, 4, true), cancellationPolicy: "Free cancellation up to 6 hours" },
    { type: "bus", providerName: "BlueLine Express", routeCode: "BUS-MUM-GOA-02", origin: "Mumbai", destination: "Goa", departureTime: addHours(10), arrivalTime: addHours(22), price: 999, classType: "AC Seater", vehicleType: "Premium Coach", amenities: ["Water bottle", "Charging"], seatLayout: seatLayout(11, 4, false), cancellationPolicy: "Partial refund" },
    { type: "flight", providerName: "Orbita Travels Air", routeCode: "FLT-DEL-GOA-01", origin: "Delhi", destination: "Goa", departureTime: addHours(6), arrivalTime: addHours(8.5), price: 6299, classType: "Economy", vehicleType: "A320", amenities: ["Cabin baggage", "Meal add-on"], baggage: "15kg check-in + 7kg cabin", seatLayout: seatLayout(18, 4, false), cancellationPolicy: "Airline rules apply" },
    { type: "flight", providerName: "SkyVista", routeCode: "FLT-BLR-KER-01", origin: "Bengaluru", destination: "Kerala", departureTime: addHours(5), arrivalTime: addHours(6.2), price: 4299, classType: "Premium Economy", vehicleType: "B737", amenities: ["Priority boarding", "Extra legroom"], baggage: "20kg check-in + 7kg cabin", seatLayout: seatLayout(16, 4, false), cancellationPolicy: "Refundable fare" },
    { type: "train", providerName: "Konkan Heritage", routeCode: "TRN-MUM-GOA-01", origin: "Mumbai", destination: "Goa", departureTime: addHours(12), arrivalTime: addHours(24), price: 1299, classType: "3AC", vehicleType: "Express", amenities: ["Pantry", "Bedding", "Window seats"], seatLayout: seatLayout(12, 4, true), cancellationPolicy: "Railway rules apply" },
    { type: "train", providerName: "Northern Crown", routeCode: "TRN-DEL-KAS-01", origin: "Delhi", destination: "Kashmir", departureTime: addHours(15), arrivalTime: addHours(33), price: 2199, classType: "2AC", vehicleType: "Superfast", amenities: ["Bedding", "Meals", "Reading light"], seatLayout: seatLayout(10, 4, true), cancellationPolicy: "Railway rules apply" }
  ]);

  const users = await User.bulkCreate([
    { name: "Admin", email: "admin@orbitatravels.com", phone: "9999999999", passwordHash: "admin123", role: "admin" },
    { name: "Demo Customer", email: "customer@orbitatravels.com", phone: "8888888888", passwordHash: "customer123", role: "customer" }
  ], { individualHooks: true });

  const demo = users.find((user) => user.role === "customer");
  const route = await TransportRoute.findOne({ where: { type: "bus" } });
  const pastDate = new Date(now);
  pastDate.setDate(pastDate.getDate() - 3);
  const pastBooking = await route.createBooking({
    bookingCode: "TT-BUS-PAST",
    type: "bus",
    UserId: demo.id,
    travelDate: pastDate.toISOString().slice(0, 10),
    passengers: [{ name: "Demo Customer", age: 30, gender: "Male", idType: "Aadhaar", idNumber: "XXXX-1234", seat: "A1" }],
    selectedSeats: ["A1"],
    contact: { email: demo.email, phone: demo.phone },
    totalAmount: 1499,
    paymentStatus: "paid",
    status: "completed",
    metadata: { origin: route.origin, destination: route.destination, boardingPoint: "Mumbai Central", dropPoint: "Panaji Bus Stand" }
  });
  await pastBooking.update({ UserId: demo.id });
  const booking = await route.createBooking({
    bookingCode: "TT-BUS-SAMPLE",
    type: "bus",
    UserId: demo.id,
    travelDate: "2026-06-15",
    passengers: [{ name: "Demo Customer", age: 30, gender: "Male", idType: "Aadhaar", idNumber: "XXXX-1234", seat: "A2" }],
    selectedSeats: ["A2"],
    contact: { email: demo.email, phone: demo.phone },
    totalAmount: 1499,
    paymentStatus: "paid",
    metadata: { origin: route.origin, destination: route.destination, boardingPoint: "Mumbai Central", dropPoint: "Panaji Bus Stand" }
  });
  await booking.update({ UserId: demo.id });
  await TrackingEvent.bulkCreate([
    { BookingId: booking.id, latitude: 19.076, longitude: 72.8777, locationName: "Mumbai Central", status: "Boarding soon", etaMinutes: 0, speedKmph: 0 },
    { BookingId: booking.id, latitude: 18.5204, longitude: 73.8567, locationName: "Pune bypass", status: "On schedule", etaMinutes: 420, speedKmph: 64 }
  ]);
  await SupportTicket.create({ UserId: demo.id, BookingId: booking.id, category: "boarding", priority: "normal", subject: "Boarding point clarification", message: "Please confirm the boarding point and reporting time." });
  await ChatMessage.bulkCreate([
    { UserId: demo.id, BookingId: booking.id, sender: "customer", message: "Can you help me with boarding details?", intent: "boarding" },
    { UserId: demo.id, BookingId: booking.id, sender: "assistant", message: "Your boarding point is Mumbai Central. Please arrive 20 minutes before departure.", intent: "boarding" }
  ]);

  console.log("Orbita Travels database seeded");
};

export default seedDatabase;
