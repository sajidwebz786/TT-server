import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { authRouter } from "./routes/auth.js";
import { User } from "./models/index.js";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const originalFindOrCreate = User.findOrCreate;

process.env.JWT_SECRET = "oauth-smoke-secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
process.env.GOOGLE_CALLBACK_URL = "https://api.example.com/api/auth/google/callback";
process.env.FRONTEND_URL = "https://traveltimes-web.onrender.com,https://www.orbita.co.in";

const app = express();
app.use(express.json());
app.use("/api/auth", authRouter);

try {
  const googleStart = await request(app)
    .get("/api/auth/google")
    .query({ returnTo: "https://www.orbita.co.in" })
    .expect(302);
  const googleUrl = new URL(googleStart.headers.location);

  assert.equal(googleUrl.origin, "https://accounts.google.com");
  assert.equal(googleUrl.pathname, "/o/oauth2/v2/auth");
  assert.equal(googleUrl.searchParams.get("client_id"), process.env.GOOGLE_CLIENT_ID);
  assert.equal(googleUrl.searchParams.get("redirect_uri"), process.env.GOOGLE_CALLBACK_URL);
  assert.equal(googleUrl.searchParams.get("response_type"), "code");
  assert.match(googleUrl.searchParams.get("scope"), /openid/);

  const state = googleUrl.searchParams.get("state");
  const decodedState = jwt.verify(state, process.env.JWT_SECRET);
  assert.equal(decodedState.provider, "google");
  assert.equal(decodedState.returnTo, "https://www.orbita.co.in");

  const untrustedStart = await request(app)
    .get("/api/auth/google")
    .query({ returnTo: "http://localhost:5173" })
    .expect(302);
  const untrustedState = new URL(untrustedStart.headers.location).searchParams.get("state");
  assert.equal(jwt.verify(untrustedState, process.env.JWT_SECRET).returnTo, "https://traveltimes-web.onrender.com");

  const invalidState = await request(app)
    .get("/api/auth/google/callback")
    .query({ code: "code-123", state: "invalid-state" })
    .expect(302);

  assert.match(
    invalidState.headers.location,
    /^https:\/\/traveltimes-web\.onrender\.com\/auth\/google\/callback#error=/
  );

  const fakeUser = {
    id: 42,
    name: "Google User",
    email: "google.user@example.com",
    phone: null,
    role: "customer",
    authProvider: "google",
    providerId: "google-sub-123",
    rewardPoints: 0
  };

  User.findOrCreate = async ({ where, defaults }) => {
    assert.deepEqual(where, { email: "google.user@example.com" });
    assert.equal(defaults.authProvider, "google");
    return [fakeUser, true];
  };

  global.fetch = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(options.method, "POST");
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("client_id"), process.env.GOOGLE_CLIENT_ID);
      assert.equal(body.get("client_secret"), process.env.GOOGLE_CLIENT_SECRET);
      assert.equal(body.get("redirect_uri"), process.env.GOOGLE_CALLBACK_URL);
      assert.equal(body.get("grant_type"), "authorization_code");
      return Response.json({ access_token: "google-access-token" });
    }

    if (url === "https://www.googleapis.com/oauth2/v3/userinfo") {
      assert.equal(options.headers.Authorization, "Bearer google-access-token");
      return Response.json({
        sub: "google-sub-123",
        name: "Google User",
        email: "google.user@example.com",
        email_verified: true
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const callback = await request(app)
    .get("/api/auth/google/callback")
    .query({ code: "code-123", state })
    .expect(302);

  const callbackUrl = new URL(callback.headers.location);
  assert.equal(callbackUrl.origin, "https://www.orbita.co.in");
  assert.equal(callbackUrl.pathname, "/auth/google/callback");
  assert.ok(callbackUrl.hash.startsWith("#token="));

  const token = new URLSearchParams(callbackUrl.hash.slice(1)).get("token");
  assert.equal(jwt.verify(token, process.env.JWT_SECRET).id, fakeUser.id);
  assert.equal(jwt.verify(token, process.env.JWT_SECRET).role, fakeUser.role);

  console.log("OAuth smoke test passed");
} finally {
  User.findOrCreate = originalFindOrCreate;
  global.fetch = originalFetch;
  process.env = originalEnv;
}
