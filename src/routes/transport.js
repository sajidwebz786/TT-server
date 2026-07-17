import express from "express";
import { TransportRoute } from "../models/index.js";
import { bdsdClient, getBdsdBusBoardingPoints, getBdsdBusSeatLayout, searchBdsdBuses, searchBdsdFlights } from "../services/bdsdClient.js";

export const transportRouter = express.Router();
const SEARCH_CACHE_TTL_MS = Number(process.env.TRANSPORT_SEARCH_CACHE_TTL_MS || 180000);
const searchCache = new Map();
const pendingSearches = new Map();

const cacheKeyFor = (type, query) => [
  type,
  String(query.from || "").trim().toLowerCase(),
  String(query.to || "").trim().toLowerCase(),
  String(query.date || "").trim(),
  String(query.tripType || "").trim().toLowerCase()
].join("|");

const readSearchCache = (key) => {
  const item = searchCache.get(key);
  if (!item || item.expiresAt < Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return item.routes;
};

const writeSearchCache = (key, routes) => {
  searchCache.set(key, { routes, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  if (searchCache.size > 120) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
};

transportRouter.get("/providers/status", (_req, res) => {
  res.json({ bdsd: bdsdClient.configured() });
});

transportRouter.get("/:type/search", async (req, res) => {
  const { type } = req.params;
  if (!["bus", "flight", "train"].includes(type)) return res.status(400).json({ message: "Invalid transport type" });

  if (type === "bus" && req.query.from && req.query.to) {
    const key = cacheKeyFor(type, req.query);
    const cachedRoutes = readSearchCache(key);
    if (cachedRoutes) return res.json(cachedRoutes);
    let pending = pendingSearches.get(key);
    if (!pending) {
      pending = (async () => {
        const externalRoutes = await tryExternalSearch(() => searchBdsdBuses({ from: req.query.from, to: req.query.to, date: req.query.date }));
        const routes = externalRoutes.length ? await upsertExternalRoutes(externalRoutes) : [];
        writeSearchCache(key, routes);
        return routes;
      })();
      pendingSearches.set(key, pending);
    }
    try {
      const routes = await pending;
      return res.json(routes);
    } finally {
      if (pendingSearches.get(key) === pending) pendingSearches.delete(key);
    }
  }
  if (type === "flight" && req.query.from && req.query.to) {
    const externalRoutes = await tryExternalSearch(() => searchBdsdFlights({ from: req.query.from, to: req.query.to, date: req.query.date, tripType: req.query.tripType, travellers: req.query.travellers }));
    return res.json(externalRoutes.length ? await upsertExternalRoutes(externalRoutes) : []);
  }
  if (type === "train") {
    return res.json([]);
  }
  res.json([]);
});

transportRouter.get("/:type/:id/seats", async (req, res) => {
  const route = await TransportRoute.findOne({ where: { id: req.params.id, type: req.params.type } });
  if (!route) return res.status(404).json({ message: "Route not found" });
  if (route.externalProvider === "bdsd" && req.params.type === "bus") {
    const layout = await tryExternalDetail(() => getBdsdBusSeatLayout(route));
    if (layout) {
      await route.update({ seatLayout: layout });
      return res.json(layout);
    }
  }
  const storedLayout = route.seatLayout;
  if (storedLayout?.seats?.length) return res.json(storedLayout);

  const description = `${route.classType || ""} ${route.vehicleType || ""}`.toLowerCase();
  const layoutKind = description.includes("sleeper")
    ? (description.includes("semi") ? "semi-sleeper" : "sleeper")
    : (description.includes("semi") ? "semi-seater" : "seater");
  const fallbackLayout = makeSeatLayout(req.params.type, layoutKind);
  await route.update({ seatLayout: fallbackLayout });
  return res.json(fallbackLayout);
});

transportRouter.get("/:type/:id/points", async (req, res) => {
  const route = await TransportRoute.findOne({ where: { id: req.params.id, type: req.params.type } });
  if (!route) return res.status(404).json({ message: "Route not found" });
  if (route.externalProvider === "bdsd" && req.params.type === "bus") {
    const points = await tryExternalDetail(() => getBdsdBusBoardingPoints(route));
    if (points?.boardingPoints?.length && points?.droppingPoints?.length) return res.json(points);
  }
  return res.json(makeRoutePoints(route));
});

const upsertExternalRoutes = async (routes) => {
  const routeCodes = routes.map((route) => route.routeCode);
  const existingRecords = await TransportRoute.findAll({ where: { routeCode: routeCodes } });
  const existingByCode = new Map(existingRecords.map((record) => [record.routeCode, record]));
  const newRoutes = routes.filter((route) => !existingByCode.has(route.routeCode));
  const createdRecords = newRoutes.length ? await TransportRoute.bulkCreate(newRoutes, { returning: true }) : [];
  const updatedRecords = await Promise.all(routes
    .filter((route) => existingByCode.has(route.routeCode))
    .map((route) => existingByCode.get(route.routeCode).update(route)));
  const records = [...createdRecords, ...updatedRecords];
  return records.sort((a, b) => Number(a.price) - Number(b.price));
};

const tryExternalSearch = async (searchFn) => {
  try {
    return await searchFn();
  } catch (error) {
    console.warn(`BDSD search unavailable: ${error.message}`);
    return [];
  }
};

const tryExternalDetail = async (detailFn) => {
  try {
    return await detailFn();
  } catch (error) {
    console.warn(`BDSD detail unavailable: ${error.message}`);
    return null;
  }
};

const pointTime = (value, offsetMinutes = 0) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + offsetMinutes);
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
};

const makeRoutePoints = (route) => ({
  boardingPoints: [
    { id: `fallback-board-${route.id}-1`, name: `${route.origin} Central Bus Stand`, time: pointTime(route.departureTime, -30), address: `Central bus stand, ${route.origin}` },
    { id: `fallback-board-${route.id}-2`, name: `${route.origin} Railway Station`, time: pointTime(route.departureTime, -15), address: `Railway station pickup, ${route.origin}` },
    { id: `fallback-board-${route.id}-3`, name: `${route.origin} Highway Junction`, time: pointTime(route.departureTime, -5), address: `Highway junction, ${route.origin}` }
  ],
  droppingPoints: [
    { id: `fallback-drop-${route.id}-1`, name: `${route.destination} Highway Junction`, time: pointTime(route.arrivalTime, -15), address: `Highway junction, ${route.destination}` },
    { id: `fallback-drop-${route.id}-2`, name: `${route.destination} Main Market`, time: pointTime(route.arrivalTime, -5), address: `Main market, ${route.destination}` },
    { id: `fallback-drop-${route.id}-3`, name: `${route.destination} Central Bus Terminal`, time: pointTime(route.arrivalTime), address: `Central bus terminal, ${route.destination}` }
  ]
});

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
