import test from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, isInsideGeofence } from "../src/domain/geo.js";

const building = { latitude: 41.2995, longitude: 69.2401, radius_meters: 30 };

test("geofence accepts points inside the configured 30 m radius", () => {
  assert.equal(
    isInsideGeofence({ latitude: 41.2996, longitude: 69.2401 }, building),
    true,
  );
});

test("geofence rejects points beyond the configured radius", () => {
  const point = { latitude: 41.3005, longitude: 69.2401 };
  assert.ok(distanceMeters(point, building) > 30);
  assert.equal(isInsideGeofence(point, building), false);
});

test("the boundary itself is included", () => {
  const point = { latitude: 41.2995 + 30 / 111_195, longitude: 69.2401 };
  assert.equal(isInsideGeofence(point, building), true);
});
