import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { Op } from "sequelize";
import { sequelize } from "../config/database.js";
import { City } from "../models/index.js";

dotenv.config();

const defaultInput = "C:\\Users\\shahs\\.codex\\attachments\\802006f4-539e-4403-8008-ef655832f052\\pasted-text.txt";
const inputPath = process.argv[2] || process.env.BDSD_CITY_FILE || defaultInput;

function parseRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^city_id\s+city_name$/i.test(line.replace(/\t+/g, " ")))
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        externalBusCityId: match[1],
        name: match[2].replace(/^"+|"+$/g, "").trim()
      };
    })
    .filter((row) => row?.externalBusCityId && row.name);
}

function mergeModes(existingModes = []) {
  return [...new Set([...existingModes, "bus"])];
}

function cityData(row, existing) {
  const data = {
    name: row.name,
    country: "India",
    externalProvider: "bdsd",
    externalBusCityId: row.externalBusCityId,
    hasLiveBusSearch: true,
    transportModes: mergeModes(existing?.transportModes)
  };
  return data;
}

async function main() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  const resolved = path.resolve(inputPath);
  const text = await fs.readFile(resolved, "utf8");
  const rows = parseRows(text);
  const uniqueRows = [...new Map(rows.map((row) => [row.externalBusCityId, row])).values()];

  const ids = uniqueRows.map((row) => row.externalBusCityId);
  const names = uniqueRows.map((row) => row.name);
  const existingCities = await City.findAll({
    where: {
      [Op.or]: [
        { externalProvider: "bdsd", externalBusCityId: { [Op.in]: ids } },
        { name: { [Op.in]: names } }
      ]
    }
  });
  const byProviderId = new Map(existingCities.filter((city) => city.externalBusCityId).map((city) => [city.externalBusCityId, city]));
  const byName = new Map(existingCities.map((city) => [city.name, city]));

  let created = 0;
  let updated = 0;
  const creates = [];
  const updates = [];
  for (const row of uniqueRows) {
    const existing = byProviderId.get(row.externalBusCityId) || byName.get(row.name);
    if (existing) {
      updates.push([existing, cityData(row, existing)]);
      updated += 1;
    } else {
      creates.push(cityData(row));
      created += 1;
    }
  }
  if (creates.length) await City.bulkCreate(creates);
  for (let index = 0; index < updates.length; index += 500) {
    await Promise.all(updates.slice(index, index + 500).map(([city, data]) => city.update(data)));
  }

  console.log(`Imported ${uniqueRows.length} BDSD cities from ${resolved}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
