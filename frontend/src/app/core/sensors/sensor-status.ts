import { Sensor } from '../../types/sensor';

/**
 * Status tier for a sensor reading relative to configured thresholds.
 * 'unknown' means no bounds are configured — widget renders without colour coding.
 */
export type StatusTier = 'normal' | 'warning' | 'critical' | 'unknown';

/**
 * Compute the status tier for a numeric reading value given the sensor's
 * configured threshold bands.  Critical bounds are checked first; if none
 * match, warning bounds are checked; otherwise 'normal' is returned.
 * Returns 'unknown' when the sensor has no bounds configured at all.
 */
export function statusOf(value: number, sensor: Sensor | null | undefined): StatusTier {
  if (!sensor) return 'unknown';
  const {
    critical_min, critical_max,
    warning_min,  warning_max,
    normal_min,   normal_max,
  } = sensor;

  const hasBounds = [
    normal_min, normal_max,
    warning_min, warning_max,
    critical_min, critical_max,
  ].some(v => v !== null && v !== undefined);

  if (!hasBounds) return 'unknown';

  if (
    (critical_min !== null && critical_min !== undefined && value < critical_min) ||
    (critical_max !== null && critical_max !== undefined && value > critical_max)
  ) {
    return 'critical';
  }

  if (
    (warning_min !== null && warning_min !== undefined && value < warning_min) ||
    (warning_max !== null && warning_max !== undefined && value > warning_max)
  ) {
    return 'warning';
  }

  return 'normal';
}

/** Hex colour tokens for each status tier.  These MUST be hex (not CSS vars)
 *  because ApexCharts colours arrays do not accept CSS custom properties. */
export const STATUS_COLOR_HEX: Record<StatusTier, string> = {
  normal:   '#37c79a',
  warning:  '#f5b428',
  critical: '#e64b3c',
  unknown:  '#8898aa',
};
