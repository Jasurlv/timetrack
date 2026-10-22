"use client";

import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "./ui/ConfirmDialog";
import Modal from "./ui/Modal";
import { useToast } from "./ui/ToastProvider";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const inputClass = "ui-input";

async function request(path, token, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (response.status === 204) return null;

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error ?? "Request failed");
    error.fieldErrors = payload.fieldErrors ?? {};
    throw error;
  }
  return payload;
}

function WorkerForm({ worker, buildings, onSave, onCancel, pending }) {
  const [values, setValues] = useState({
    fullName: worker?.full_name ?? "",
    username: worker?.username ?? "",
    password: "",
    buildingId: worker?.building_id ?? "",
    hourlyRate:
      worker?.hourly_rate == null ? "" : String(Number(worker.hourly_rate)),
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");

  function changeField(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError("");
  }

  async function submit(event) {
    event.preventDefault();
    setFieldErrors({});
    setFormError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    try {
      await onSave({
        fullName: String(form.get("fullName")).trim(),
        username: String(form.get("username")).trim(),
        ...(password ? { password } : {}),
        buildingId: String(form.get("buildingId")),
        hourlyRate:
          String(form.get("hourlyRate")).trim() === ""
            ? null
            : Number(form.get("hourlyRate")),
      });
    } catch (error) {
      setFieldErrors(error.fieldErrors ?? {});
      setFormError(
        Object.keys(error.fieldErrors ?? {}).length
          ? ""
          : error.message || "Could not save this worker.",
      );
    }
  }

  function field(name, label, options = {}) {
    const errorId = `worker-${name}-error`;
    return (
      <label
        htmlFor={`worker-${name}`}
        className="ui-label"
      >
        {label}
        <input
          id={`worker-${name}`}
          name={name}
          className={inputClass}
          value={values[name]}
          onChange={(event) => changeField(name, event.target.value)}
          aria-invalid={Boolean(fieldErrors[name])}
          aria-describedby={fieldErrors[name] ? errorId : undefined}
          {...options}
        />
        {fieldErrors[name] && (
          <span
            id={errorId}
            role="alert"
            className="text-xs font-normal normal-case text-signal"
          >
            {fieldErrors[name]}
          </span>
        )}
      </label>
    );
  }

  const buildingErrorId = "worker-buildingId-error";

  return (
    <form onSubmit={submit} className="grid gap-4">
      {field("fullName", "Full name", { required: true, maxLength: 160 })}
      {field("username", "Username", {
        autoCapitalize: "none",
        autoComplete: "username",
        minLength: 3,
        maxLength: 40,
        pattern: "[A-Za-z0-9._-]+",
        required: true,
      })}
      {field(
        "password",
        worker ? "New password (leave blank to keep current)" : "Password",
        {
          type: "password",
          autoComplete: "new-password",
          minLength: values.password ? 12 : undefined,
          required: !worker,
        },
      )}
      {fieldErrors.password && (
        <p role="alert" className="-mt-3 text-sm text-signal">
          {fieldErrors.password}
        </p>
      )}
      <label
        htmlFor="worker-buildingId"
        className="ui-label"
      >
        Building
        <select
          id="worker-buildingId"
          name="buildingId"
          required
          value={values.buildingId}
          onChange={(event) => changeField("buildingId", event.target.value)}
          aria-invalid={Boolean(fieldErrors.buildingId)}
          aria-describedby={
            fieldErrors.buildingId ? buildingErrorId : undefined
          }
          className={inputClass}
        >
          <option value="">Select building</option>
          {buildings.map((building) => (
            <option key={building.id} value={building.id}>
              {building.name}
            </option>
          ))}
        </select>
        {fieldErrors.buildingId && (
          <span
            id={buildingErrorId}
            role="alert"
            className="text-xs font-normal normal-case text-signal"
          >
            {fieldErrors.buildingId}
          </span>
        )}
      </label>
      {field("hourlyRate", "Hourly rate", {
        type: "number",
        min: 0,
        step: "0.01",
        required: !worker,
        placeholder: worker ? "Not set" : "",
      })}
      {fieldErrors.hourlyRate && (
        <p role="alert" className="-mt-3 text-sm text-signal">
          {fieldErrors.hourlyRate}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm text-signal">
          {formError}
        </p>
      )}
      <div
        aria-busy={pending}
        className="flex flex-col-reverse gap-2 border-t border-ink/10 pt-4 sm:flex-row sm:justify-end"
      >
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="ui-button-secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || buildings.length === 0}
          className="ui-button-primary"
        >
          {pending ? "Saving..." : worker ? "Save changes" : "Add worker"}
        </button>
      </div>
      {buildings.length === 0 && (
        <p className="text-sm text-signal">
          Add a building before creating a worker account.
        </p>
      )}
    </form>
  );
}

export default function WorkerManager({
  token,
  workers,
  setUsers,
  buildings,
  canManage,
}) {
  const notify = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteWorker, setDeleteWorker] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [statusWorker, setStatusWorker] = useState(null);
  const [statusPending, setStatusPending] = useState(false);
  const [search, setSearch] = useState("");
  const [buildingFilter, setBuildingFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const statusRef = useRef(false);

  const activeCount = workers.filter((worker) => worker.active).length;
  const visibleWorkers = workers.filter((worker) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      worker.full_name.toLowerCase().includes(query) ||
      (worker.username ?? "").toLowerCase().includes(query) ||
      (worker.email ?? "").toLowerCase().includes(query);
    const matchesBuilding =
      !buildingFilter || worker.building_id === buildingFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? worker.active : !worker.active);
    return matchesSearch && matchesBuilding && matchesStatus;
  });

  function startCreate() {
    setEditingWorker(null);
    setFormOpen(true);
  }

  function startEdit(worker) {
    setEditingWorker(worker);
    setFormOpen(true);
  }

  useEffect(() => {
    if (
      canManage &&
      new URLSearchParams(window.location.search).get("create") === "1"
    ) {
      startCreate();
    }
  }, [canManage]);

  async function saveWorker(input) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const isEditing = Boolean(editingWorker);
      const result = await request(
        isEditing
          ? `/admin/users/${encodeURIComponent(editingWorker.id)}`
          : "/admin/users",
        token,
        {
          method: isEditing ? "PATCH" : "POST",
          body: JSON.stringify(
            isEditing
              ? { ...input, active: editingWorker.active }
              : { ...input, role: "WORKER" },
          ),
        },
      );
      if (!result?.user)
        throw new Error("The server did not confirm the worker was saved.");

      setUsers((current) => {
        const next = isEditing
          ? current.map((item) =>
              item.id === result.user.id ? result.user : item,
            )
          : [...current, result.user];
        return next.sort((first, second) =>
          first.full_name.localeCompare(second.full_name),
        );
      });
      setFormOpen(false);
      setEditingWorker(null);
      notify(isEditing ? "Worker updated." : "Worker added.", "success");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeWorker() {
    if (!deleteWorker || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await request(
        `/admin/users/${encodeURIComponent(deleteWorker.id)}`,
        token,
        { method: "DELETE" },
      );
      setUsers((current) =>
        current.filter((item) => item.id !== deleteWorker.id),
      );
      setDeleteWorker(null);
      notify("Worker deleted.", "success");
    } catch (error) {
      notify(error.message || "Could not delete this worker.", "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  async function updateWorkerStatus() {
    if (!statusWorker || statusRef.current) return;
    statusRef.current = true;
    setStatusPending(true);
    const active = !statusWorker.active;
    try {
      const result = await request(
        `/admin/users/${encodeURIComponent(statusWorker.id)}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            fullName: statusWorker.full_name,
            username: statusWorker.username,
            buildingId: statusWorker.building_id,
            hourlyRate:
              statusWorker.hourly_rate == null
                ? null
                : Number(statusWorker.hourly_rate),
            active,
          }),
        },
      );
      if (!result?.user)
        throw new Error("The server did not confirm the status change.");
      setUsers((current) =>
        current.map((item) =>
          item.id === result.user.id ? result.user : item,
        ),
      );
      setStatusWorker(null);
      notify(active ? "Worker account activated." : "Worker deactivated.", "success");
    } catch (error) {
      notify(error.message || "Could not update this worker.", "error");
    } finally {
      statusRef.current = false;
      setStatusPending(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col items-stretch justify-between gap-4 sm:mb-7 sm:flex-row sm:items-end">
        <div>
          <h1 className="ui-page-title">Workers</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Manage worker accounts, assignments, and access.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={startCreate}
            className="ui-button-primary w-full sm:w-auto"
          >
            + Add worker
          </button>
        )}
      </div>

      <section>
        <div className="ui-card overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="ui-section-title">Team</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {workers.length} total · {activeCount} active
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_220px_160px]">
              <label className="ui-label">
                <span className="sr-only">Search workers</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or username"
                  className="ui-input"
                />
              </label>
              <label className="ui-label">
                <span className="sr-only">Filter by building</span>
                <select
                  value={buildingFilter}
                  onChange={(event) => setBuildingFilter(event.target.value)}
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
              <label className="ui-label">
                <span className="sr-only">Filter by account status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="ui-input"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
          </div>
          <div className="divide-y divide-slate-100 xl:hidden">
            {visibleWorkers.map((worker) => (
              <article key={worker.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-semibold text-slate-900">
                      {worker.full_name}
                    </h3>
                    <p className="mt-1 break-all text-sm text-slate-500">
                      @{worker.username}
                    </p>
                    {worker.email && (
                      <p className="mt-0.5 break-all text-xs text-slate-500">
                        {worker.email}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      worker.active
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {worker.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium text-slate-500">
                      Building
                    </dt>
                    <dd className="mt-1 break-words font-medium text-slate-800">
                      {buildings.find(
                        (building) => building.id === worker.building_id,
                      )?.name ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Hourly rate
                    </dt>
                    <dd className="mt-1 font-medium text-slate-800">
                      {worker.hourly_rate == null
                        ? "—"
                        : Number(worker.hourly_rate).toFixed(2)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-3">
                  {canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(worker)}
                        className="min-h-10 rounded-md px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Edit / reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusWorker(worker)}
                        className="min-h-10 rounded-md px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {worker.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${worker.full_name}`}
                        onClick={() => setDeleteWorker(worker)}
                        className="min-h-10 rounded-md px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className="px-3 text-sm text-slate-500">
                      View only
                    </span>
                  )}
                </div>
              </article>
            ))}
            {workers.length === 0 && (
              <div className="px-5 py-10 text-center">
                <p className="font-medium text-slate-800">No workers yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Add a worker to start building your team directory.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={startCreate}
                    className="ui-button-primary mt-4"
                  >
                    + Add worker
                  </button>
                )}
              </div>
            )}
            {workers.length > 0 && visibleWorkers.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                No workers match these filters.
              </p>
            )}
          </div>
          <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[780px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                {[
                  "Worker",
                  "Building",
                  "Hourly rate",
                  "Status",
                  "Actions",
                ].map((heading) => (
                  <th key={heading} className="px-5 py-3.5 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleWorkers.map((worker) => (
                <tr key={worker.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900">{worker.full_name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      @{worker.username}
                    </p>
                    {worker.email && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {worker.email}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {buildings.find(
                      (building) => building.id === worker.building_id,
                    )?.name ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {worker.hourly_rate == null
                      ? "—"
                      : Number(worker.hourly_rate).toFixed(2)}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        worker.active
                          ? "bg-green-50 text-green-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {worker.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(worker)}
                          className="rounded px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          Edit / reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusWorker(worker)}
                          className="rounded px-2 py-1 font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          {worker.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${worker.full_name}`}
                          onClick={() => setDeleteWorker(worker)}
                          className="rounded px-2 py-1 font-semibold text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <span className="text-ink/40">View only</span>
                    )}
                  </td>
                </tr>
              ))}
              {workers.length === 0 && (
                <tr>
                  <td
                    colSpan="5"
                    className="px-5 py-14 text-center"
                  >
                    <p className="font-medium text-slate-800">No workers yet</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Add a worker to start building your team directory.
                    </p>
                    {canManage && (
                      <button
                        type="button"
                        onClick={startCreate}
                        className="ui-button-primary mt-4"
                      >
                        + Add worker
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {workers.length > 0 && visibleWorkers.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-5 py-12 text-center text-sm text-slate-500">
                    No workers match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {formOpen && (
        <Modal
          open
          title={editingWorker ? "Edit worker" : "Add a worker"}
          description={
            editingWorker
              ? "Update the worker profile and account access."
              : "Create a worker account and assign a building."
          }
          onClose={() => {
            if (!savingRef.current) {
              setFormOpen(false);
              setEditingWorker(null);
            }
          }}
          pending={saving}
        >
          <WorkerForm
            key={editingWorker?.id ?? "new"}
            worker={editingWorker}
            buildings={buildings}
            onSave={saveWorker}
            onCancel={() => {
              setFormOpen(false);
              setEditingWorker(null);
            }}
            pending={saving}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(deleteWorker)}
        title="Delete worker?"
        description={
          deleteWorker
            ? `“${deleteWorker.full_name}” will be permanently deleted if no attendance history is attached. Workers with attendance history must be deactivated instead.`
            : ""
        }
        confirmLabel="Delete worker"
        pending={deleting}
        onCancel={() => {
          if (!deletingRef.current) setDeleteWorker(null);
        }}
        onConfirm={removeWorker}
      />
      <ConfirmDialog
        open={Boolean(statusWorker)}
        title={statusWorker?.active ? "Deactivate worker?" : "Activate worker?"}
        description={
          statusWorker?.active
            ? `${statusWorker.full_name} will no longer be able to sign in. Their profile and attendance history will be retained.`
            : `${statusWorker?.full_name} will be able to sign in again. Their existing profile and attendance history will remain unchanged.`
        }
        confirmLabel={statusWorker?.active ? "Deactivate worker" : "Activate worker"}
        pending={statusPending}
        onCancel={() => {
          if (!statusRef.current) setStatusWorker(null);
        }}
        onConfirm={updateWorkerStatus}
      />
    </>
  );
}
