"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AttributionControl,
  GPUInitializationError,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type IControl,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AtlasNode, AtlasPlace, Place, Theme } from "@/lib/atlas-types";
import { DOT_COLORS_BY_THEME, loadAtlasMapStyle, SPACE_COLOR_BY_THEME } from "@/lib/map-style";
import NodePlayButton from "./NodePlayButton";
import type { PlaybackStatus } from "./useNarration";

// MapLibre 6 runs its tile parsing in a worker that the bundler has to emit as an asset.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export type PlaceGroup = { place: Place; nodes: AtlasNode[] };

export type CameraRequest = {
  // A fresh id per request lets the same destination be flown to again after panning away.
  requestId: number;
  target: { kind: "place"; place: Place } | { kind: "overview" };
};

type AtlasMapProps = {
  theme: Theme;
  placeGroups: PlaceGroup[];
  places: AtlasPlace[];
  showPlaces: boolean;
  openPlaceName: string | null;
  selectedNodeId: string | null;
  playingNodeId: string | null;
  playbackStatus: PlaybackStatus;
  cameraRequest: CameraRequest | null;
  onMarkerSelect: (placeName: string) => void;
  onPopupClosed: () => void;
  onPlayNode: (nodeId: string) => void;
};

// Centred so that every office, from Milan to Sydney, stays well inside the visible
// hemisphere instead of sitting on the globe's edge.
const OVERVIEW_CENTER: [number, number] = [80, 8];
const PLACE_ZOOM = 9;
const MAX_ZOOM = 17;
const FLY_DURATION_MS = 2400;
const RESET_DURATION_MS = 1600;

// At zoom 0 the globe is 512 / pi px across and doubles with every zoom level. The camera's
// perspective makes the visible disc about 16% smaller than that, so the fill factor is
// above 1 to land the disc at roughly 90% of the pane's shorter side.
const GLOBE_DIAMETER_AT_ZOOM_ZERO_PX = 512 / Math.PI;
const OVERVIEW_GLOBE_FILL = 1.05;

const EVENTS_SOURCE = "atlas-events";
const PLACES_SOURCE = "atlas-places";
const LAYER_EVENT_GLOW = "atlas-events-glow";
const LAYER_EVENT_RING = "atlas-events-ring";
const LAYER_EVENT_DOT = "atlas-events-dot";
const LAYER_PLACE_CLUSTERS = "atlas-places-clusters";
const LAYER_PLACE_CLUSTER_COUNT = "atlas-places-cluster-count";
const LAYER_PLACE_OFFICE = "atlas-places-office";
const LAYER_PLACE_COMMUNITY = "atlas-places-community";
const PLACE_LAYERS = [
  LAYER_PLACE_CLUSTERS,
  LAYER_PLACE_CLUSTER_COUNT,
  LAYER_PLACE_OFFICE,
  LAYER_PLACE_COMMUNITY,
];
const CLICKABLE_LAYERS = [LAYER_EVENT_DOT, LAYER_PLACE_CLUSTERS, LAYER_PLACE_OFFICE, LAYER_PLACE_COMMUNITY];

function overviewZoomFor(container: HTMLElement): number {
  const smallerSide = Math.min(container.clientWidth, container.clientHeight);
  const zoomThatFits = Math.log2((smallerSide * OVERVIEW_GLOBE_FILL) / GLOBE_DIAMETER_AT_ZOOM_ZERO_PX);
  return Math.min(3, Math.max(0.6, zoomThatFits));
}

class ResetViewControl implements IControl {
  private readonly onReset: () => void;
  private container: HTMLDivElement | null = null;

  constructor(onReset: () => void) {
    this.onReset = onReset;
  }

  onAdd() {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    const icon = document.createElement("span");
    icon.className = "maplibregl-ctrl-icon";
    icon.setAttribute("aria-hidden", "true");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "atlas-reset-view";
    button.title = "Reset view";
    button.setAttribute("aria-label", "Reset view");
    button.addEventListener("click", this.onReset);
    button.append(icon);

    container.append(button);
    this.container = container;
    return container;
  }

  onRemove() {
    this.container?.remove();
    this.container = null;
  }
}

type DotData = {
  eventGroups: PlaceGroup[];
  places: AtlasPlace[];
  openPlaceName: string | null;
};

const isCommunity = (place: AtlasPlace) => place.kind.toLowerCase().includes("communit");

function eventsGeoJson({ eventGroups, openPlaceName }: DotData) {
  return {
    type: "FeatureCollection" as const,
    features: eventGroups.map((group) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [group.place.lon, group.place.lat] },
      properties: {
        placeName: group.place.name,
        count: group.nodes.length,
        isOpen: group.place.name === openPlaceName ? 1 : 0,
      },
    })),
  };
}

function placesGeoJson({ places }: DotData) {
  return {
    type: "FeatureCollection" as const,
    features: places
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon))
      .map((place) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
        properties: { id: place.id, kind: isCommunity(place) ? "community" : "office" },
      })),
  };
}

// Sources and layers live in the style, so every style swap (theme change) wipes them and
// they are added again here. The dots are circle layers, drawn on the globe surface by the
// renderer, so they hide behind the horizon instead of floating off the globe like DOM markers.
function installAtlasLayers(map: MapLibreMap, theme: Theme, data: DotData, showPlaces: boolean) {
  const colors = DOT_COLORS_BY_THEME[theme];
  const textFont = map
    .getStyle()
    .layers.map((layer) => (layer.type === "symbol" ? layer.layout?.["text-font"] : undefined))
    .find((font): font is string[] => Array.isArray(font)) ?? ["Noto Sans Regular"];

  map.addSource(EVENTS_SOURCE, { type: "geojson", data: eventsGeoJson(data) });
  map.addSource(PLACES_SOURCE, {
    type: "geojson",
    data: placesGeoJson(data),
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 6,
  });

  const isOpen: ExpressionSpecification = ["==", ["get", "isOpen"], 1];
  const isOffice: ExpressionSpecification = ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "office"]];
  const isCommunityPlace: ExpressionSpecification = [
    "all",
    ["!", ["has", "point_count"]],
    ["==", ["get", "kind"], "community"],
  ];

  map.addLayer({
    id: LAYER_PLACE_CLUSTERS,
    type: "circle",
    source: PLACES_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": colors.office,
      "circle-opacity": 0.9,
      "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 20, 24] as ExpressionSpecification,
      "circle-stroke-width": 2,
      "circle-stroke-color": colors.stroke,
    },
  });
  map.addLayer({
    id: LAYER_PLACE_CLUSTER_COUNT,
    type: "symbol",
    source: PLACES_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"] as ExpressionSpecification,
      "text-font": textFont,
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: { "text-color": colors.clusterText },
  });
  map.addLayer({
    id: LAYER_PLACE_OFFICE,
    type: "circle",
    source: PLACES_SOURCE,
    filter: isOffice,
    paint: {
      "circle-color": colors.stroke,
      "circle-radius": 6.5,
      "circle-stroke-width": 3,
      "circle-stroke-color": colors.office,
    },
  });
  map.addLayer({
    id: LAYER_PLACE_COMMUNITY,
    type: "circle",
    source: PLACES_SOURCE,
    filter: isCommunityPlace,
    paint: {
      "circle-color": colors.community,
      "circle-radius": 6,
      "circle-stroke-width": 2,
      "circle-stroke-color": colors.stroke,
    },
  });

  map.addLayer({
    id: LAYER_EVENT_GLOW,
    type: "circle",
    source: EVENTS_SOURCE,
    paint: {
      "circle-color": colors.event,
      "circle-opacity": 0.22,
      "circle-blur": 0.8,
      "circle-radius": ["case", isOpen, 24, 16] as ExpressionSpecification,
    },
  });
  map.addLayer({
    id: LAYER_EVENT_RING,
    type: "circle",
    source: EVENTS_SOURCE,
    filter: isOpen,
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": 15,
      "circle-stroke-width": 2,
      "circle-stroke-color": colors.event,
    },
  });
  map.addLayer({
    id: LAYER_EVENT_DOT,
    type: "circle",
    source: EVENTS_SOURCE,
    paint: {
      "circle-color": ["case", isOpen, colors.ink, colors.event] as ExpressionSpecification,
      "circle-radius": ["case", isOpen, 9, 7] as ExpressionSpecification,
      "circle-stroke-width": 2,
      "circle-stroke-color": ["case", isOpen, colors.event, colors.stroke] as ExpressionSpecification,
    },
  });

  for (const layerId of PLACE_LAYERS) {
    map.setLayoutProperty(layerId, "visibility", showPlaces ? "visible" : "none");
  }
}

function PlaceEntryPopupContent({ place }: { place: AtlasPlace }) {
  const location = [place.city, place.country].filter(Boolean).join(", ");
  return (
    <div className="w-64 max-w-full">
      <p className="pr-6 font-mono text-[11px] uppercase tracking-widest text-muted">
        {isCommunity(place) ? "Community" : "Office"}
      </p>
      <p className="mt-2 text-sm font-medium leading-snug">{place.name}</p>
      {location && <p className="mt-0.5 text-xs text-muted">{location}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {place.site && (
          <a
            href={place.site}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            site
          </a>
        )}
        {place.source_url && (
          <a
            href={place.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            source
          </a>
        )}
      </div>
    </div>
  );
}

type PlacePopupContentProps = {
  group: PlaceGroup;
  selectedNodeId: string | null;
  playingNodeId: string | null;
  playbackStatus: PlaybackStatus;
  onPlayNode: (nodeId: string) => void;
};

function PlacePopupContent({
  group,
  selectedNodeId,
  playingNodeId,
  playbackStatus,
  onPlayNode,
}: PlacePopupContentProps) {
  return (
    <div className="w-64 max-w-full">
      <p className="pr-6 font-mono text-[11px] uppercase tracking-widest text-muted">
        {group.place.name}
      </p>
      <ul className="mt-2 flex max-h-56 flex-col gap-3 overflow-y-auto">
        {group.nodes.map((node) => (
          <li
            key={node.id}
            className={`border-l-2 pl-3 ${
              node.id === selectedNodeId ? "border-accent" : "border-hair"
            }`}
          >
            <time dateTime={node.date} className="font-mono text-xs text-muted">
              {node.date}
            </time>
            <p className="mt-1 text-sm leading-snug">{node.title}</p>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <NodePlayButton
                nodeTitle={node.title}
                status={playingNodeId === node.id ? playbackStatus : "idle"}
                onClick={() => onPlayNode(node.id)}
              />
              <a
                href={node.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                source
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AtlasMap({
  theme,
  placeGroups,
  places,
  showPlaces,
  openPlaceName,
  selectedNodeId,
  playingNodeId,
  playbackStatus,
  cameraRequest,
  onMarkerSelect,
  onPopupClosed,
  onPlayNode,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const isClosingPopupFromCodeRef = useRef(false);
  const lastFlownRequestIdRef = useRef(0);
  const appliedThemeRef = useRef<Theme>(theme);

  // Style swaps rebuild the layers from the latest data, which the effects below keep current.
  const latestDotDataRef = useRef<DotData>({ eventGroups: placeGroups, places, openPlaceName });
  const latestShowPlacesRef = useRef(showPlaces);
  const initialThemeRef = useRef(theme);

  // Bumped each time the style's layers have been (re)installed.
  const [layersVersion, setLayersVersion] = useState(0);
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);
  const [openPlaceEntryId, setOpenPlaceEntryId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Callbacks read through refs so the map is created once and never rebuilt for a new closure.
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const onPopupClosedRef = useRef(onPopupClosed);
  useEffect(() => {
    onMarkerSelectRef.current = onMarkerSelect;
    onPopupClosedRef.current = onPopupClosed;
  }, [onMarkerSelect, onPopupClosed]);

  useEffect(() => {
    latestDotDataRef.current = { eventGroups: placeGroups, places, openPlaceName };
    latestShowPlacesRef.current = showPlaces;
  }, [placeGroups, places, openPlaceName, showPlaces]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortStyleRequest = new AbortController();
    let map: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let isDisposed = false;

    (async () => {
      let style: StyleSpecification;
      try {
        style = await loadAtlasMapStyle(initialThemeRef.current, abortStyleRequest.signal);
      } catch {
        if (!isDisposed) setLoadError("The map tiles could not be loaded. Check your connection and reload.");
        return;
      }
      if (isDisposed) return;

      try {
        map = new MapLibreMap({
          container,
          style,
          center: OVERVIEW_CENTER,
          zoom: overviewZoomFor(container),
          maxZoom: MAX_ZOOM,
          attributionControl: false,
        });
      } catch (error) {
        setLoadError(
          error instanceof GPUInitializationError
            ? "This device does not support WebGL 2, which the globe needs."
            : "The globe could not start on this device.",
        );
        return;
      }
      const createdMap = map;

      const flyToOverview = () => {
        createdMap.flyTo({
          center: OVERVIEW_CENTER,
          zoom: overviewZoomFor(container),
          bearing: 0,
          pitch: 0,
          duration: RESET_DURATION_MS,
        });
      };

      createdMap.addControl(new NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), "top-right");
      createdMap.addControl(new ResetViewControl(flyToOverview), "top-right");
      createdMap.addControl(new AttributionControl({ compact: true }), "bottom-right");

      const popup = new Popup({
        closeButton: true,
        closeOnClick: false,
        closeOnMove: false,
        offset: 18,
        maxWidth: "none",
        className: "atlas-popup",
      });
      const popupContent = document.createElement("div");
      popup.setDOMContent(popupContent);
      popup.on("close", () => {
        if (isClosingPopupFromCodeRef.current) return;
        setOpenPlaceEntryId(null);
        onPopupClosedRef.current();
      });

      // Delegated handlers are keyed by layer id, so they keep working after the layers are
      // re-added by a theme change.
      createdMap.on("click", LAYER_EVENT_DOT, (event) => {
        const placeName = event.features?.[0]?.properties?.placeName;
        if (typeof placeName !== "string") return;
        setOpenPlaceEntryId(null);
        onMarkerSelectRef.current(placeName);
      });
      for (const layerId of [LAYER_PLACE_OFFICE, LAYER_PLACE_COMMUNITY]) {
        createdMap.on("click", layerId, (event) => {
          const placeId = event.features?.[0]?.properties?.id;
          if (typeof placeId !== "string") return;
          setOpenPlaceEntryId(placeId);
          onPopupClosedRef.current();
        });
      }
      createdMap.on("click", LAYER_PLACE_CLUSTERS, async (event) => {
        const cluster: MapGeoJSONFeature | undefined = event.features?.[0];
        if (!cluster || cluster.geometry.type !== "Point") return;
        const source = createdMap.getSource(PLACES_SOURCE) as GeoJSONSource | undefined;
        const zoom = await source?.getClusterExpansionZoom(Number(cluster.properties.cluster_id));
        if (zoom === undefined) return;
        const [lon, lat] = cluster.geometry.coordinates;
        createdMap.easeTo({ center: [lon, lat], zoom: zoom + 0.4 });
      });
      for (const layerId of CLICKABLE_LAYERS) {
        createdMap.on("mouseenter", layerId, () => {
          createdMap.getCanvas().style.cursor = "pointer";
        });
        createdMap.on("mouseleave", layerId, () => {
          createdMap.getCanvas().style.cursor = "";
        });
      }

      resizeObserver = new ResizeObserver(() => createdMap.resize());
      resizeObserver.observe(container);

      mapRef.current = createdMap;
      popupRef.current = popup;
      setPopupContainer(popupContent);

      createdMap.once("load", () => {
        installAtlasLayers(
          createdMap,
          initialThemeRef.current,
          latestDotDataRef.current,
          latestShowPlacesRef.current,
        );
        setLayersVersion((version) => version + 1);
      });
    })();

    return () => {
      isDisposed = true;
      abortStyleRequest.abort();
      resizeObserver?.disconnect();
      popupRef.current = null;
      mapRef.current = null;
      map?.remove();
      setLayersVersion(0);
      setPopupContainer(null);
    };
  }, []);

  // Theme change: swap the base style, then put the dot layers back on top of it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || layersVersion === 0 || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;

    const abortStyleRequest = new AbortController();
    loadAtlasMapStyle(theme, abortStyleRequest.signal)
      .then((style) => {
        if (mapRef.current !== map) return;
        map.once("style.load", () => {
          installAtlasLayers(map, theme, latestDotDataRef.current, latestShowPlacesRef.current);
          setLayersVersion((version) => version + 1);
        });
        map.setStyle(style, { diff: false });
      })
      .catch(() => undefined);
    return () => abortStyleRequest.abort();
  }, [theme, layersVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || layersVersion === 0) return;
    (map.getSource(EVENTS_SOURCE) as GeoJSONSource | undefined)?.setData(
      eventsGeoJson({ eventGroups: placeGroups, places, openPlaceName }),
    );
    (map.getSource(PLACES_SOURCE) as GeoJSONSource | undefined)?.setData(
      placesGeoJson({ eventGroups: placeGroups, places, openPlaceName }),
    );
  }, [layersVersion, placeGroups, places, openPlaceName]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || layersVersion === 0) return;
    for (const layerId of PLACE_LAYERS) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", showPlaces ? "visible" : "none");
      }
    }
  }, [layersVersion, showPlaces]);

  const openGroup = placeGroups.find((group) => group.place.name === openPlaceName) ?? null;
  const openPlaceEntry = openGroup ? null : (places.find((place) => place.id === openPlaceEntryId) ?? null);
  const popupAnchor = useMemo(
    () =>
      openGroup
        ? { lon: openGroup.place.lon, lat: openGroup.place.lat }
        : openPlaceEntry
          ? { lon: openPlaceEntry.lon, lat: openPlaceEntry.lat }
          : null,
    [openGroup, openPlaceEntry],
  );

  useEffect(() => {
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup || layersVersion === 0) return;

    if (popupAnchor) {
      popup.setLngLat([popupAnchor.lon, popupAnchor.lat]);
      if (!popup.isOpen()) popup.addTo(map);
    } else if (popup.isOpen()) {
      isClosingPopupFromCodeRef.current = true;
      popup.remove();
      isClosingPopupFromCodeRef.current = false;
    }
  }, [layersVersion, popupAnchor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || layersVersion === 0 || !cameraRequest) return;
    if (cameraRequest.requestId === lastFlownRequestIdRef.current) return;
    lastFlownRequestIdRef.current = cameraRequest.requestId;

    if (cameraRequest.target.kind === "place") {
      const { place } = cameraRequest.target;
      map.flyTo({
        center: [place.lon, place.lat],
        zoom: PLACE_ZOOM,
        bearing: 0,
        pitch: 0,
        duration: FLY_DURATION_MS,
        curve: 1.6,
      });
    } else if (containerRef.current) {
      map.flyTo({
        center: OVERVIEW_CENTER,
        zoom: overviewZoomFor(containerRef.current),
        bearing: 0,
        pitch: 0,
        duration: FLY_DURATION_MS,
      });
    }
  }, [layersVersion, cameraRequest]);

  return (
    <div
      role="region"
      aria-label="Interactive globe map. Drag to rotate, scroll or pinch to zoom."
      className="atlas-map absolute inset-0"
    >
      <div ref={containerRef} className="size-full" style={{ backgroundColor: SPACE_COLOR_BY_THEME[theme] }} />
      {loadError && (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          {loadError}
        </p>
      )}
      {popupContainer &&
        openGroup &&
        createPortal(
          <PlacePopupContent
            group={openGroup}
            selectedNodeId={selectedNodeId}
            playingNodeId={playingNodeId}
            playbackStatus={playbackStatus}
            onPlayNode={onPlayNode}
          />,
          popupContainer,
        )}
      {popupContainer && openPlaceEntry && createPortal(<PlaceEntryPopupContent place={openPlaceEntry} />, popupContainer)}
    </div>
  );
}
