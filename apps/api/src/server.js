import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool, inTransaction } from "./db.js";
import {
  calculateWorkedTime,
  checkoutRequiresReason,
  getPaidStart,
  isCheckInWindowOpen,
  NORMAL_PAID_DAY_MS,
  shortfallFromNormalDay,
} from "./domain/attendance-policy.js";
import { isInsideGeofence } from "./domain/geo.js";
import { localDateAt, localTimeToUtc } from "./domain/time.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const jwtSecret = process.env.JWT_SECRET;

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  return next();
});
app.use(express.json());

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const buildingInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(1).max(1000).default(30),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .refine(validTimeZone, "Enter a valid IANA timezone, e.g. Asia/Tashkent"),
});

async function ensureNoNearbyBuilding(client, input, exceptId = null) {
  const { rows } = await client.query(
    `SELECT id, name, distance_meters
     FROM (
       SELECT id, name,
         6371000 * 2 * asin(sqrt(LEAST(1,
           power(sin(radians(latitude - $1) / 2), 2) +
           cos(radians($1)) * cos(radians(latitude)) *
           power(sin(radians(longitude - $2) / 2), 2)
         ))) AS distance_meters
       FROM buildings
       WHERE $3::uuid IS NULL OR id <> $3
     ) nearby
     WHERE distance_meters < 15
     ORDER BY distance_meters
     LIMIT 1`,
    [input.latitude, input.longitude, exceptId],
  );
  if (rows[0])
    fail(
      409,
      `A building named "${rows[0].name}" already exists within 15 meters of this location.`,
    );
}

function asyncRoute(handler) {
  return (request, response, next) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

function authenticate(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token)
    return response.status(401).json({ error: "Authentication required" });
  try {
    request.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return response.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (request, response, next) =>
    roles.includes(request.user.role)
      ? next()
      : response.status(403).json({ error: "Insufficient permissions" });
}

const coordinates = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().optional(),
});

async function activeSession(workerId, client = pool) {
  const { rows } = await client.query(
    `SELECT s.*, b.latitude, b.longitude, b.radius_meters, b.time_zone
     FROM attendance_sessions s JOIN buildings b ON b.id = s.building_id
     WHERE s.worker_id = $1 AND s.checked_out_at IS NULL FOR UPDATE OF s`,
    [workerId],
  );
  if (!rows[0]) fail(409, "No active attendance session");
  return rows[0];
}

function event(client, sessionId, actorId, type, details = {}) {
  return client.query(
    "INSERT INTO attendance_events(session_id, actor_id, event_type, details) VALUES ($1, $2, $3, $4)",
    [sessionId, actorId, type, details],
  );
}

app.get(
  "/health",
  asyncRoute(async (_request, response) => {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  }),
);

app.post(
  "/auth/login",
  asyncRoute(async (request, response) => {
    const input = z
      .object({
        identifier: z.string().trim().min(1).optional(),
        username: z.string().trim().min(1).optional(),
        email: z.string().email().optional(),
        password: z.string().min(1),
      })
      .refine((value) => value.identifier || value.username || value.email, {
        message: "Enter your username or email",
      })
      .parse(request.body);
    const identifier = input.identifier ?? input.username ?? input.email;
    const { rows } = await pool.query(
      "SELECT id, email, username, full_name, password_hash, role, building_id FROM users WHERE (lower(email) = lower($1) OR lower(username) = lower($1)) AND active = true",
      [identifier],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash)))
      fail(401, "Invalid email or password");
    const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, {
      expiresIn: "12h",
    });
    response.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        buildingId: user.building_id,
      },
    });
  }),
);

app.use(authenticate);

app.get(
  "/me",
  asyncRoute(async (request, response) => {
    const { rows } = await pool.query(
      "SELECT id, email, username, full_name, role, building_id, hourly_rate FROM users WHERE id = $1",
      [request.user.sub],
    );
    if (!rows[0]) fail(401, "User no longer exists");
    response.json({ user: rows[0] });
  }),
);

app.post(
  "/attendance/check-in",
  requireRole("WORKER"),
  asyncRoute(async (request, response) => {
    const input = coordinates
      .extend({ buildingId: z.string().uuid() })
      .parse(request.body);
    const { rows: workerRows } = await pool.query(
      "SELECT building_id FROM users WHERE id = $1 AND active = true",
      [request.user.sub],
    );
    if (!workerRows[0] || workerRows[0].building_id !== input.buildingId)
      fail(403, "This building is not assigned to your account");
    const { rows: buildingRows } = await pool.query(
      "SELECT * FROM buildings WHERE id = $1",
      [input.buildingId],
    );
    const building = buildingRows[0];
    if (!building) fail(404, "Building not found");
    const now = new Date();
    const workDate = localDateAt(now, building.time_zone);
    if (!isCheckInWindowOpen(now, workDate, building.time_zone))
      fail(400, "Check-in opens at 07:45 local time");
    if (!isInsideGeofence(input, building))
      fail(403, "You must be inside the building geofence to check in");

    const scheduledStart = localTimeToUtc(
      workDate,
      "08:00:00",
      building.time_zone,
    );
    const paidStart = getPaidStart(now, scheduledStart);
    const session = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO attendance_sessions(worker_id, building_id, work_date, status, checked_in_at, paid_start_at)
       VALUES ($1, $2, $3, 'WORKING', $4, $5) RETURNING *`,
        [request.user.sub, building.id, workDate, now, paidStart],
      );
      await event(client, rows[0].id, request.user.sub, "CHECK_IN", {
        latitude: input.latitude,
        longitude: input.longitude,
      });
      return rows[0];
    });
    response
      .status(201)
      .json({ session, paidStartAt: paidStart, onTime: now <= scheduledStart });
  }),
);

app.get(
  "/attendance/current",
  requireRole("WORKER"),
  asyncRoute(async (request, response) => {
    const { rows } = await pool.query(
      `SELECT s.*, b.name AS building_name, b.latitude, b.longitude, b.radius_meters,
       i.kind AS active_interval_kind, i.started_at AS active_interval_started_at
     FROM attendance_sessions s
     JOIN buildings b ON b.id = s.building_id
     LEFT JOIN unpaid_intervals i ON i.session_id = s.id AND i.ended_at IS NULL
     WHERE s.worker_id = $1 AND s.checked_out_at IS NULL`,
      [request.user.sub],
    );
    response.json({
      session: rows[0] ?? null,
      geofenceEnabled: rows[0]?.status === "WORKING",
    });
  }),
);

app.post(
  "/attendance/intervals/:kind/start",
  requireRole("WORKER"),
  asyncRoute(async (request, response) => {
    const kind = z
      .enum(["break", "lunch"])
      .parse(request.params.kind)
      .toUpperCase();
    const input = z
      .object({ reason: z.string().trim().max(500).optional() })
      .parse(request.body ?? {});
    if (kind === "BREAK" && !input.reason)
      fail(400, "A reason is required to start a break");
    const result = await inTransaction(async (client) => {
      const session = await activeSession(request.user.sub, client);
      if (session.status !== "WORKING")
        fail(409, "Continue the current unpaid interval first");
      const { rows } = await client.query(
        "INSERT INTO unpaid_intervals(session_id, kind, reason, started_at) VALUES ($1, $2, $3, now()) RETURNING *",
        [session.id, kind, input.reason ?? null],
      );
      await client.query(
        "UPDATE attendance_sessions SET status = $2 WHERE id = $1",
        [session.id, kind],
      );
      await event(client, session.id, request.user.sub, `${kind}_START`, {
        reason: input.reason ?? null,
      });
      return rows[0];
    });
    response.status(201).json({ interval: result, geofenceEnabled: false });
  }),
);

app.post(
  "/attendance/intervals/:kind/end",
  requireRole("WORKER"),
  asyncRoute(async (request, response) => {
    const kind = z
      .enum(["break", "lunch"])
      .parse(request.params.kind)
      .toUpperCase();
    const result = await inTransaction(async (client) => {
      const session = await activeSession(request.user.sub, client);
      if (session.status !== kind)
        fail(409, `No active ${kind.toLowerCase()} to end`);
      const { rows } = await client.query(
        `UPDATE unpaid_intervals SET ended_at = now()
       WHERE session_id = $1 AND kind = $2 AND ended_at IS NULL RETURNING *`,
        [session.id, kind],
      );
      await client.query(
        "UPDATE attendance_sessions SET status = 'WORKING' WHERE id = $1",
        [session.id],
      );
      await event(client, session.id, request.user.sub, `${kind}_END`);
      return rows[0];
    });
    response.json({ interval: result, geofenceEnabled: true });
  }),
);

app.post(
  "/attendance/geofence-ping",
  requireRole("WORKER"),
  asyncRoute(async (request, response) => {
    const input = coordinates.parse(request.body);
    const result = await inTransaction(async (client) => {
      const session = await activeSession(request.user.sub, client);
      if (session.status !== "WORKING")
        fail(409, "Geofence pings are paused during breaks and lunch");
      const inside = isInsideGeofence(input, session);
      await client.query(
        `INSERT INTO geofence_pings(session_id, latitude, longitude, accuracy_meters, inside_geofence)
       VALUES ($1, $2, $3, $4, $5)`,
        [
          session.id,
          input.latitude,
          input.longitude,
          input.accuracyMeters ?? null,
          inside,
        ],
      );
      return inside;
    });
    response.json({
      insideGeofence: result,
      alert: result
        ? null
        : "You are outside the work area. Return to the building or start a break.",
    });
  }),
);

app.post(
  "/attendance/check-out",
  requireRole("WORKER"),
  asyncRoute(async (request, response) => {
    const input = z
      .object({ reason: z.string().trim().max(500).optional() })
      .parse(request.body ?? {});
    const now = new Date();
    const result = await inTransaction(async (client) => {
      const session = await activeSession(request.user.sub, client);
      if (session.status !== "WORKING")
        fail(409, "End your break or lunch before checking out");
      const workDate = String(session.work_date).slice(0, 10);
      const scheduledEnd = localTimeToUtc(
        workDate,
        "18:00:00",
        session.time_zone,
      );
      const requiresReason = checkoutRequiresReason(now, scheduledEnd);
      if (requiresReason && !input.reason)
        fail(400, "A reason is required for early or late checkout");
      const { rows: intervals } = await client.query(
        "SELECT started_at, ended_at FROM unpaid_intervals WHERE session_id = $1 ORDER BY started_at",
        [session.id],
      );
      const worked = calculateWorkedTime({
        checkInAt: session.checked_in_at,
        checkOutAt: now,
        scheduledStartAt: session.paid_start_at,
        unpaidIntervals: intervals,
      });
      const { rows } = await client.query(
        `UPDATE attendance_sessions SET status = 'CHECKED_OUT', checked_out_at = $2,
       checkout_reason = $3, worked_ms = $4 WHERE id = $1 RETURNING *`,
        [session.id, now, input.reason ?? null, worked.workedMs],
      );
      await event(client, session.id, request.user.sub, "CHECK_OUT", {
        reason: input.reason ?? null,
        workedMs: worked.workedMs,
      });
      return rows[0];
    });
    const workedMs = Number(result.worked_ms);
    response.json({
      session: result,
      workedMs,
      shortfallMs: shortfallFromNormalDay(workedMs),
    });
  }),
);

app.get(
  "/admin/buildings",
  requireRole("ADMIN", "MANAGER"),
  asyncRoute(async (request, response) => {
    const { rows } = await pool.query(
      `SELECT * FROM buildings
       WHERE ($1::boolean = false OR id = (SELECT building_id FROM users WHERE id = $2))
       ORDER BY name`,
      [request.user.role === "MANAGER", request.user.sub],
    );
    response.json({ buildings: rows });
  }),
);

app.post(
  "/admin/buildings",
  requireRole("ADMIN"),
  asyncRoute(async (request, response) => {
    const input = buildingInputSchema.parse(request.body);
    const building = await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(41027, 1)");
      await ensureNoNearbyBuilding(client, input);

      const { rows } = await client.query(
        `INSERT INTO buildings(name, latitude, longitude, radius_meters, time_zone)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          input.name,
          input.latitude,
          input.longitude,
          input.radiusMeters,
          input.timeZone,
        ],
      );
      return rows[0];
    });
    response.status(201).json({ building });
  }),
);

app.patch(
  "/admin/buildings/:id",
  requireRole("ADMIN"),
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = buildingInputSchema.parse(request.body);
    const building = await inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(41027, 1)");
      const { rows: existing } = await client.query(
        "SELECT id FROM buildings WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!existing[0]) fail(404, "Building not found");
      await ensureNoNearbyBuilding(client, input, id);

      const { rows } = await client.query(
        `UPDATE buildings
         SET name = $2, latitude = $3, longitude = $4, radius_meters = $5, time_zone = $6
         WHERE id = $1 RETURNING *`,
        [
          id,
          input.name,
          input.latitude,
          input.longitude,
          input.radiusMeters,
          input.timeZone,
        ],
      );
      return rows[0];
    });
    response.json({ building });
  }),
);

app.delete(
  "/admin/buildings/:id",
  requireRole("ADMIN"),
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    try {
      await inTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(41027, 1)");
        const { rows: existing } = await client.query(
          "SELECT id FROM buildings WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (!existing[0]) fail(404, "Building not found");

        const { rows: assignedWorkers } = await client.query(
          "SELECT 1 FROM users WHERE building_id = $1 AND role = 'WORKER' LIMIT 1",
          [id],
        );
        if (assignedWorkers[0])
          fail(
            409,
            "This building cannot be deleted while workers are assigned to it. Reassign the workers first.",
          );

        await client.query("DELETE FROM buildings WHERE id = $1", [id]);
      });
    } catch (error) {
      if (error.code === "23503")
        fail(
          409,
          "This building has attendance history and cannot be deleted.",
        );
      throw error;
    }
    response.sendStatus(204);
  }),
);

app.get(
  "/admin/users",
  requireRole("ADMIN", "MANAGER"),
  asyncRoute(async (request, response) => {
    const input = z
      .object({ buildingId: z.string().uuid().optional() })
      .parse(request.query);
    const { rows } = await pool.query(
      `SELECT id, email, username, full_name, role, building_id, hourly_rate, active, created_at
     FROM users WHERE ($1::uuid IS NULL OR building_id = $1)
       AND ($2::boolean = false OR building_id = (SELECT building_id FROM users WHERE id = $3))
     ORDER BY full_name`,
      [
        input.buildingId ?? null,
        request.user.role === "MANAGER",
        request.user.sub,
      ],
    );
    response.json({ users: rows });
  }),
);

app.post(
  "/admin/users",
  requireRole("ADMIN"),
  asyncRoute(async (request, response) => {
    const input = z
      .object({
        email: z.string().email().optional(),
        username: z
          .string()
          .trim()
          .min(3)
          .max(40)
          .regex(
            /^[a-zA-Z0-9._-]+$/,
            "Username may use letters, numbers, dot, dash, and underscore",
          )
          .optional(),
        fullName: z.string().trim().min(1).max(160),
        password: z.string().min(12),
        role: z.enum(["MANAGER", "WORKER"]),
        buildingId: z.string().uuid().optional(),
        hourlyRate: z.number().nonnegative().optional(),
      })
      .parse(request.body);
    if (input.role === "WORKER" && !input.username)
      fail(400, "Workers need a username");
    if (input.role === "MANAGER" && !input.email)
      fail(400, "Managers need an email address");
    if (!input.buildingId)
      fail(400, "Manager and worker accounts must be assigned to a building");
    const passwordHash = await bcrypt.hash(input.password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users(email, username, full_name, password_hash, role, building_id, hourly_rate)
     VALUES (lower($1), lower($2), $3, $4, $5, $6, $7)
     RETURNING id, email, username, full_name, role, building_id, hourly_rate, active`,
      [
        input.email?.toLowerCase() ?? null,
        input.username ?? null,
        input.fullName,
        passwordHash,
        input.role,
        input.buildingId ?? null,
        input.hourlyRate ?? null,
      ],
    );
    response.status(201).json({ user: rows[0] });
  }),
);

app.patch(
  "/admin/users/:id",
  requireRole("ADMIN"),
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = z
      .object({
        fullName: z.string().trim().min(1).max(160),
        username: z
          .string()
          .trim()
          .min(3)
          .max(40)
          .regex(
            /^[a-zA-Z0-9._-]+$/,
            "Username may use letters, numbers, dot, dash, and underscore",
          ),
        password: z.string().min(12).optional(),
        buildingId: z.string().uuid(),
        hourlyRate: z.number().nonnegative().nullable(),
        active: z.boolean(),
      })
      .parse(request.body);

    const passwordHash = input.password
      ? await bcrypt.hash(input.password, 12)
      : null;
    const { rows } = await pool.query(
      `UPDATE users
       SET full_name = $2, username = lower($3), building_id = $4,
           hourly_rate = $5, active = $6,
           password_hash = COALESCE($7, password_hash)
       WHERE id = $1 AND role = 'WORKER'
       RETURNING id, email, username, full_name, role, building_id, hourly_rate, active`,
      [
        id,
        input.fullName,
        input.username,
        input.buildingId,
        input.hourlyRate,
        input.active,
        passwordHash,
      ],
    );
    if (!rows[0]) fail(404, "Worker not found");
    response.json({ user: rows[0] });
  }),
);

app.delete(
  "/admin/users/:id",
  requireRole("ADMIN"),
  asyncRoute(async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    try {
      await inTransaction(async (client) => {
        const { rows: workers } = await client.query(
          "SELECT id FROM users WHERE id = $1 AND role = 'WORKER' FOR UPDATE",
          [id],
        );
        if (!workers[0]) fail(404, "Worker not found");

        const { rows: attendance } = await client.query(
          "SELECT 1 FROM attendance_sessions WHERE worker_id = $1 LIMIT 1",
          [id],
        );
        if (attendance[0])
          fail(
            409,
            "This worker has attendance history and cannot be deleted. Deactivate the account instead.",
          );

        await client.query("DELETE FROM users WHERE id = $1", [id]);
      });
    } catch (error) {
      if (error.code === "23503")
        fail(
          409,
          "This worker is referenced by attendance records and cannot be deleted. Deactivate the account instead.",
        );
      throw error;
    }
    response.sendStatus(204);
  }),
);

app.get(
  "/admin/attendance",
  requireRole("ADMIN", "MANAGER"),
  asyncRoute(async (request, response) => {
    const input = z
      .object({
        from: z.string().date(),
        to: z.string().date(),
        buildingId: z.string().uuid().optional(),
      })
      .parse(request.query);
    if (input.from > input.to) fail(400, "`from` must be on or before `to`");
    const { rows } = await pool.query(
      `SELECT s.*, u.full_name AS worker_name, u.email, u.hourly_rate,
        b.name AS building_name, b.time_zone AS building_time_zone,
        CASE WHEN s.worked_ms IS NULL OR u.hourly_rate IS NULL THEN NULL
          ELSE round((s.worked_ms::numeric / 3600000) * u.hourly_rate, 2) END AS estimated_pay,
        CASE WHEN s.worked_ms IS NULL THEN NULL
          ELSE GREATEST(0, $6::bigint - s.worked_ms) END AS shortfall_ms
     FROM attendance_sessions s
     JOIN users u ON u.id = s.worker_id
     JOIN buildings b ON b.id = s.building_id
     WHERE s.work_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.building_id = $3)
       AND ($4::boolean = false OR s.building_id = (SELECT building_id FROM users WHERE id = $5))
     ORDER BY s.work_date DESC, b.name, u.full_name`,
      [
        input.from,
        input.to,
        input.buildingId ?? null,
        request.user.role === "MANAGER",
        request.user.sub,
        NORMAL_PAID_DAY_MS,
      ],
    );
    response.json({ attendance: rows });
  }),
);

app.use((error, _request, response, _next) => {
  if (!error.status) console.error(error);
  if (error instanceof z.ZodError) {
    const fieldErrors = {};
    for (const issue of error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !fieldErrors[field])
        fieldErrors[field] = issue.message;
    }
    return response.status(400).json({
      error: error.issues[0]?.message ?? "Invalid request",
      fieldErrors,
    });
  }
  if (error.code === "23505" && error.constraint?.includes("username"))
    return response.status(409).json({
      error: "That username is already in use.",
      fieldErrors: { username: "That username is already in use." },
    });
  if (error.code === "23505" && error.constraint?.includes("email"))
    return response.status(409).json({
      error: "That email address is already in use.",
      fieldErrors: { email: "That email address is already in use." },
    });
  if (error.code === "23505")
    return response
      .status(409)
      .json({ error: "An active attendance session already exists" });
  if (error.code === "23503")
    return response
      .status(400)
      .json({ error: "Referenced record does not exist" });
  return response
    .status(error.status ?? 500)
    .json({ error: error.status ? error.message : "Internal server error" });
});

if (!jwtSecret) throw new Error("JWT_SECRET is required");
app.listen(port, () => console.log(`Attendance API listening on port ${port}`));
