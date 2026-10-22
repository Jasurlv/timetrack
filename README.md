# Work Ledger

Attendance and pay-time starter for multiple buildings and worker teams.

## Stack

- API: Node.js, Express, PostgreSQL
- Manager dashboard: Next.js and Tailwind CSS
- Worker app: React Native with Expo

## Local setup

Requirements: Node.js 20.9 or newer and PostgreSQL 14 or newer.

1. Create a PostgreSQL database named `work_sec_sys`.
2. Copy `apps/api/.env.example` to `apps/api/.env`, set `DATABASE_URL`, and use a long random `JWT_SECRET` and `ADMIN_PASSWORD` (at least 12 characters).
3. Install dependencies with `npm install`.
4. Run `npm --workspace apps/api run db:migrate`, then `npm --workspace apps/api run db:seed-admin`.
5. Start the API with `npm run dev:api` and the manager dashboard with `npm run dev:dashboard`.
6. Sign into the dashboard with the admin email and password. Use the map search or click the map to choose each building's location, then set its IANA timezone.
7. Use the Workers page to create worker accounts with a full name, username, password, building, and hourly rate. Workers sign into the mobile app with their username and password; no email is needed.
8. Start the Expo app with `npm run dev:mobile`. For a physical phone, set `EXPO_PUBLIC_API_URL` to the computer's LAN address (for example `http://192.168.1.20:4000`) before starting Expo.

The API defaults to `http://localhost:4000`; the dashboard defaults to that same URL. Override the browser API URL with `NEXT_PUBLIC_API_URL` when needed.

## Attendance policy

- Check-in opens at 07:45 in the building's timezone and requires a location inside its configured radius (30 m by default).
- Arrival through 08:00:00 starts paid time at 08:00. Arrival after that starts paid time 15 minutes after check-in.
- Breaks require a reason. Break and lunch durations are unpaid; location checks pause until the interval ends.
- Lunch may start and end at any time. Noon to 13:00 is an expected window, not an enforcement rule.
- Checkout from 17:55:00 through 18:05:00 needs no reason. Outside that range a reason is required.
- The app requests background location and sends pings while the session is `WORKING`. Mobile operating systems may delay background tasks, so the nominal two-minute interval is best effort, not a guaranteed real-time security control.
- Payroll reports calculate measured paid time and, when an hourly rate exists, a simple gross estimate. Currency, overtime, deductions, rounding policy, and jurisdiction-specific labor rules must be decided before using these amounts for payroll.

## API surface

- `POST /auth/login`, `GET /me`
- `POST /attendance/check-in`, `GET /attendance/current`, `POST /attendance/check-out`
- `POST /attendance/intervals/{break|lunch}/{start|end}`
- `POST /attendance/geofence-ping`
- `GET|POST /admin/buildings`, `GET|POST /admin/users`, `GET /admin/attendance`

Run policy tests with `npm run test:policy`.
