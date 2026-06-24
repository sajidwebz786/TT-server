import express from "express";
import { TransportRoute } from "../models/index.js";
import { bdsdClient, getBdsdBusBoardingPoints, getBdsdBusSeatLayout, searchBdsdBuses, searchBdsdFlights } from "../services/bdsdClient.js";

export const transportRouter = express.Router();

transportRouter.get("/providers/status", (_req, res) => {
  res.json({ bdsd: bdsdClient.configured() });
});

transportRouter.get("/:type/search", async (req, res) => {
  const { type } = req.params;
  if (!["bus", "flight", "train"].includes(type)) return res.status(400).json({ message: "Invalid transport type" });

  if (type === "bus" && req.query.from && req.query.to) {
    const externalRoutes = await tryExternalSearch(() => searchBdsdBuses({ from: req.query.from, to: req.query.to, date: req.query.date }));
    return res.json(externalRoutes.length ? await upsertExternalRoutes(externalRoutes) : []);
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
  res.status(404).json({ message: "Live BDSD seat layout is not available for this route" });
});

transportRouter.get("/:type/:id/points", async (req, res) => {
  const route = await TransportRoute.findOne({ where: { id: req.params.id, type: req.params.type } });
  if (!route) return res.status(404).json({ message: "Route not found" });
  if (route.externalProvider === "bdsd" && req.params.type === "bus") {
    const points = await tryExternalDetail(() => getBdsdBusBoardingPoints(route));
    if (points) return res.json(points);
  }
  res.status(404).json({ message: "Live BDSD boarding points are not available for this route" });
});

const upsertExternalRoutes = async (routes) => {
  const records = await Promise.all(routes.map(async (route) => {
    const [record, created] = await TransportRoute.findOrCreate({
      where: { routeCode: route.routeCode },
      defaults: route
    });
    return created ? record : record.update(route);
  }));
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
