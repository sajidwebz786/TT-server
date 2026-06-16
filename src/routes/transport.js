import express from "express";
import { TransportRoute } from "../models/index.js";

export const transportRouter = express.Router();

transportRouter.get("/:type/search", async (req, res) => {
  const { type } = req.params;
  if (!["bus", "flight", "train"].includes(type)) return res.status(400).json({ message: "Invalid transport type" });

  const where = { type };
  if (req.query.from) where.origin = req.query.from;
  if (req.query.to) where.destination = req.query.to;

  let routes = await TransportRoute.findAll({ where, order: [["price", "ASC"]] });
  if (type === "bus" && req.query.from && req.query.to) {
    await ensureRouteOptions(type, req.query.from, req.query.to, busOptionsForRoute(req.query.from, req.query.to));
    routes = await TransportRoute.findAll({ where, order: [["price", "ASC"]] });
  }
  if (!routes.length && req.query.from && req.query.to) {
    const now = new Date();
    const options = type === "bus"
      ? busOptionsForRoute(req.query.from, req.query.to)
      : [
        ["TravelTimes Select", 8, 16, 1, "seater"],
        ["TravelTimes Comfort", 10, 19, 1.22, "seater"],
        ["TravelTimes Luxe", 13, 21, 1.48, "seater"]
      ];
    const baseFare = type === "flight" ? 5200 : type === "train" ? 1200 : 950;
    const typeMeta = {
      bus: ["AC Seater", "Premium Coach", ["Live tracking", "Charging", "Water bottle"]],
      flight: ["Economy", "A320", ["Cabin baggage", "Meal option", "Web check-in"]],
      train: ["3AC", "Express", ["Bedding", "Pantry", "Window preference"]]
    };
    const created = await TransportRoute.bulkCreate(options.map(([name, depart, arrive, multiplier, layoutKind = "seater", classType, vehicleType, ac = true], index) => ({
      type,
      providerName: name,
      routeCode: `${type.toUpperCase()}-${String(req.query.from).slice(0, 3).toUpperCase()}-${String(req.query.to).slice(0, 3).toUpperCase()}-${index + 1}`,
      origin: req.query.from,
      destination: req.query.to,
      departureTime: new Date(now.getTime() + depart * 60 * 60 * 1000),
      arrivalTime: new Date(now.getTime() + arrive * 60 * 60 * 1000),
      price: Math.round(baseFare * multiplier),
      classType: classType || typeMeta[type][0],
      vehicleType: vehicleType || typeMeta[type][1],
      amenities: ac ? typeMeta[type][2] : ["Live tracking", "Water bottle"],
      seatLayout: makeSeatLayout(type, layoutKind),
      baggage: type === "flight" ? "15kg check-in + 7kg cabin" : null,
      cancellationPolicy: "Refund depends on booking stage and operator policy"
    })), { returning: true });
    routes = created;
  }
  res.json(routes);
});

transportRouter.get("/:type/:id/seats", async (req, res) => {
  const route = await TransportRoute.findOne({ where: { id: req.params.id, type: req.params.type } });
  if (!route) return res.status(404).json({ message: "Route not found" });
  res.json(route.seatLayout);
});

const andhraCities = new Set(["Vijayawada", "Visakhapatnam", "Tirupati", "Guntur", "Kurnool", "Nellore"]);
const telanganaCities = new Set(["Hyderabad", "Warangal", "Karimnagar", "Nizamabad", "Khammam"]);
const karnatakaCities = new Set(["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Davangere"]);

const busOptionsForRoute = (from, to) => {
  const routeCities = [from, to].map(String);
  const options = [];
  if (routeCities.some((city) => andhraCities.has(city))) {
    options.push(["APSRTC Garuda Plus", 7, 16, 1.08, "semi-sleeper", "AC Semi Sleeper", "Garuda Plus"]);
  }
  if (routeCities.some((city) => telanganaCities.has(city))) {
    options.push(["TGSRTC Rajadhani", 8, 17, 1.02, "seater", "AC Seater", "Rajadhani"]);
  }
  if (routeCities.some((city) => karnatakaCities.has(city))) {
    options.push(["KSRTC Airavat Club Class", 9, 18, 1.18, "semi-seater", "AC Semi Seater", "Airavat Club Class"]);
  }
  options.push(
    ["VRL Travels", 6, 17, 1.16, "sleeper", "AC Sleeper", "Volvo 9600 Multi Axle"],
    ["SRS Travels", 7, 18, 1.05, "semi-sleeper", "AC Semi Sleeper", "Scania Premium"],
    ["Orange Tours and Travels", 9, 20, 1.22, "sleeper", "AC Sleeper", "BharatBenz Sleeper"],
    ["Kaveri Travels", 11, 22, 0.96, "semi-seater", "Non AC Semi Seater", "Executive Coach", false],
    ["KPN Travels", 13, 23, 1.08, "semi-sleeper", "AC Semi Sleeper", "Premium Coach"],
    ["IntrCity SmartBus", 15, 25, 1.14, "seater", "AC Seater", "SmartBus"],
    ["NueGo Electric", 16, 24, 0.92, "seater", "AC Seater", "Electric Coach"],
    ["BlueLine Express", 12, 24, 0.88, "seater", "Non AC Seater", "Express Coach", false]
  );
  return options;
};

const ensureRouteOptions = async (type, from, to, options) => {
  const now = new Date();
  const baseFare = 950;
  await Promise.all(options.map(async ([name, depart, arrive, multiplier, layoutKind = "seater", classType, vehicleType, ac = true], index) => {
    const routeCode = `${type.toUpperCase()}-${String(from).slice(0, 3).toUpperCase()}-${String(to).slice(0, 3).toUpperCase()}-${name.replace(/[^A-Z0-9]/gi, "").slice(0, 7).toUpperCase()}-${index + 1}`;
    const [route, created] = await TransportRoute.findOrCreate({
      where: { routeCode },
      defaults: {
        type,
        providerName: name,
        routeCode,
        origin: from,
        destination: to,
        departureTime: new Date(now.getTime() + depart * 60 * 60 * 1000),
        arrivalTime: new Date(now.getTime() + arrive * 60 * 60 * 1000),
        price: Math.round(baseFare * multiplier),
        classType,
        vehicleType,
        amenities: ac ? ["Live tracking", "Charging", "Water bottle"] : ["Live tracking", "Water bottle"],
        seatLayout: makeSeatLayout(type, layoutKind),
        cancellationPolicy: index % 2 === 0 ? "Free cancellation up to 6 hours" : "Partial refund",
        rating: 4.1 + ((index % 5) / 10)
      }
    });
    if (!created && route.seatLayout?.type !== layoutKind) {
      await route.update({ classType, vehicleType, seatLayout: makeSeatLayout(type, layoutKind) });
    }
  }));
};

const makeSeatLayout = (type, layoutKind = "seater") => {
  if (type === "flight") {
    const labels = ["A", "B", "C", "D", "E", "F"];
    return {
      rows: 12,
      cols: labels.length,
      type: "seater",
      unavailable: ["A3", "B4", "C7"],
      seats: Array.from({ length: 12 }, (_, row) => labels.map((col) => ({
        id: `${col}${row + 1}`,
        deck: "lower",
        fareMultiplier: ["A", "F"].includes(col) ? 1.12 : 1
      }))).flat()
    };
  }
  
  const sleeperLike = ["sleeper", "semi-sleeper"].includes(layoutKind) || type === "train";
  const semiSeater = layoutKind === "semi-seater";
  const rows = sleeperLike ? 10 : 11;
  const seats = [];
  for (let row = 0; row < rows; row += 1) {
    const rowNum = row + 1;
    if (sleeperLike) {
      seats.push(
        { id: `A${rowNum}`, deck: row > 5 ? "upper" : "lower", fareMultiplier: layoutKind === "sleeper" ? 1.18 : 1.08 },
        { id: `W${rowNum}`, deck: row > 5 ? "upper" : "lower", isWalkway: true },
        { id: `B${rowNum}`, deck: row > 5 ? "upper" : "lower", fareMultiplier: 1 },
        { id: `C${rowNum}`, deck: row > 5 ? "upper" : "lower", fareMultiplier: 1 }
      );
    } else {
      ["A", "B", "C", "D"].forEach((col) => {
        seats.push({
          id: `${col}${rowNum}`,
          deck: "lower",
          fareMultiplier: semiSeater && ["A", "D"].includes(col) ? 1.08 : 1
        });
      });
    }
  }
  
  return {
    rows,
    cols: 4,
    type: type === "train" ? "sleeper" : layoutKind,
    unavailable: ["A3", "B4", "C7"],
    seats
  };
};
