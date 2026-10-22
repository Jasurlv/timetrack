"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BuildingManager from "./components/BuildingManager";
import WorkerManager from "./components/WorkerManager";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const today = localDateInput(new Date());

function localDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWorkDate(value) {
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(year, month - 1, day));
}

function NavIcon({ name }) {
  const paths = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v11h14V9M9 20v-6h6v6" />
      </>
    ),
    buildings: (
      <>
        <path d="M4 21V5l8-3v19M12 8h8v13M2 21h20" />
        <path d="M7 7h2m-2 4h2m-2 4h2m7-4h2m-2 4h2" />
      </>
    ),
    workers: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-1a6 6 0 0 1 12 0v1H3Zm13-9a3 3 0 1 0-1-5.8M18 14a5 5 0 0 1 3 5v1h-3" />
      </>
    ),
    attendance: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

async function api(path, token, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

function Field({ label, ...props }) {
  return (
    <label className="ui-label">
      {label}
      <input
        className="ui-input"
        suppressHydrationWarning
        {...props}
      />
    </label>
  );
}

export default function Dashboard() {
  const pathname = usePathname();
  const view = pathname.split("/")[1] || "home";
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [users, setUsers] = useState([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [buildingId, setBuildingId] = useState("");
  const [reportScope, setReportScope] = useState({
    from: today,
    to: today,
    buildingId: "",
  });
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const reportBusyRef = useRef(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef(null);
  const menuTriggerRef = useRef(null);

  async function loadDashboard(
    authToken,
    start = from,
    end = to,
    site = buildingId,
  ) {
    const query = new URLSearchParams({ from: start, to: end });
    if (site) query.set("buildingId", site);
    const [buildingData, reportData, userData] = await Promise.all([
      api("/admin/buildings", authToken),
      api(`/admin/attendance?${query}`, authToken),
      api("/admin/users", authToken),
    ]);
    setBuildings(buildingData.buildings);
    setAttendance(reportData.attendance);
    setUsers(userData.users);
    setReportScope({ from: start, to: end, buildingId: site });
  }

  useEffect(() => {
    const savedToken = localStorage.getItem("work-ledger-token");
    if (!savedToken) return;
    api("/me", savedToken)
      .then(async ({ user: currentUser }) => {
        await loadDashboard(savedToken);
        setToken(savedToken);
        setUser(currentUser);
      })
      .catch((error) => {
        localStorage.removeItem("work-ledger-token");
        setNotice(error.message || "Could not load your workspace.");
        setNoticeError(true);
      });
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const panel = mobileMenuRef.current;
    const focusable = panel?.querySelectorAll(
      'a[href], button:not([disabled])',
    );
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    first?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      } else if (event.key === "Tab" && first && last) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      menuTriggerRef.current?.focus();
    };
  }, [mobileMenuOpen]);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setNoticeError(false);
    try {
      const result = await api("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!["ADMIN", "MANAGER"].includes(result.user.role))
        throw new Error("Manager account required");
      await loadDashboard(result.token);
      setToken(result.token);
      setUser(result.user);
      localStorage.setItem("work-ledger-token", result.token);
    } catch (error) {
      setNotice(error.message);
      setNoticeError(true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshReport(event) {
    event?.preventDefault();
    if (reportBusyRef.current) return;
    reportBusyRef.current = true;
    setReportBusy(true);
    setNotice("");
    setNoticeError(false);
    try {
      await loadDashboard(token, from, to, buildingId);
      setNotice("Report updated");
    } catch (error) {
      setNotice(error.message);
      setNoticeError(true);
    } finally {
      reportBusyRef.current = false;
      setReportBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem("work-ledger-token");
    setToken("");
    setUser(null);
    setAttendance([]);
    setBuildings([]);
    setUsers([]);
  }

  const checkedOut = attendance.filter(
    (entry) => entry.status === "CHECKED_OUT",
  ).length;
  const totalPay = attendance.reduce(
    (sum, entry) => sum + Number(entry.estimated_pay ?? 0),
    0,
  );
  const totalShortfall = attendance.reduce(
    (sum, entry) => sum + Number(entry.shortfall_ms ?? 0),
    0,
  );
  const workers = users.filter((person) => person.role === "WORKER");
  const activeWorkers = workers.filter((person) => person.active);
  const pageDetails = {
    home: ["Overview", "Your workforce at a glance"],
    buildings: ["Buildings", "Work locations and attendance settings"],
    workers: ["Workers", "Team accounts and assignments"],
    attendance: ["Attendance", "Review shifts, hours, and estimated pay"],
  }[view] ?? ["Overview", "Work Ledger"];
  const navItems = [
    ["home", "Home", "/"],
    ["buildings", "Buildings", "/buildings"],
    ["workers", "Workers", "/workers"],
    ["attendance", "Attendance", "/attendance"],
  ];

  if (!user)
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
        <form
          onSubmit={signIn}
          className="ui-card w-full max-w-md p-6 sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-blue-700">
            Work Ledger
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            Sign in to your workspace
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Manager and administrator access
          </p>
          <div className="mt-6 grid gap-4">
            <Field
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {notice && (
              <p role="alert" className="text-sm text-red-700">
                {notice}
              </p>
            )}
            <button
              disabled={busy}
              className="ui-button-primary mt-1 w-full"
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </main>
    );

  return (
    <main className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-slate-900 text-white lg:flex">
        <Link href="/" className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-sm font-bold">WL</span>
          <span>
            <span className="block text-sm font-semibold tracking-wide">Work Ledger</span>
            <span className="mt-0.5 block text-xs text-slate-400">Workforce operations</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 px-3 py-6">
          <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Workspace
          </p>
          {navItems.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              aria-current={view === key ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition ${
                view === key
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <NavIcon name={key} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-medium">{user.full_name ?? user.fullName}</p>
          <p className="mt-1 text-xs capitalize text-slate-400">
            {String(user.role).toLowerCase()}
          </p>
          <button
            onClick={signOut}
            className="mt-3 min-h-10 w-full rounded-md border border-white/15 px-3 text-left text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside
            ref={mobileMenuRef}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="relative flex h-full w-[min(18rem,85vw)] flex-col bg-slate-900 text-white"
          >
            <div className="flex h-[68px] items-center justify-between border-b border-white/10 px-5">
              <span className="font-semibold">Work Ledger</span>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
                className="grid h-10 w-10 place-items-center rounded text-xl hover:bg-white/10"
              >
                ×
              </button>
            </div>
            <nav aria-label="Main navigation" className="flex-1 space-y-1 px-3 py-5">
              {navItems.map(([key, label, href]) => (
                <Link
                  key={key}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={view === key ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium ${
                    view === key
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <NavIcon name={key} />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="border-t border-white/10 p-4">
              <p className="truncate text-sm font-medium">{user.full_name ?? user.fullName}</p>
              <button
                onClick={signOut}
                className="mt-3 min-h-10 w-full rounded-md border border-white/15 px-3 text-left text-sm text-slate-300 hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="min-h-screen min-w-0 lg:ml-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-[64px] items-center justify-between gap-3 px-3 sm:min-h-[68px] sm:gap-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open navigation menu"
                aria-expanded={mobileMenuOpen}
                ref={menuTriggerRef}
                onClick={() => setMobileMenuOpen(true)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden"
              >
                <span aria-hidden="true">☰</span>
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {pageDetails[0]}
                </p>
                <p className="hidden truncate text-xs text-slate-500 sm:block">
                  Work Ledger <span className="px-1 text-slate-300">/</span> {pageDetails[1]}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden max-w-48 truncate text-sm text-slate-600 sm:block">
                {user.full_name ?? user.fullName}
              </span>
              <button
                onClick={signOut}
                className="min-h-10 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:hidden"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

      {view === "attendance" && (
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="ui-page-title">Attendance report</h1>
              <p className="mt-1.5 text-sm text-slate-500">
                Review shifts, paid time, shortfall, and estimated pay. Work dates and times use each building&apos;s timezone.
              </p>
            </div>
            <p className="text-sm text-slate-500">
              {formatWorkDate(reportScope.from)} – {formatWorkDate(reportScope.to)}
            </p>
          </div>

          <form
            onSubmit={refreshReport}
            className="ui-card mt-6 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto] lg:items-end"
          >
            <Field
              label="From"
              type="date"
              required
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Field
              label="To"
              type="date"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <label className="ui-label">
              Building
              <select
                value={buildingId}
                onChange={(event) => setBuildingId(event.target.value)}
                className="ui-input"
              >
                <option value="">All buildings</option>
                {buildings.map((building) => (
                  <option key={building.id} value={building.id}>
                    {building.name}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={reportBusy} className="ui-button-primary">
              {reportBusy ? "Applying..." : "Apply filters"}
            </button>
          </form>

          {notice && (
            <p
              role={noticeError ? "alert" : "status"}
              aria-live={noticeError ? "assertive" : "polite"}
              className={`mt-3 text-sm ${noticeError ? "text-red-700" : "text-green-700"}`}
            >
              {notice}
            </p>
          )}

          <section aria-label="Attendance summary" className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <div className="ui-card min-w-0 p-3 sm:p-5">
              <p className="text-sm font-medium text-slate-500">
                Shifts in range
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 sm:mt-3">{attendance.length}</p>
            </div>
            <div className="ui-card min-w-0 p-3 sm:p-5">
              <p className="text-sm font-medium text-slate-500">
                Completed shifts
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900 sm:mt-3">{checkedOut}</p>
            </div>
            <div className="ui-card min-w-0 p-3 sm:p-5">
              <p className="text-sm font-medium text-slate-500">
                Below 9-hour day
              </p>
              <p className="mt-2 text-xl font-semibold text-slate-900 sm:mt-3 sm:text-2xl">
                {(totalShortfall / 3600000).toFixed(2)} h
              </p>
            </div>
            <div className="ui-card min-w-0 p-3 sm:p-5">
              <p className="text-sm font-medium text-slate-500">
                Estimated pay
              </p>
              <p className="mt-2 break-words text-xl font-semibold text-slate-900 sm:mt-3 sm:text-2xl">
                {totalPay.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Based on recorded hourly rates</p>
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="ui-section-title">Shift ledger</h2>
              <span className="text-xs text-slate-500">
                Amounts use each worker&apos;s hourly rate
              </span>
            </div>
            <div className="ui-card overflow-hidden">
            <div className="divide-y divide-slate-100 xl:hidden">
              {attendance.map((entry) => (
                <article key={entry.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-slate-900">
                        {entry.worker_name}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatWorkDate(entry.work_date)}
                      </p>
                    </div>
                    <span className="max-w-[45%] break-words text-right text-sm text-slate-600">
                      {entry.building_name}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-slate-100 pt-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Check in</dt>
                      <dd className="mt-1 font-medium text-slate-800">
                        {entry.checked_in_at
                          ? new Date(entry.checked_in_at).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: entry.building_time_zone,
                              },
                            )
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Check out</dt>
                      <dd className="mt-1 font-medium text-slate-800">
                        {entry.checked_out_at ? (
                          new Date(entry.checked_out_at).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: entry.building_time_zone,
                            },
                          )
                        ) : (
                          <span className="text-blue-700">Working</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Paid time</dt>
                      <dd className="mt-1 font-medium tabular-nums text-slate-800">
                        {entry.worked_ms == null
                          ? "—"
                          : `${(Number(entry.worked_ms) / 3600000).toFixed(2)} h`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Shortfall</dt>
                      <dd className="mt-1 font-medium tabular-nums text-slate-800">
                        {entry.shortfall_ms == null
                          ? "—"
                          : `${(Number(entry.shortfall_ms) / 3600000).toFixed(2)} h`}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-slate-500">Estimated pay</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-slate-900">
                        {entry.estimated_pay == null
                          ? "—"
                          : Number(entry.estimated_pay).toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
              {attendance.length === 0 && (
                <p className="px-4 py-12 text-center text-sm text-slate-500">
                  No shifts in this date range.
                </p>
              )}
            </div>
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[950px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    {[
                      "Date",
                      "Worker",
                      "Building",
                      "Check in",
                      "Check out",
                      "Paid time",
                      "Shortfall",
                      "Estimate",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className={`px-4 py-3.5 font-medium ${
                          ["Paid time", "Shortfall", "Estimate"].includes(heading)
                            ? "text-right"
                            : ""
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        {formatWorkDate(entry.work_date)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {entry.worker_name}
                      </td>
                      <td className="px-4 py-3">{entry.building_name}</td>
                      <td className="px-4 py-3">
                        {entry.checked_in_at
                          ? new Date(entry.checked_in_at).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: entry.building_time_zone,
                              },
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {entry.checked_out_at ? (
                          new Date(entry.checked_out_at).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: entry.building_time_zone,
                            },
                          )
                        ) : (
                          <span className="font-medium text-blue-700">Working</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {entry.worked_ms == null
                          ? "—"
                          : `${(Number(entry.worked_ms) / 3600000).toFixed(2)} h`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {entry.shortfall_ms == null
                          ? "—"
                          : `${(Number(entry.shortfall_ms) / 3600000).toFixed(2)} h`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {entry.estimated_pay == null
                          ? "—"
                          : Number(entry.estimated_pay).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {attendance.length === 0 && (
                    <tr>
                      <td
                        colSpan="8"
                        className="px-4 py-14 text-center text-sm text-slate-500"
                      >
                        No shifts in this date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </section>
        </div>
      )}

      {view === "home" && (
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="ui-page-title">Overview</h1>
              <p className="mt-1.5 text-sm text-slate-500">
                A current snapshot of your workforce and work locations.
              </p>
            </div>
            <p className="text-sm text-slate-500">
              Report range: {formatWorkDate(reportScope.from)} – {formatWorkDate(reportScope.to)}
            </p>
          </div>

          <section
            aria-label="Workforce overview"
            className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
          >
            <Link href="/workers" className="ui-card block min-w-0 p-4 transition hover:border-blue-300 hover:shadow-sm sm:p-5">
              <p className="text-sm font-medium text-slate-500">Total workers</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:mt-3 sm:text-3xl">
                {workers.length}
              </p>
              <p className="mt-2 text-xs text-slate-500">View team directory</p>
            </Link>
            <Link href="/workers" className="ui-card block min-w-0 p-4 transition hover:border-blue-300 hover:shadow-sm sm:p-5">
              <p className="text-sm font-medium text-slate-500">Active workers</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:mt-3 sm:text-3xl">
                {activeWorkers.length}
              </p>
              <p className="mt-2 text-xs text-slate-500">Accounts able to sign in</p>
            </Link>
            <Link href="/buildings" className="ui-card block min-w-0 p-4 transition hover:border-blue-300 hover:shadow-sm sm:p-5">
              <p className="text-sm font-medium text-slate-500">Buildings</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:mt-3 sm:text-3xl">
                {buildings.length}
              </p>
              <p className="mt-2 text-xs text-slate-500">Registered work locations</p>
            </Link>
            <Link href="/attendance" className="ui-card block min-w-0 p-4 transition hover:border-blue-300 hover:shadow-sm sm:p-5">
              <p className="text-sm font-medium text-slate-500">Shifts in range</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:mt-3 sm:text-3xl">
                {attendance.length}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {reportScope.from === reportScope.to
                  ? formatWorkDate(reportScope.from)
                  : `${formatWorkDate(reportScope.from)} – ${formatWorkDate(reportScope.to)}`}
              </p>
            </Link>
          </section>

          {workers.some((worker) => !worker.building_id) && (
            <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-sm font-semibold text-amber-900">
                Workers without a building assignment
              </h2>
              <p className="mt-1 text-sm text-amber-800">
                {workers.filter((worker) => !worker.building_id).length} worker
                {workers.filter((worker) => !worker.building_id).length === 1 ? "" : "s"} need an assignment.
              </p>
              <Link
                href="/workers"
                className="mt-2 inline-flex text-sm font-semibold text-amber-900 underline underline-offset-2"
              >
                Review workers
              </Link>
            </section>
          )}

          <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
            <div className="ui-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="ui-section-title">Attendance snapshot</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Work dates follow each building&apos;s local timezone.
                  </p>
                </div>
                <Link
                  href="/attendance"
                  className="text-sm font-semibold text-blue-700 hover:underline"
                >
                  View report
                </Link>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">Completed shifts</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{checkedOut}</p>
                </div>
                <div className="rounded-md bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">Below 9-hour day</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {(totalShortfall / 3600000).toFixed(2)} h
                  </p>
                </div>
              </div>
            </div>
            <div className="ui-card p-5 sm:p-6">
              <h2 className="ui-section-title">Quick actions</h2>
              <p className="mt-1 text-sm text-slate-500">
                Go directly to your day-to-day tools.
              </p>
              <div className="mt-5 grid gap-3">
                {user.role === "ADMIN" && (
                  <>
                    <Link href="/workers?create=1" className="ui-button-primary">
                      + Add worker
                    </Link>
                    <Link href="/buildings?create=1" className="ui-button-secondary">
                      + Add building
                    </Link>
                  </>
                )}
                {user.role !== "ADMIN" && (
                  <>
                    <Link href="/workers" className="ui-button-primary">
                      Manage workers
                    </Link>
                    <Link href="/buildings" className="ui-button-secondary">
                      Manage buildings
                    </Link>
                  </>
                )}
                <Link href="/attendance" className="ui-button-secondary">
                  Open attendance report
                </Link>
              </div>
            </div>
          </section>
        </div>
      )}

      {view === "buildings" && (
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <BuildingManager
            token={token}
            buildings={buildings}
            setBuildings={setBuildings}
            users={users}
            canManage={user.role === "ADMIN"}
          />
        </div>
      )}

      {view === "workers" && (
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
          <WorkerManager
            token={token}
            workers={users.filter((person) => person.role === "WORKER")}
            setUsers={setUsers}
            buildings={buildings}
            canManage={user.role === "ADMIN"}
          />
        </div>
      )}
      </div>
    </main>
  );
}
