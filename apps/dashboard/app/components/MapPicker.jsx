"use client";

import { useEffect, useRef, useState } from "react";
import tzlookup from "tz-lookup";

export default function MapPicker({
  lat,
  lng,
  radius,
  onPick,
  onTimeZoneChange,
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [findingLocation, setFindingLocation] = useState(false);
  const [searchError, setSearchError] = useState("");
  const element = useRef(null);
  const map = useRef(null);
  const leaflet = useRef(null);
  const pin = useRef(null);
  const area = useRef(null);
  const latest = useRef({ lat, lng, radius, onPick, onTimeZoneChange });
  latest.current = { lat, lng, radius, onPick, onTimeZoneChange };

  async function searchLocation(event) {
    event?.preventDefault();
    const search = query.trim();
    if (!search) return;

    setSearching(true);
    setSearchError("");
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(search)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok)
        throw new Error("Location search is temporarily unavailable.");
      const [result] = await response.json();
      if (!result)
        throw new Error("No matching place found. Try a fuller address.");
      latest.current.onPick(Number(result.lat), Number(result.lon));
    } catch (error) {
      setSearchError(error.message || "Could not search for that location.");
    } finally {
      setSearching(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setSearchError("Location access is not available in this browser.");
      return;
    }

    setFindingLocation(true);
    setSearchError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        latest.current.onPick(coords.latitude, coords.longitude);
        setFindingLocation(false);
      },
      (error) => {
        setSearchError(
          error.code === error.PERMISSION_DENIED
            ? "Allow location access in your browser to use your current location."
            : "Could not determine your location. Search for an address or pick it on the map.",
        );
        setFindingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  const sync = () => {
    const currentMap = map.current;
    const library = leaflet.current;
    if (!currentMap || !library) return;

    pin.current?.remove();
    area.current?.remove();
    pin.current = null;
    area.current = null;

    const {
      lat: currentLat,
      lng: currentLng,
      radius: currentRadius,
    } = latest.current;
    if (currentLat == null || currentLng == null) return;

    area.current = library
      .circle([currentLat, currentLng], {
        radius: currentRadius,
        color: "#1d2925",
        weight: 2,
        fillColor: "#dd593e",
        fillOpacity: 0.2,
      })
      .addTo(currentMap);
    pin.current = library
      .circleMarker([currentLat, currentLng], {
        radius: 7,
        color: "#1d2925",
        weight: 2,
        fillColor: "#dd593e",
        fillOpacity: 1,
      })
      .addTo(currentMap);

    if (currentMap.getZoom() < 15)
      currentMap.setView([currentLat, currentLng], 17);
    else if (!currentMap.getBounds().contains([currentLat, currentLng])) {
      currentMap.panTo([currentLat, currentLng]);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const library = await import("leaflet");
      if (cancelled || !element.current || map.current) return;

      leaflet.current = library;
      const start = latest.current;
      const hasLocation = start.lat != null && start.lng != null;
      const currentMap = library
        .map(element.current)
        .setView(
          hasLocation ? [start.lat, start.lng] : [30, 20],
          hasLocation ? 17 : 3,
        );

      library
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        })
        .addTo(currentMap);
      currentMap.on("click", (event) =>
        latest.current.onPick(event.latlng.lat, event.latlng.lng),
      );
      map.current = currentMap;
      sync();

      if (typeof ResizeObserver !== "undefined") {
        const resizeObserver = new ResizeObserver(() =>
          currentMap.invalidateSize(),
        );
        resizeObserver.observe(element.current);
        currentMap.once("unload", () => resizeObserver.disconnect());
      }
    }

    initialize();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    sync();
  }, [lat, lng, radius]);

  useEffect(() => {
    if (
      lat == null ||
      lng == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      latest.current.onTimeZoneChange?.("");
      return;
    }

    try {
      latest.current.onTimeZoneChange?.(tzlookup(lat, lng));
    } catch {
      latest.current.onTimeZoneChange?.("");
    }
  }, [lat, lng]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          aria-label="Search for a building address or place"
          className="ui-input min-w-0 flex-1"
          placeholder="Search address, city, or place"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") searchLocation(event);
          }}
        />
        <button
          type="button"
          disabled={searching || !query.trim()}
          onClick={searchLocation}
          className="ui-button-secondary shrink-0"
        >
          {searching ? "Searching..." : "Search"}
        </button>
        <button
          type="button"
          disabled={findingLocation}
          onClick={useMyLocation}
          className="ui-button-secondary shrink-0"
        >
          {findingLocation ? "Finding..." : "Use my location"}
        </button>
      </div>
      {searchError && (
        <p role="alert" className="mb-2 text-sm text-signal">
          {searchError}
        </p>
      )}
      <div
        ref={element}
        className="isolate h-64 w-full rounded-md border border-slate-200 sm:h-80"
        role="application"
        aria-label="Map: click to place the building location"
      />
    </div>
  );
}
