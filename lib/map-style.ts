import type { StyleSpecification } from "maplibre-gl";
import type { Theme } from "./atlas-types";

// OpenFreeMap is free, keyless and has no usage limits; attribution is carried by the
// style's own sources and shown by the map's attribution control.
const OPENFREEMAP_STYLE_URLS: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

// Claude palette. Land is a step lighter than the page canvas (#141413) so the globe reads
// as an object against space, and water takes the sky blue (#6a9bcc) at very low lightness.
const COLORS = {
  space: "#141413",
  land: "#22211e",
  landLifted: "#272622",
  water: "#0f1a23",
  waterLine: "#1c3243",
  waterLabel: "#6a9bcc",
  wood: "#252c1f",
  park: "#2a3323",
  ice: "#2f3233",
  building: "#2b2a27",
  buildingOutline: "#383733",
  roadMinor: "#3b3a36",
  roadMajorCasing: "#524f47",
  roadMajorFill: "#1b1a18",
  roadMotorwayCasing: "#6a6558",
  roadMotorwayFill: "#161513",
  rail: "#3b3a35",
  boundaryState: "#46443e",
  boundaryCountry: "#8a877d",
  labelMinor: "#8f8d85",
  labelPlace: "#b0aea5",
  labelCity: "#e8e6dc",
  labelCountry: "#faf9f5",
  halo: "#141413",
};

type PaintColors = Record<string, string>;

// Keyed by OpenFreeMap layer id. A layer that is missing from the fetched style (the
// style changed upstream) is simply skipped and keeps its original look.
const PAINT_COLORS_BY_LAYER_ID: Record<string, PaintColors> = {
  background: { "background-color": COLORS.land },
  water: { "fill-color": COLORS.water },
  waterway: { "line-color": COLORS.waterLine },
  water_name: { "text-color": COLORS.waterLabel, "text-halo-color": COLORS.water },
  landcover_ice_shelf: { "fill-color": COLORS.ice },
  landcover_glacier: { "fill-color": COLORS.ice },
  landuse_residential: { "fill-color": COLORS.landLifted },
  landcover_wood: { "fill-color": COLORS.wood },
  landuse_park: { "fill-color": COLORS.park },
  building: { "fill-color": COLORS.building, "fill-outline-color": COLORS.buildingOutline },
  "aeroway-taxiway": { "line-color": COLORS.roadMinor },
  "aeroway-runway-casing": { "line-color": COLORS.roadMajorCasing },
  "aeroway-area": { "fill-color": COLORS.landLifted },
  "aeroway-runway": { "line-color": COLORS.roadMajorFill },
  road_area_pier: { "fill-color": COLORS.land },
  road_pier: { "line-color": COLORS.land },
  highway_path: { "line-color": COLORS.roadMinor },
  highway_minor: { "line-color": COLORS.roadMinor },
  highway_major_casing: { "line-color": COLORS.roadMajorCasing },
  highway_major_inner: { "line-color": COLORS.roadMajorFill },
  highway_major_subtle: { "line-color": COLORS.roadMinor },
  highway_motorway_casing: { "line-color": COLORS.roadMotorwayCasing },
  highway_motorway_inner: { "line-color": COLORS.roadMotorwayFill },
  highway_motorway_subtle: { "line-color": COLORS.roadMajorCasing },
  railway_transit: { "line-color": COLORS.rail },
  railway_transit_dashline: { "line-color": COLORS.land },
  railway_minor: { "line-color": COLORS.rail },
  railway_minor_dashline: { "line-color": COLORS.land },
  railway: { "line-color": COLORS.rail },
  railway_dashline: { "line-color": COLORS.land },
  highway_name_other: { "text-color": COLORS.labelMinor, "text-halo-color": COLORS.halo },
  highway_name_motorway: { "text-color": COLORS.labelPlace, "text-halo-color": COLORS.halo },
  boundary_state: { "line-color": COLORS.boundaryState },
  "boundary_country_z0-4": { "line-color": COLORS.boundaryCountry },
  "boundary_country_z5-": { "line-color": COLORS.boundaryCountry },
  place_other: { "text-color": COLORS.labelMinor, "text-halo-color": COLORS.halo },
  place_suburb: { "text-color": COLORS.labelMinor, "text-halo-color": COLORS.halo },
  place_village: { "text-color": COLORS.labelPlace, "text-halo-color": COLORS.halo },
  place_town: { "text-color": COLORS.labelPlace, "text-halo-color": COLORS.halo },
  place_city: { "text-color": COLORS.labelCity, "text-halo-color": COLORS.halo },
  place_city_large: { "text-color": COLORS.labelCity, "text-halo-color": COLORS.halo },
  place_state: { "text-color": COLORS.labelMinor, "text-halo-color": COLORS.halo },
  place_country_other: { "text-color": COLORS.labelPlace, "text-halo-color": COLORS.halo },
  place_country_minor: { "text-color": COLORS.labelPlace, "text-halo-color": COLORS.halo },
  place_country_major: { "text-color": COLORS.labelCountry, "text-halo-color": COLORS.halo },
};

// The atmosphere glows around the globe when zoomed out and fades as the camera drops
// toward the surface, where a flat map takes over.
const ATMOSPHERE = {
  "sky-color": "#27465e",
  "horizon-color": "#3b5f79",
  "fog-color": COLORS.space,
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.5,
  "fog-ground-blend": 0.5,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
} as const;

// Light globe: OpenFreeMap's Positron (neutral, low-contrast) tinted toward the warm paper
// canvas (#faf9f5), with water at a pale sky blue and text in the ink colour.
const LIGHT_COLORS = {
  space: "#faf9f5",
  land: "#f1efe6",
  water: "#d3e0ea",
  waterLine: "#bdd0de",
  park: "#e4e6d3",
  wood: "#dde1cb",
  building: "#e8e5da",
  label: "#141413",
  labelMinor: "#5e5d59",
  halo: "#faf9f5",
};

const LIGHT_PAINT_COLORS_BY_LAYER_ID: Record<string, PaintColors> = {
  background: { "background-color": LIGHT_COLORS.land },
  park: { "fill-color": LIGHT_COLORS.park },
  water: { "fill-color": LIGHT_COLORS.water },
  waterway: { "line-color": LIGHT_COLORS.waterLine },
  landcover_wood: { "fill-color": LIGHT_COLORS.wood },
  landuse_residential: { "fill-color": LIGHT_COLORS.land },
  building: { "fill-color": LIGHT_COLORS.building },
  road_area_pier: { "fill-color": LIGHT_COLORS.land },
  road_pier: { "line-color": LIGHT_COLORS.land },
  water_name_point_label: { "text-color": "#4a6a85", "text-halo-color": LIGHT_COLORS.halo },
  water_name_line_label: { "text-color": "#4a6a85", "text-halo-color": LIGHT_COLORS.halo },
  label_other: { "text-color": LIGHT_COLORS.labelMinor, "text-halo-color": LIGHT_COLORS.halo },
  label_village: { "text-color": LIGHT_COLORS.labelMinor, "text-halo-color": LIGHT_COLORS.halo },
  label_town: { "text-color": LIGHT_COLORS.labelMinor, "text-halo-color": LIGHT_COLORS.halo },
  label_state: { "text-color": LIGHT_COLORS.labelMinor, "text-halo-color": LIGHT_COLORS.halo },
  label_city: { "text-color": LIGHT_COLORS.label, "text-halo-color": LIGHT_COLORS.halo },
  label_city_capital: { "text-color": LIGHT_COLORS.label, "text-halo-color": LIGHT_COLORS.halo },
  label_country_3: { "text-color": LIGHT_COLORS.label, "text-halo-color": LIGHT_COLORS.halo },
  label_country_2: { "text-color": LIGHT_COLORS.label, "text-halo-color": LIGHT_COLORS.halo },
  label_country_1: { "text-color": LIGHT_COLORS.label, "text-halo-color": LIGHT_COLORS.halo },
};

const LIGHT_ATMOSPHERE = {
  "sky-color": "#cfe0ee",
  "horizon-color": "#e8e6dc",
  "fog-color": LIGHT_COLORS.space,
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.5,
  "fog-ground-blend": 0.5,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
} as const;

function applyPaintOverrides(
  style: StyleSpecification,
  paintColorsByLayerId: Record<string, PaintColors>,
  atmosphere: object,
): StyleSpecification {
  const layers = style.layers.map((layer) => {
    const colors = paintColorsByLayerId[layer.id];
    if (!colors) return layer;
    return { ...layer, paint: { ...layer.paint, ...colors } } as typeof layer;
  });

  return {
    ...style,
    projection: { type: "globe" },
    sky: atmosphere as unknown as StyleSpecification["sky"],
    layers,
  };
}

export const applyClaudePalette = (openFreeMapStyle: StyleSpecification) =>
  applyPaintOverrides(openFreeMapStyle, PAINT_COLORS_BY_LAYER_ID, ATMOSPHERE);

export async function loadAtlasMapStyle(theme: Theme, signal?: AbortSignal): Promise<StyleSpecification> {
  const response = await fetch(OPENFREEMAP_STYLE_URLS[theme], { signal });
  if (!response.ok) {
    throw new Error(`OpenFreeMap style request failed with status ${response.status}`);
  }
  const style = (await response.json()) as StyleSpecification;
  return theme === "dark"
    ? applyClaudePalette(style)
    : applyPaintOverrides(style, LIGHT_PAINT_COLORS_BY_LAYER_ID, LIGHT_ATMOSPHERE);
}

export const SPACE_COLOR_BY_THEME: Record<Theme, string> = {
  dark: COLORS.space,
  light: LIGHT_COLORS.space,
};

// Dot colours per theme: events keep the accent; offices and communities get their own hues.
export const DOT_COLORS_BY_THEME: Record<
  Theme,
  { event: string; office: string; community: string; stroke: string; ink: string; clusterText: string }
> = {
  dark: {
    event: "#d97757",
    office: "#6a9bcc",
    community: "#788c5d",
    stroke: "#141413",
    ink: "#faf9f5",
    clusterText: "#141413",
  },
  light: {
    event: "#d97757",
    office: "#4a7fb0",
    community: "#5f7a42",
    stroke: "#faf9f5",
    ink: "#141413",
    clusterText: "#faf9f5",
  },
};
