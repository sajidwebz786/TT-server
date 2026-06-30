import { City } from "../models/index.js";

const baseUrl = () => (process.env.BDSD_API_URL || "").replace(/\/+$/, "");
const enabled = () => process.env.BDSD_ENABLED === "true" && Boolean(baseUrl());
const userIp = () => process.env.BDSD_USER_IP || "103.209.223.52";

const defaultBusCityIds = {
  Mumbai: "8463",
  Goa: "9573"
};

const defaultAirportCodes = {
  Delhi: "DEL",
  Mumbai: "BOM",
  Bengaluru: "BLR",
  Bangalore: "BLR",
  Hyderabad: "HYD",
  Chennai: "MAA",
  Kolkata: "CCU",
  Goa: "GOI",
  Pune: "PNQ",
  Kochi: "COK",
  Ahmedabad: "AMD",
  Jaipur: "JAI",
  Visakhapatnam: "VTZ",
  Vijayawada: "VGA",
  Tirupati: "TIR"
};

const defaultHotelCityIds = {
  Delhi: 119805,
  Mumbai: 100935,
  Goa: 113469
};

function configured() {
  return {
    enabled: enabled(),
    baseUrl: baseUrl(),
    usernameConfigured: Boolean(process.env.BDSD_USERNAME),
    busSearchPath: process.env.BDSD_BUS_SEARCH_PATH || "/busservice/rest/search",
    flightSearchPath: process.env.BDSD_FLIGHT_SEARCH_PATH || "/airservice/rest/search",
    hotelSearchPath: process.env.BDSD_HOTEL_SEARCH_PATH || "/hotelservice/rest/search",
    ready: enabled() && Boolean(process.env.BDSD_USERNAME && process.env.BDSD_PASSWORD)
  };
}

function parseMap(envName, fallback) {
  try {
    return { ...fallback, ...(process.env[envName] ? JSON.parse(process.env[envName]) : {}) };
  } catch {
    return fallback;
  }
}

function bdsdBusCityIds() {
  return parseMap("BDSD_BUS_CITY_IDS", defaultBusCityIds);
}

function bdsdAirportCodes() {
  return parseMap("BDSD_AIRPORT_CODES", defaultAirportCodes);
}

function bdsdHotelCityIds() {
  return parseMap("BDSD_HOTEL_CITY_IDS", defaultHotelCityIds);
}

function envProviderCities() {
  const byName = new Map();
  const add = (name, fields) => {
    const current = byName.get(name) || {
      id: name,
      name,
      state: "",
      country: "India",
      isInternational: false,
      transportModes: [],
      externalProvider: "bdsd",
      hasLiveBusSearch: false,
      hasLiveFlightSearch: false,
      hasLiveHotelSearch: false
    };
    const transportModes = new Set(current.transportModes);
    for (const mode of fields.transportModes || []) transportModes.add(mode);
    byName.set(name, { ...current, ...fields, transportModes: [...transportModes] });
  };

  for (const [name, externalBusCityId] of Object.entries(bdsdBusCityIds())) {
    add(name, { externalBusCityId: String(externalBusCityId), hasLiveBusSearch: true, transportModes: ["bus"] });
  }
  for (const [name, airportCode] of Object.entries(bdsdAirportCodes())) {
    add(name, { airportCode: String(airportCode), hasLiveFlightSearch: true, transportModes: ["flight"] });
  }
  for (const [name, externalHotelCityId] of Object.entries(bdsdHotelCityIds())) {
    add(name, { externalHotelCityId: String(externalHotelCityId), hasLiveHotelSearch: true, transportModes: ["hotel"] });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function providerCities() {
  const cities = await City.findAll({ order: [["name", "ASC"]] });
  if (!cities.length) return envProviderCities();
  return cities.map((city) => {
    const modes = new Set(city.transportModes || []);
    if (city.externalBusCityId || city.hasLiveBusSearch) modes.add("bus");
    if (city.airportCode || city.hasLiveFlightSearch) modes.add("flight");
    if (city.externalHotelCityId || city.hasLiveHotelSearch) modes.add("hotel");
    return {
      id: city.id,
      name: city.name,
      state: city.state || "",
      country: city.country || "India",
      isInternational: Boolean(city.isInternational),
      transportModes: [...modes],
      externalProvider: city.externalProvider,
      externalBusCityId: city.externalBusCityId,
      airportCode: city.airportCode,
      externalHotelCityId: city.externalHotelCityId,
      hasLiveBusSearch: Boolean(city.externalBusCityId || city.hasLiveBusSearch),
      hasLiveFlightSearch: Boolean(city.airportCode || city.hasLiveFlightSearch),
      hasLiveHotelSearch: Boolean(city.externalHotelCityId || city.hasLiveHotelSearch)
    };
  });
}

function headers() {
  return {
    "Content-Type": "application/json",
    Username: process.env.BDSD_USERNAME || "",
    Password: process.env.BDSD_PASSWORD || ""
  };
}

async function request(path, body) {
  if (!enabled()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.BDSD_TIMEOUT_MS || 20000));
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: controller.signal
  }).catch((error) => {
    if (error.name === "AbortError") throw new Error(`BDSD request timed out for ${path}`);
    throw error;
  });
  try {
    const text = await response.text();
    const data = text ? tryJson(text) : {};
    if (!response.ok || data?.Error?.ErrorCode) {
      const message = data?.Error?.ErrorMessage || data?.message || `BDSD request failed with ${response.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function firstArray(data, keys) {
  if (!data || typeof data !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length && typeof value[0] === "object") return value;
    const nested = firstArray(value, keys);
    if (nested.length) return nested;
  }
  return [];
}

function findValue(data, keys) {
  if (!data || typeof data !== "object") return undefined;
  for (const key of keys) {
    if (data[key] !== undefined) return data[key];
  }
  for (const value of Object.values(data)) {
    const found = findValue(value, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function asDate(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

function fareValue(value) {
  if (typeof value === "number" || typeof value === "string") return Number(value) || 0;
  if (Array.isArray(value)) return value.reduce((max, item) => Math.max(max, fareValue(item)), 0);
  if (!value || typeof value !== "object") return 0;
  for (const key of ["PublishedFare", "OfferedFare", "BaseFare", "TotalFare", "PublishedPrice", "OfferedPrice", "BasePrice", "MinPublishedPrice", "MinHotelPrice", "Price"]) {
    const amount = Number(value[key]);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return Math.max(fareValue(value.Fare), fareValue(value.FareList));
}

function numericValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function booleanValue(...values) {
  for (const value of values) {
    if (value === true || value === "true" || value === "True" || value === 1 || value === "1") return true;
    if (value === false || value === "false" || value === "False" || value === 0 || value === "0") return false;
  }
  return undefined;
}

function normalizeBusRoute(item, query, token) {
  const resultIndex = item.ResultIndex || item.resultIndex || item.TripId || item.ServiceId || item.id;
  const departure = item.DepartureTime || item.departureTime || item.DepTime || item.StartTime;
  const arrival = item.ArrivalTime || item.arrivalTime || item.ArrTime || item.EndTime;
  const price = fareValue(item.BusPrice || item.Fare || item.Price || item.FareDetails || item);
  const classType = item.BusType || item.busType || item.ServiceType || item.classType || "Bus";
  return {
    type: "bus",
    providerName: item.TravelName || item.OperatorName || item.operatorName || item.providerName || "BDSD Bus Operator",
    routeCode: `BDSD-BUS-${String(resultIndex || `${query.from}-${query.to}-${departure || Date.now()}`).replace(/[^A-Z0-9-]/gi, "").toUpperCase()}`,
    origin: query.from,
    destination: query.to,
    departureTime: asDate(departure, `${query.date}T08:00:00`),
    arrivalTime: asDate(arrival, `${query.date}T18:00:00`),
    price: price || 0,
    classType,
    vehicleType: item.BusType || item.VehicleType || classType,
    amenities: normalizeAmenities(item.Amenities || item.amenities),
    seatLayout: normalizeSeatLayout(item),
    baggage: null,
    rating: Number(item.Rating || item.rating || 4.4),
    cancellationPolicy: item.CancellationPolicy || item.cancelPolicy || "Operator policy applies",
    externalProvider: "bdsd",
    externalRouteId: String(resultIndex || ""),
    externalPayload: { ...item, SearchTokenId: token }
  };
}

function normalizeAmenities(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,|]/).map((item) => item.trim()).filter(Boolean);
  return ["Live tracking", "Operator updates"];
}

function normalizeSeatLayout(item) {
  const result = item.Result && typeof item.Result === "object" ? item.Result : {};
  const layoutObject = item.SeatLayout && !Array.isArray(item.SeatLayout)
    ? item.SeatLayout
    : result.SeatLayout && typeof result.SeatLayout === "object"
      ? result.SeatLayout
      : {};
  const htmlLayout = item.HTMLLayout || result.HTMLLayout || findValue(item, ["HTMLLayout"]);
  const htmlMeta = parseSeatHtmlMeta(htmlLayout);
  const typeText = `${item.SeatType || item.LayoutType || item.BusType || item.ServiceType || result.BusType || ""}`.toLowerCase();
  let type = typeText.includes("sleeper") && (typeText.includes("seat") || typeText.includes("sitting"))
    ? "mixed"
    : typeText.includes("sleeper")
      ? (typeText.includes("semi") ? "semi-sleeper" : "sleeper")
      : typeText.includes("semi")
        ? "semi-seater"
        : "seater";
  const rawSource = item.Seats || item.SeatDetails || item.SeatsDetails || item.SeatLayoutDetails || item.seats || (Array.isArray(item.SeatLayout) ? item.SeatLayout : null) || layoutObject.SeatDetails || layoutObject.Seats || layoutObject.SeatLayout || [];
  const rawSeats = Array.isArray(rawSource)
    ? flattenObjects(rawSource)
    : flattenObjects(firstArray(rawSource, ["Seats", "SeatLayout", "SeatDetails", "SeatsDetails", "SeatLayoutDetails", "data"]));
  const unavailable = [];
  const seats = rawSeats.map((seat, index) => {
    const id = String(seat.SeatName || seat.SeatNo || seat.SeatNumber || seat.id || index + 1);
    const meta = htmlMeta.get(id) || {};
    const statusText = String(seat.SeatStatus ?? seat.Status ?? "").toLowerCase();
    const available = booleanValue(seat.Available, seat.IsAvailable, seat.IsSeatAvailable, meta.htmlAvailable);
    const booked = booleanValue(seat.IsBooked, seat.Booked, seat.IsBlocked, seat.IsReserved);
    const blockedByStatus = ["false", "booked", "blocked", "sold", "unavailable"].includes(statusText);
    if (available === false || booked || blockedByStatus) unavailable.push(id);
    const seatType = `${seat.SeatType || seat.Type || seat.BerthType || ""}`.toLowerCase();
    const width = numericValue(seat.Width, seat.SeatWidth, seat.w, 1) || 1;
    const height = numericValue(seat.Height, seat.SeatHeight, seat.h, seatKindFrom(seatType, meta.htmlClass) === "berth" ? 2 : 1) || 1;
    const isUpper = booleanValue(seat.IsUpper, seat.Upper, seat.IsUpperDeck);
    const deckText = `${seat.Deck || seat.zIndex || seat.level || seat.DeckNo || ""}`.toLowerCase();
    const visualType = seatKindFrom(seatType || seat.rawType, meta.htmlClass);
    return {
      id,
      label: id,
      deck: isUpper || deckText.includes("upper") || deckText === "1" ? "upper" : "lower",
      row: numericValue(seat.RowNo, seat.RowNumber, seat.Row, seat.SeatRow, seat.row, seat.Y, seat.y, seat.RowIndex, seat.RowId),
      column: numericValue(seat.ColumnNo, seat.ColumnNumber, seat.Column, seat.SeatColumn, seat.column, seat.X, seat.x, seat.ColumnIndex, seat.ColNo, seat.Col),
      width,
      height,
      fare: fareValue(seat.Price || seat.Fare || seat.SeatFare || meta.htmlFare || seat),
      fareMultiplier: 1,
      isWalkway: Boolean(seat.isWalkway || seat.IsWalkway),
      isBerth: visualType === "berth",
      visualType,
      htmlClass: meta.htmlClass || "",
      ladies: Boolean(booleanValue(seat.IsLadiesSeat, seat.LadiesSeat, seat.IsLadies, seat.ForLadies) || false),
      males: Boolean(booleanValue(seat.IsMalesSeat, seat.MalesSeat, seat.ForMales) || false),
      rawType: seat.SeatType || seat.Type || seat.BerthType || ""
    };
  });
  const hasBerths = seats.some((seat) => seat.isBerth);
  const hasChairs = seats.some((seat) => !seat.isBerth);
  if (hasBerths && hasChairs) type = "mixed";
  else if (hasBerths) type = "sleeper";
  else if (hasChairs) type = "seater";
  return { type, unavailable, seats, availableSeats: Number(result.AvailableSeats || item.AvailableSeats) || undefined };
}

function normalizeBoardingPoints(data) {
  const points = firstArray(data, ["BoardingPointsDetails", "BoardingPoints", "BoardingPoint", "Boarding", "Pickups", "data"]);
  return points.map((point, index) => ({
    id: point.BoardingPointId || point.CityPointId || point.CityPointIndex || point.PointId || point.id || index + 1,
    name: point.BoardingPointName || point.CityPointName || point.Name || point.Location || point.name || `Boarding point ${index + 1}`,
    time: point.CityPointTime || point.Time || point.time || "",
    address: point.Address || point.CityPointLocation || point.address || ""
  }));
}

function normalizeDroppingPoints(data) {
  const points = firstArray(data, ["DroppingPointsDetails", "DroppingPoints", "DroppingPoint", "Dropping", "Drops", "data"]);
  return points.map((point, index) => ({
    id: point.DroppingPointId || point.CityPointId || point.CityPointIndex || point.PointId || point.id || index + 1,
    name: point.DroppingPointName || point.CityPointName || point.Name || point.Location || point.name || `Dropping point ${index + 1}`,
    time: point.CityPointTime || point.Time || point.time || "",
    address: point.Address || point.CityPointLocation || point.address || ""
  }));
}

function normalizeFlightRoute(item, query, token) {
  const segment = firstObject(item.Segments) || item.Segment || {};
  const airline = segment.Airline || item.Airline || {};
  const fare = fareValue(item.FareList || item.Fare || item.Price || item);
  const fareItem = firstObject(item.FareList) || {};
  const resultIndex = item.ResultIndex || item.resultIndex || item.id || fareItem.FareId;
  return {
    type: "flight",
    providerName: airline.AirlineName || item.AirlineName || item.providerName || "BDSD Flight",
    routeCode: `BDSD-FLT-${String(resultIndex || `${query.from}-${query.to}-${Date.now()}`).replace(/[^A-Z0-9-]/gi, "").toUpperCase()}`,
    origin: query.from,
    destination: query.to,
    departureTime: asDate(segment.Origin?.DepTime || segment.DepTime || item.DepartureTime, `${query.date}T08:00:00`),
    arrivalTime: asDate(segment.Destination?.ArrTime || segment.ArrTime || item.ArrivalTime, `${query.date}T10:00:00`),
    price: fare || 0,
    classType: item.CabinClassName || fareItem.CabinClass || "Economy",
    vehicleType: airline.FlightNumber ? `${airline.AirlineCode || ""} ${airline.FlightNumber}`.trim() : "Flight",
    amenities: ["Cabin baggage", "Web check-in"],
    seatLayout: { type: "seater", unavailable: [], seats: [] },
    baggage: item.Baggage || "As per airline rules",
    rating: 4.5,
    cancellationPolicy: "Airline policy applies",
    externalProvider: "bdsd",
    externalRouteId: String(resultIndex || ""),
    externalPayload: { ...item, SearchTokenId: token }
  };
}

function firstObject(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstObject(item);
      if (found) return found;
    }
    return null;
  }
  return typeof value === "object" ? value : null;
}

function flattenObjects(value) {
  if (!Array.isArray(value)) return value && typeof value === "object" ? [value] : [];
  return value.flatMap((item) => Array.isArray(item) ? flattenObjects(item) : (item && typeof item === "object" ? [item] : []));
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3] ?? "") : "";
}

function parseSeatHtmlMeta(html) {
  if (typeof html !== "string" || !html.trim()) return new Map();
  const meta = new Map();
  const divRegex = /<div\b[^>]*>/gi;
  let match;
  while ((match = divRegex.exec(html))) {
    const tag = match[0];
    const className = htmlAttribute(tag, "class");
    if (!/\b(?:b?hseat|b?nseat|seat)\b/i.test(className)) continue;
    const onclick = htmlAttribute(tag, "onclick");
    const seatMatch = onclick.match(/AddRemoveSeat\s*\(\s*this\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/i);
    if (!seatMatch) continue;
    meta.set(String(seatMatch[1]), {
      htmlClass: className,
      htmlFare: Number(seatMatch[2]) || undefined,
      htmlAvailable: !/\bb/i.test(className)
    });
  }
  return meta;
}

function seatKindFrom(rawType, htmlClass) {
  const type = `${rawType || ""}`.toLowerCase();
  const className = `${htmlClass || ""}`.toLowerCase();
  const sleeperText = type.includes("sleeper") || type.includes("berth") || className.includes("sleeper") || className.includes("berth");
  if (sleeperText) return "berth";
  if (/\bb?hseat\b/.test(className) || type.includes("horizontal") || type === "2") return "horizontal-seat";
  return "seat";
}

function normalizeHotel(item, query, token) {
  const price = fareValue(item.Price || item.MinHotelPrice || item);
  return {
    name: item.HotelName || item.name || "BDSD Hotel",
    city: query.city || "India",
    starRating: Number(item.StarRating || item.HotelRating || 4),
    pricePerNight: price || 0,
    imageUrl: item.HotelPicture || item.ImageUrl || item.Images?.[0] || "",
    amenities: normalizeAmenities(item.HotelFacilities || item.Amenities),
    roomTypes: [],
    rating: Number(item.StarRating || item.HotelRating || 4.4),
    externalProvider: "bdsd",
    externalHotelCode: String(item.HotelCode || item.ResultIndex || ""),
    externalPayload: { ...item, SearchTokenId: token }
  };
}

export async function searchBdsdBuses(query) {
  const [origin, destination] = await Promise.all([
    findBusCityId(query.from),
    findBusCityId(query.to)
  ]);
  const originId = origin?.externalBusCityId;
  const destinationId = destination?.externalBusCityId;
  if (!enabled() || !originId || !destinationId) return [];
  const data = await request(process.env.BDSD_BUS_SEARCH_PATH || "/busservice/rest/search", {
    UserIp: userIp(),
    DateOfJourney: query.date,
    OriginId: String(originId),
    DestinationId: String(destinationId)
  });
  const token = findValue(data, ["SearchTokenId", "TraceId", "TokenId"]);
  return firstArray(data, ["BusResults", "BusResult", "Results", "Result", "data"]).map((item) => normalizeBusRoute(item, query, token));
}

async function findBusCityId(name) {
  if (!name) return null;
  const city = await City.findOne({ where: { name } });
  if (city?.externalBusCityId) return city;
  const fallbackId = bdsdBusCityIds()[name];
  return fallbackId ? { externalBusCityId: String(fallbackId) } : null;
}

export async function searchBdsdFlights(query) {
  const airportCodes = bdsdAirportCodes();
  const origin = airportCodes[query.from];
  const destination = airportCodes[query.to];
  if (!enabled() || !origin || !destination) return [];
  const data = await request(process.env.BDSD_FLIGHT_SEARCH_PATH || "/airservice/rest/search", {
    UserIp: process.env.BDSD_FLIGHT_USER_IP || userIp(),
    Adult: Number(query.travellers || 1),
    Child: 0,
    Infant: 0,
    DirectFlight: false,
    JourneyType: query.tripType === "round-trip" ? 2 : 1,
    PreferredCarriers: [],
    CabinClass: 1,
    SeriesFare: null,
    AirSegments: [{ Origin: origin, Destination: destination, PreferredTime: `${query.date}T00:00:00` }]
  });
  const token = findValue(data, ["SearchTokenId", "TraceId", "TokenId"]);
  return flattenObjects(firstArray(data, ["Results", "Result", "FlightResults", "data"])).map((item) => normalizeFlightRoute(item, query, token));
}

export async function searchBdsdHotels(query) {
  const hotelCityIds = bdsdHotelCityIds();
  const destinationCityId = hotelCityIds[query.city];
  if (!enabled() || !destinationCityId) return [];
  const data = await request(process.env.BDSD_HOTEL_SEARCH_PATH || "/hotelservice/rest/search", {
    CheckInDate: query.checkInDate,
    CheckOutDate: query.checkOutDate,
    NoOfNights: Number(query.noOfNights || 1),
    CountryCode: "IN",
    DestinationCityId: Number(destinationCityId),
    ResultCount: Number(query.resultCount || 20),
    GuestNationality: "IN",
    NoOfRooms: Number(query.rooms || 1),
    RoomGuests: [{ Adult: Number(query.adults || 2), Child: 0, ChildAge: [] }],
    MaxRating: Number(query.maxRating || 5),
    MinRating: Number(query.minRating || 3),
    UserIp: process.env.BDSD_HOTEL_USER_IP || userIp()
  });
  const token = findValue(data, ["SearchTokenId", "TraceId", "TokenId"]);
  return firstArray(data, ["HotelResults", "Hotels", "Results", "data"]).map((item) => normalizeHotel(item, query, token));
}

export async function getBdsdBusSeatLayout(route) {
  const token = route.externalPayload?.SearchTokenId;
  const resultIndex = route.externalPayload?.ResultIndex || route.externalRouteId;
  if (!enabled() || !token || !resultIndex) return null;
  const data = await request(process.env.BDSD_BUS_SEAT_LAYOUT_PATH || "/busservice/rest/seatlayout", {
    UserIp: userIp(),
    SearchTokenId: token,
    ResultIndex: resultIndex
  });
  return normalizeSeatLayout({ ...data, BusType: route.classType });
}

export async function getBdsdBusBoardingPoints(route) {
  const token = route.externalPayload?.SearchTokenId;
  const resultIndex = route.externalPayload?.ResultIndex || route.externalRouteId;
  if (!enabled() || !token || !resultIndex) return null;
  const body = { UserIp: userIp(), SearchTokenId: token, ResultIndex: resultIndex };
  let boarding;
  try {
    boarding = await request(process.env.BDSD_BUS_BOARDING_PATH || "/busservice/rest/boardingpoint", body);
  } catch (error) {
    if (!route.externalPayload?.BoardingPointsDetails?.length && !route.externalPayload?.DroppingPointsDetails?.length) throw error;
    boarding = route.externalPayload;
  }
  return {
    boardingPoints: normalizeBoardingPoints(boarding),
    droppingPoints: normalizeDroppingPoints(boarding)
  };
}

export async function bookBdsdBus(route, bookingDraft) {
  const token = route.externalPayload?.SearchTokenId;
  const resultIndex = route.externalPayload?.ResultIndex || route.externalRouteId;
  if (!enabled() || !token || !resultIndex || process.env.BDSD_BUS_BOOKING_ENABLED !== "true") return null;
  const lead = bookingDraft.passengers?.[0] || {};
  const [firstName, ...lastParts] = String(lead.name || "Orbita Traveller").split(" ");
  const passenger = {
    LeadPassenger: true,
    Title: lead.gender === "Female" ? "Ms" : "Mr",
    FirstName: firstName || "Orbita",
    LastName: lastParts.join(" ") || "Traveller",
    Email: bookingDraft.contact?.email || "",
    Phoneno: bookingDraft.contact?.phone || "",
    Gender: lead.gender === "Female" ? "2" : "1",
    IdType: null,
    IdNumber: null,
    Address: bookingDraft.contact?.address || "",
    Age: String(lead.age || ""),
    SeatName: bookingDraft.selectedSeats?.[0] || lead.seat || ""
  };
  const body = {
    UserIp: userIp(),
    SearchTokenId: token,
    ResultIndex: resultIndex,
    BoardingPointId: bookingDraft.metadata?.boardingPointId || 1,
    DroppingPointId: bookingDraft.metadata?.dropPointId || 1,
    Passenger: [passenger]
  };
  if (process.env.BDSD_BUS_BLOCK_BEFORE_BOOK === "true") {
    await request(process.env.BDSD_BUS_BLOCK_SEAT_PATH || "/busservice/rest/blockseat", body);
  }
  return request(process.env.BDSD_BUS_BOOK_PATH || "/busservice/rest/book", body);
}

export async function cancelBdsdBusBooking(route, booking, reason = "Cancel Bus Ticket") {
  const token = route?.externalPayload?.SearchTokenId || booking.metadata?.bdsdSearchTokenId || booking.metadata?.SearchTokenId;
  const providerBooking = booking.metadata?.bdsdBooking || {};
  const bookingId = findValue(providerBooking, ["BookingId", "BusBookingId", "TicketId", "TicketNo", "PNR"]);
  const seatId = booking.selectedSeats?.[0] || booking.passengers?.[0]?.seat || findValue(providerBooking, ["SeatId", "SeatName"]);
  if (!enabled() || !token || !bookingId || !seatId) {
    return {
      skipped: true,
      reason: !enabled() ? "BDSD disabled" : "BDSD booking id, token or seat id missing"
    };
  }
  return request(process.env.BDSD_BUS_CANCEL_REQUEST_PATH || "/busservice/rest/cancelrequest", {
    UserIp: userIp(),
    SearchTokenId: token,
    BookingId: bookingId,
    SeatId: String(seatId),
    Remarks: reason || "Cancel Bus Ticket"
  });
}

export const bdsdClient = {
  enabled,
  configured,
  busCityIds: bdsdBusCityIds,
  airportCodes: bdsdAirportCodes,
  hotelCityIds: bdsdHotelCityIds,
  providerCities,
  searchBdsdBuses,
  searchBdsdFlights,
  searchBdsdHotels,
  getBdsdBusSeatLayout,
  getBdsdBusBoardingPoints,
  bookBdsdBus,
  cancelBdsdBusBooking
};
