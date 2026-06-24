import express from "express";
import { Destination, Hotel, TourPackage } from "../models/index.js";
import { bdsdClient, searchBdsdHotels } from "../services/bdsdClient.js";

export const catalogRouter = express.Router();

catalogRouter.get("/destinations", async (_req, res) => {
  res.json(await Destination.findAll({ order: [["name", "ASC"]] }));
});

catalogRouter.get("/cities", async (req, res) => {
  res.json(filterProviderCities(req.query));
});

catalogRouter.get("/cities/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = Number(req.query.limit || 25);
  res.json(filterProviderCities(req.query).filter((city) => !query || city.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit));
});

catalogRouter.get("/packages", async (req, res) => {
  const where = req.query.category ? { category: req.query.category } : {};
  res.json(await TourPackage.findAll({ where, include: Destination, order: [["rating", "DESC"]] }));
});

catalogRouter.get("/hotels", async (req, res) => {
  if (req.query.city) {
    try {
      const externalHotels = await searchBdsdHotels({
        city: req.query.city,
        checkInDate: req.query.checkInDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        checkOutDate: req.query.checkOutDate || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        noOfNights: req.query.noOfNights || 1,
        rooms: req.query.rooms || 1,
        adults: req.query.adults || 2
      });
      if (externalHotels.length) {
        return res.json(await upsertExternalHotels(externalHotels));
      }
    } catch (error) {
      console.warn(`BDSD hotel search unavailable: ${error.message}`);
      return res.json([]);
    }
  } else {
    try {
      const liveHotels = (await Promise.all(["Goa", "Mumbai", "Delhi"].map((city) => searchBdsdHotels({
        city,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        checkOutDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        noOfNights: 1,
        rooms: 1,
        adults: 2,
        resultCount: 10
      }).catch(() => [])))).flat();
      if (liveHotels.length) return res.json(await upsertExternalHotels(liveHotels));
    } catch (error) {
      console.warn(`BDSD hotel catalog unavailable: ${error.message}`);
      return res.json([]);
    }
  }
  res.json([]);
});

const upsertExternalHotels = async (hotels) => {
  const records = await Promise.all(hotels.map(async (hotel) => {
    const [record, created] = await Hotel.findOrCreate({
      where: { externalProvider: "bdsd", externalHotelCode: hotel.externalHotelCode },
      defaults: hotel
    });
    return created ? record : record.update(hotel);
  }));
  return records.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
};

const filterProviderCities = (query) => {
  const mode = query.mode || query.transportMode || null;
  return bdsdClient.providerCities().filter((city) => {
    if (query.international === "true" && !city.isInternational) return false;
    if (query.international !== "true" && city.isInternational) return false;
    if (mode && !city.transportModes.includes(mode)) return false;
    return true;
  });
};
