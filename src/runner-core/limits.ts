export const DEFAULT_MAX_TEXT_LENGTH = 4000;
export const DEFAULT_MAX_ELEMENTS = 50;
export const DEFAULT_MAX_CONSOLE_ERRORS = 20;
export const DEFAULT_MAX_NETWORK_ERRORS = 20;
export const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1024 * 1024;

export function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function positiveInt(value: unknown, fallback: number): number {
  const parsed = toOptionalNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

export function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = positiveInt(value, fallback);
  return Math.min(max, Math.max(min, parsed));
}
