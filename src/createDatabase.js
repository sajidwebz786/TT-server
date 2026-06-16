import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Client } = pg;
const dbName = process.env.DB_NAME || "traveltimesdb";

const client = new Client({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "niavoit",
  database: "postgres"
});

try {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) {
    await client.query(`CREATE DATABASE ${dbName}`);
    console.log(`Created database ${dbName}`);
  } else {
    console.log(`Database ${dbName} already exists`);
  }
} finally {
  await client.end();
}
