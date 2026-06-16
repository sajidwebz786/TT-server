import express from "express";
import { City, Destination, Hotel, TourPackage } from "../models/index.js";

export const catalogRouter = express.Router();

catalogRouter.get("/destinations", async (_req, res) => {
  res.json(await Destination.findAll({ order: [["name", "ASC"]] }));
});

catalogRouter.get("/cities", async (req, res) => {
  const where = req.query.international === "true" ? { isInternational: true } : { isInternational: false };
  res.json(await City.findAll({ where, order: [["name", "ASC"]] }));
});

catalogRouter.get("/packages", async (req, res) => {
  const where = req.query.category ? { category: req.query.category } : {};
  res.json(await TourPackage.findAll({ where, include: Destination, order: [["rating", "DESC"]] }));
});

catalogRouter.get("/hotels", async (req, res) => {
  const where = req.query.city ? { city: req.query.city } : {};
  res.json(await Hotel.findAll({ where, include: Destination, order: [["rating", "DESC"]] }));
});
