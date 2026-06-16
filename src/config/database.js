import dotenv from "dotenv";
import { Sequelize } from "sequelize";

dotenv.config();

const useSSL = process.env.DB_HOST?.includes("render.com") || process.env.DB_SSL === "true";

export const sequelize = new Sequelize(
  process.env.DB_NAME || "traveltimesdb",
  process.env.DB_USER || "postgres",
  process.env.DB_PASSWORD || "niavoit",
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    dialect: "postgres",
    logging: false,
    ...(useSSL ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {})
  }
);
