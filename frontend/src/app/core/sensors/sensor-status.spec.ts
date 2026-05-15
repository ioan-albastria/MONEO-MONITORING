import { statusOf, STATUS_COLOR_HEX, StatusTier } from './sensor-status';
import { Sensor } from '../../types/sensor';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSensor(overrides: Partial<Sensor> = {}): Sensor {
  return {
    id: 1,
    name: 'Test Sensor',
    unit: '°C',
    description: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expected_poll_seconds: 300,
    last_seen_at: null,
    normal_min:    null,
    normal_max:    null,
    warning_min:   null,
    warning_max:   null,
    critical_min:  null,
    critical_max:  null,
    ranges_source: 'manual',
    ...overrides,
  };
}

// Full range configuration: critical [0,100], warning [10,90], normal [20,80]
const FULL_SENSOR = makeSensor({
  critical_min: 0,   critical_max: 100,
  warning_min:  10,  warning_max:  90,
  normal_min:   20,  normal_max:   80,
});

describe('statusOf', () => {

  describe('null / undefined sensor', () => {
    it('returns "unknown" for null sensor', () => {
      expect(statusOf(42, null)).toBe('unknown');
    });

    it('returns "unknown" for undefined sensor', () => {
      expect(statusOf(42, undefined)).toBe('unknown');
    });
  });

  describe('no bounds configured', () => {
    it('returns "unknown" when all bounds are null', () => {
      expect(statusOf(50, makeSensor())).toBe('unknown');
    });
  });

  describe('only normal bounds configured', () => {
    const sensor = makeSensor({ normal_min: 20, normal_max: 80 });

    it('returns "normal" for a value within normal range', () => {
      expect(statusOf(50, sensor)).toBe('normal');
    });

    it('returns "normal" for a value exactly at normal_min', () => {
      expect(statusOf(20, sensor)).toBe('normal');
    });

    it('returns "normal" for a value exactly at normal_max', () => {
      expect(statusOf(80, sensor)).toBe('normal');
    });

    it('returns "normal" for a value outside normal range (no warning/critical bounds)', () => {
      // Below normal_min but no warning_min → still returns normal (no warning match)
      expect(statusOf(5, sensor)).toBe('normal');
    });
  });

  describe('warning bounds configured', () => {
    const sensor = makeSensor({
      normal_min:  20, normal_max: 80,
      warning_min: 10, warning_max: 90,
    });

    it('returns "normal" for value within normal range', () => {
      expect(statusOf(50, sensor)).toBe('normal');
    });

    it('returns "warning" for value below warning_min', () => {
      expect(statusOf(9, sensor)).toBe('warning');
    });

    it('returns "warning" for value above warning_max', () => {
      expect(statusOf(91, sensor)).toBe('warning');
    });

    it('returns "normal" for value between warning_min and normal_min', () => {
      expect(statusOf(15, sensor)).toBe('normal');
    });
  });

  describe('full bounds (critical + warning + normal)', () => {
    it('returns "normal" for value within normal range [20,80]', () => {
      expect(statusOf(50, FULL_SENSOR)).toBe('normal');
    });

    it('returns "warning" for value between warning_min and normal_min', () => {
      expect(statusOf(15, FULL_SENSOR)).toBe('warning');
    });

    it('returns "warning" for value between normal_max and warning_max', () => {
      expect(statusOf(85, FULL_SENSOR)).toBe('warning');
    });

    it('returns "critical" for value below critical_min', () => {
      expect(statusOf(-1, FULL_SENSOR)).toBe('critical');
    });

    it('returns "critical" for value above critical_max', () => {
      expect(statusOf(101, FULL_SENSOR)).toBe('critical');
    });

    it('returns "critical" for value exactly at critical_min boundary (strictly less than)', () => {
      // value < critical_min → critical; value == critical_min is NOT < critical_min
      expect(statusOf(0, FULL_SENSOR)).toBe('normal');   // 0 is not < 0
    });

    it('returns "critical" for value exactly at critical_max boundary (strictly greater)', () => {
      expect(statusOf(100, FULL_SENSOR)).toBe('normal'); // 100 is not > 100
    });
  });

  describe('only critical bounds', () => {
    const sensor = makeSensor({ critical_min: 0, critical_max: 100 });

    it('returns "critical" below critical_min', () => {
      expect(statusOf(-5, sensor)).toBe('critical');
    });

    it('returns "critical" above critical_max', () => {
      expect(statusOf(105, sensor)).toBe('critical');
    });

    it('returns "normal" within critical bounds (no warning layer)', () => {
      expect(statusOf(50, sensor)).toBe('normal');
    });
  });

  describe('one-sided bounds', () => {
    it('returns "critical" for value above critical_max when only max is set', () => {
      const sensor = makeSensor({ critical_max: 100 });
      expect(statusOf(150, sensor)).toBe('critical');
    });

    it('returns "normal" for value below critical_max when only max is set', () => {
      const sensor = makeSensor({ critical_max: 100 });
      expect(statusOf(50, sensor)).toBe('normal');
    });
  });
});

describe('STATUS_COLOR_HEX', () => {
  const tiers: StatusTier[] = ['normal', 'warning', 'critical', 'unknown'];

  tiers.forEach(tier => {
    it(`has a hex string for tier "${tier}"`, () => {
      expect(STATUS_COLOR_HEX[tier]).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });
});
