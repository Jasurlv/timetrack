"use client";

import { useEffect, useRef, useState } from "react";
import MapPicker from "./MapPicker";
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

function BuildingForm({ building, onSave, onCancel, pending }) {
  const [values, setValues] = useState({
    name: building?.name ?? "",
    latitude:
      building?.latitude == null ? "" : String(Number(building.latitude)),
    longitude:
      building?.longitude == null ? "" : String(Number(building.longitude)),
    radiusMeters:
      building?.radius_meters == null ? "30" : String(building.radius_meters),
    timeZone: building?.time_zone ?? "",
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

    try {
      await onSave({
        name: String(form.get("name")).trim(),
        latitude: Number(form.get("latitude")),
        longitude: Number(form.get("longitude")),
        radiusMeters: Number(form.get("radiusMeters")),
        timeZone: String(form.get("timeZone")).trim(),
      });
    } catch (error) {
      setFieldErrors(error.fieldErrors ?? {});
      setFormError(
        Object.keys(error.fieldErrors ?? {}).length
          ? ""
          : error.message || "Could not save this building.",
      );
    }
  }

  function field(name, label, options = {}) {
    const errorId = `${name}-error`;
    return (
      <label
        htmlFor={name}
        className="ui-label"
      >
        {label}
        <input
          id={name}
          name={name}
          className={inputClass}
          value={values[name]}
          onChange={(event) => changeField(name, event.target.value)}
          aria-invalid={Boolean(fieldErrors[name])}
          aria-describedby={fieldErrors[name] ? errorId : undefined}
          {...options}
        />
        {fieldErrors[name] && (
          <span id={errorId} role="alert" className="text-xs font-normal normal-case text-signal">
            {fieldErrors[name]}
          </span>
        )}
      </label>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {field("name", "Building name *", { required: true, maxLength: 120 })}
      <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Location &amp; attendance settings
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Set a map location, geofence radius, and local timezone.
          </p>
        </div>
        <MapPicker
          lat={values.latitude === "" ? null : Number(values.latitude)}
          lng={values.longitude === "" ? null : Number(values.longitude)}
          radius={Number(values.radiusMeters) || 30}
          onPick={(latitude, longitude) => {
            changeField("latitude", latitude.toFixed(6));
            changeField("longitude", longitude.toFixed(6));
          }}
          onTimeZoneChange={(timeZone) => changeField("timeZone", timeZone)}
        />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("latitude", "Latitude *", {
            type: "number",
            step: "any",
            min: -90,
            max: 90,
            required: true,
          })}
          {field("longitude", "Longitude *", {
            type: "number",
            step: "any",
            min: -180,
            max: 180,
            required: true,
          })}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("radiusMeters", "Geofence radius (meters) *", {
            type: "number",
            min: 1,
            max: 1000,
            step: 1,
            required: true,
          })}
          {field("timeZone", "Timezone *", {
            placeholder: "Choose a location on the map",
            readOnly: true,
            required: true,
          })}
        </div>
      </section>
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
          disabled={pending}
          className="ui-button-primary"
        >
          {pending
            ? "Saving..."
            : building
              ? "Save changes"
              : "Add building"}
        </button>
      </div>
    </form>
  );
}

export default function BuildingManager({
  token,
  buildings,
  setBuildings,
  users,
  canManage,
}) {
  const notify = useToast();
  const [editingBuilding, setEditingBuilding] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteBuilding, setDeleteBuilding] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  function startCreate() {
    setEditingBuilding(null);
    setFormOpen(true);
  }

  function startEdit(building) {
    setEditingBuilding(building);
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

  const visibleBuildings = buildings.filter((building) =>
    building.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function saveBuilding(input) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const isEditing = Boolean(editingBuilding);
      const result = await request(
        isEditing
          ? `/admin/buildings/${encodeURIComponent(editingBuilding.id)}`
          : "/admin/buildings",
        token,
        {
          method: isEditing ? "PATCH" : "POST",
          body: JSON.stringify(input),
        },
      );
      if (!result?.building)
        throw new Error("The server did not confirm the building was saved.");

      setBuildings((current) => {
        const next = isEditing
          ? current.map((item) =>
              item.id === result.building.id ? result.building : item,
            )
          : [...current, result.building];
        return next.sort((first, second) =>
          first.name.localeCompare(second.name),
        );
      });
      setFormOpen(false);
      setEditingBuilding(null);
      notify(isEditing ? "Building updated." : "Building added.", "success");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function removeBuilding() {
    if (!deleteBuilding || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await request(
        `/admin/buildings/${encodeURIComponent(deleteBuilding.id)}`,
        token,
        { method: "DELETE" },
      );
      setBuildings((current) =>
        current.filter((item) => item.id !== deleteBuilding.id),
      );
      setDeleteBuilding(null);
      notify("Building deleted.", "success");
    } catch (error) {
      notify(error.message || "Could not delete this building.", "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col items-stretch justify-between gap-4 sm:mb-7 sm:flex-row sm:items-end">
        <div>
          <h1 className="ui-page-title">Buildings</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Manage work locations and their attendance settings.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={startCreate}
            className="ui-button-primary w-full sm:w-auto"
          >
            + Add building
          </button>
        )}
      </div>

      <section>
        <div className="ui-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="ui-section-title">All buildings</h2>
              <p className="mt-1 text-sm text-slate-500">
                {buildings.length} {buildings.length === 1 ? "location" : "locations"}
              </p>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Search buildings by name</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search buildings"
                className="ui-input"
              />
            </label>
          </div>
          <div className="divide-y divide-slate-100 xl:hidden">
            {visibleBuildings.map((building) => {
              const workerCount = users.filter(
                (worker) =>
                  worker.role === "WORKER" &&
                  worker.building_id === building.id,
              ).length;
              const hasWorkers = workerCount > 0;

              return (
                <article key={building.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-slate-900">
                        {building.name}
                      </h3>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(building.latitude)}&mlon=${encodeURIComponent(building.longitude)}#map=17/${encodeURIComponent(building.latitude)}/${encodeURIComponent(building.longitude)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex min-h-10 items-center text-sm font-medium text-blue-700 hover:underline"
                      >
                        View map location
                      </a>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {workerCount} {workerCount === 1 ? "worker" : "workers"}
                    </span>
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {canManage ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(building)}
                            className="min-h-10 rounded-md px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={hasWorkers}
                            aria-label={
                              hasWorkers
                                ? `Delete ${building.name} (reassign workers first)`
                                : `Delete ${building.name}`
                            }
                            onClick={() => setDeleteBuilding(building)}
                            className="min-h-10 rounded-md px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                          >
                            Delete
                          </button>
                        </div>
                        {hasWorkers && (
                          <p className="mt-1 px-3 text-xs text-slate-500">
                            Reassign {workerCount}{" "}
                            {workerCount === 1 ? "worker" : "workers"} to enable
                            deletion.
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="px-3 text-sm text-slate-500">
                        View only
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
            {buildings.length === 0 && (
              <div className="px-5 py-10 text-center">
                <p className="font-medium text-slate-800">No buildings yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Create a building to set up a work location.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={startCreate}
                    className="ui-button-primary mt-4"
                  >
                    + Add building
                  </button>
                )}
              </div>
            )}
            {buildings.length > 0 && visibleBuildings.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                No buildings match “{search}”.
              </p>
            )}
          </div>
          <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[650px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                {["Building", "Assigned workers", "Actions"].map(
                  (heading) => (
                    <th key={heading} className="px-5 py-3.5 font-medium">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visibleBuildings.map((building) => {
                const workerCount = users.filter(
                  (worker) =>
                    worker.role === "WORKER" &&
                    worker.building_id === building.id,
                ).length;
                const hasWorkers = workerCount > 0;
                return (
                  <tr key={building.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-900">{building.name}</p>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(building.latitude)}&mlon=${encodeURIComponent(building.longitude)}#map=17/${encodeURIComponent(building.latitude)}/${encodeURIComponent(building.longitude)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex text-xs font-medium text-blue-700 hover:underline"
                      >
                        View map location
                      </a>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {workerCount} {workerCount === 1 ? "worker" : "workers"}
                    </td>
                    <td className="px-5 py-4">
                      {canManage ? (
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(building)}
                            className="rounded px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={hasWorkers}
                            aria-label={
                              hasWorkers
                                ? `Delete ${building.name} (reassign workers first)`
                                : `Delete ${building.name}`
                            }
                            title={
                              hasWorkers
                                ? `${workerCount} assigned ${workerCount === 1 ? "worker" : "workers"} must be reassigned before deletion.`
                                : undefined
                            }
                            onClick={() => setDeleteBuilding(building)}
                            className="rounded px-2 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                          >
                            Delete
                          </button>
                          </div>
                          {hasWorkers && (
                            <span className="text-xs text-slate-500">
                              Reassign {workerCount}{" "}
                              {workerCount === 1 ? "worker" : "workers"} to enable deletion.
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-ink/40">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {buildings.length === 0 && (
                <tr>
                  <td colSpan="3" className="px-5 py-14 text-center">
                    <p className="font-medium text-slate-800">No buildings yet</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Create a building to set up a work location.
                    </p>
                    {canManage && (
                      <button
                        type="button"
                        onClick={startCreate}
                        className="ui-button-primary mt-4"
                      >
                        + Add building
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {buildings.length > 0 && visibleBuildings.length === 0 && (
                <tr>
                  <td colSpan="3" className="px-5 py-12 text-center text-sm text-slate-500">
                    No buildings match “{search}”.
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
          title={editingBuilding ? "Edit building" : "Add a building"}
          description="Set the work location, geofence radius, and local timezone."
          onClose={() => {
            if (!savingRef.current) {
              setFormOpen(false);
              setEditingBuilding(null);
            }
          }}
          pending={saving}
        >
          <BuildingForm
            key={editingBuilding?.id ?? "new"}
            building={editingBuilding}
            onSave={saveBuilding}
            onCancel={() => {
              setFormOpen(false);
              setEditingBuilding(null);
            }}
            pending={saving}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(deleteBuilding)}
        title="Delete building?"
        description={
          deleteBuilding
            ? `“${deleteBuilding.name}” will be permanently deleted. Buildings with assigned workers or attendance history cannot be deleted.`
            : ""
        }
        confirmLabel="Delete building"
        pending={deleting}
        onCancel={() => {
          if (!deletingRef.current) setDeleteBuilding(null);
        }}
        onConfirm={removeBuilding}
      />
    </>
  );
}
