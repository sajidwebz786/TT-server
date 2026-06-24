import express from "express";
import { Op } from "sequelize";
import { City, Destination, Hotel, TourPackage } from "../models/index.js";
import { bdsdClient, searchBdsdHotels } from "../services/bdsdClient.js";

export const catalogRouter = express.Router();

catalogRouter.get("/destinations", async (_req, res) => {
  res.json(await Destination.findAll({ order: [["name", "ASC"]] }));
});

catalogRouter.get("/cities", async (req, res) => {
  const where = req.query.international === "true" ? { isInternational: true } : { isInternational: false };
  res.json(enrichCities(await City.findAll({ where, order: [["name", "ASC"]] })));
});

catalogRouter.get("/cities/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const where = {
    ...(req.query.international === "true" ? { isInternational: true } : { isInternational: false }),
    ...(query ? { name: { [Op.iLike]: `%${query}%` } } : {})
  };
  res.json(enrichCities(await City.findAll({ where, order: [["name", "ASC"]], limit: Number(req.query.limit || 25) })));
});

catalogRouter.get("/packages", async (req, res) => {
  const where = req.query.category ? { category: req.query.category } : {};
  res.json(await TourPackage.findAll({ where, include: Destination, order: [["rating", "DESC"]] }));
});

catalogRouter.get("/hotels", async (req, res) => {
  const where = req.query.city ? { city: req.query.city } : {};
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
        await upsertExternalHotels(externalHotels);
        return res.json(await Hotel.findAll({ where, include: Destination, order: [["rating", "DESC"]] }));
      }
    } catch (error) {
      console.warn(`BDSD hotel search unavailable: ${error.message}`);
    }
  }
  res.json(await Hotel.findAll({ where, include: Destination, order: [["rating", "DESC"]] }));
});

const upsertExternalHotels = async (hotels) => {
  await Promise.all(hotels.map(async (hotel) => {
    const [record, created] = await Hotel.findOrCreate({
      where: { externalProvider: "bdsd", externalHotelCode: hotel.externalHotelCode },
      defaults: hotel
    });
    if (!created) await record.update(hotel);
  }));
};

const enrichCities = (cities) => {
  const busCityIds = bdsdClient.busCityIds();
  return cities.map((city) => {
    const json = city.toJSON();
    const externalBusCityId = json.externalBusCityId || busCityIds[json.name] || null;
    return {
      ...json,
      externalProvider: externalBusCityId ? "bdsd" : json.externalProvider,
      externalBusCityId,
      hasLiveBusSearch: Boolean(externalBusCityId)
    };
  });
};
