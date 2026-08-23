const EARTH_RADIUS_M = 6371008.8;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/** Great-circle distance in metres between two WGS84 coordinates. */
export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LocationCheckInput {
  customer: Coordinates;
  restaurant: Coordinates;
  radiusMeters: number;
  /** Browser-reported accuracy in metres; widens the radius so honest GPS drift is not punished. */
  accuracyMeters?: number | null;
  /** Ceiling on how much slack a low-accuracy reading can buy. */
  maxAccuracySlackMeters?: number;
}

export interface LocationCheckResult {
  distanceMeters: number;
  effectiveRadiusMeters: number;
  withinRadius: boolean;
  accuracyMeters: number | null;
}

export function checkLocation(input: LocationCheckInput): LocationCheckResult {
  const {
    customer,
    restaurant,
    radiusMeters,
    accuracyMeters = null,
    maxAccuracySlackMeters = 150,
  } = input;

  const distance = haversineDistanceMeters(customer, restaurant);
  const slack =
    accuracyMeters && accuracyMeters > 0 ? Math.min(accuracyMeters, maxAccuracySlackMeters) : 0;
  const effectiveRadius = radiusMeters + slack;

  return {
    distanceMeters: Math.round(distance),
    effectiveRadiusMeters: Math.round(effectiveRadius),
    withinRadius: distance <= effectiveRadius,
    accuracyMeters: accuracyMeters ?? null,
  };
}

export function isValidCoordinate(c: Partial<Coordinates> | null | undefined): c is Coordinates {
  if (!c) return false;
  const { latitude, longitude } = c;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
