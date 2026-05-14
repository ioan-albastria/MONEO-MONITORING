/* Fixture matching the shape of a real DashboardWidget row.
   {id, type, x,y,cols,rows, settings:{sensor_ids, gauge_min, ...}} */

window.DASHBOARD = {
  id: 17,
  name: 'North Line 2 — process overview',
  widgets: [
    // Row 1 — line chart hero + bar chart
    {
      id: 101, type: 'line_chart', x: 0, y: 0, cols: 14, rows: 4,
      title: 'Discharge pressure · P-201, P-204, P-208',
      sensor_ids: [201, 204, 208],
      sensor_labels: ['P-201 disch', 'P-204 disch', 'P-208 disch'],
      status: 'ok',
      settings: { sensor_ids: [201, 204, 208], aggregated: true, bucket_minutes: 60, time_range_hours: 8 },
    },
    {
      id: 102, type: 'bar_chart', x: 14, y: 0, cols: 10, rows: 4,
      title: 'Bearing temps · last 12h, hourly avg',
      sensor_ids: [301, 302, 303, 304],
      sensor_labels: ['B-1', 'B-2', 'B-3', 'B-4'],
      status: 'ok',
      settings: { sensor_ids: [301,302,303,304], aggregated: true, bucket_minutes: 60, time_range_hours: 12 },
    },

    // Row 2 — gauges + stat cards
    {
      id: 103, type: 'gauge', x: 0, y: 4, cols: 6, rows: 4,
      title: 'P-201 discharge',
      sensor_ids: [201],
      unit: 'bar',
      value: 4.82,
      gauge_min: 0, gauge_max: 8,
      live: true,
      settings: { sensor_ids: [201], gauge_min: 0, gauge_max: 8 },
    },
    {
      id: 104, type: 'gauge', x: 6, y: 4, cols: 6, rows: 4,
      title: 'V-15 level',
      sensor_ids: [415],
      unit: '%',
      value: 88.4,
      gauge_min: 0, gauge_max: 100,
      live: true,
      // This will resolve to "warn" by the existing 80%/95% rule
      settings: { sensor_ids: [415], gauge_min: 0, gauge_max: 100 },
    },
    {
      id: 105, type: 'stat_card', x: 12, y: 4, cols: 6, rows: 4,
      title: 'P-201 motor temp',
      sensor_ids: [202],
      unit: '°C', value: 68.4, decimals: 1, variance: 0.6,
      status: 'ok',
      settings: { sensor_ids: [202], time_range_hours: 2 },
    },
    {
      id: 106, type: 'stat_card', x: 18, y: 4, cols: 6, rows: 4,
      title: 'V-16 head pressure',
      sensor_ids: [416],
      unit: 'bar', value: 92.4, decimals: 1, variance: 0.4,
      status: 'crit',
      offline: true, // simulate the gap the user flagged: no timestamp on /latest → infer
      settings: { sensor_ids: [416], time_range_hours: 2 },
    },

    // Row 3 — more stat cards + one stale, plus a line chart
    {
      id: 107, type: 'stat_card', x: 0, y: 8, cols: 6, rows: 4,
      title: 'F-12 flow',
      sensor_ids: [501],
      unit: 'L/m', value: 312, decimals: 0, variance: 4,
      status: 'ok',
      settings: { sensor_ids: [501], time_range_hours: 2 },
    },
    {
      id: 108, type: 'stat_card', x: 6, y: 8, cols: 6, rows: 4,
      title: 'Vibration X · P-204',
      sensor_ids: [240],
      unit: 'mm/s', value: 2.1, decimals: 2, variance: 0.05,
      status: 'stale',
      settings: { sensor_ids: [240], time_range_hours: 2 },
    },
    {
      id: 109, type: 'line_chart', x: 12, y: 8, cols: 12, rows: 4,
      title: 'V-14 level vs head pressure',
      sensor_ids: [414, 424],
      sensor_labels: ['V-14 level', 'V-14 head'],
      status: 'ok',
      settings: { sensor_ids: [414, 424], aggregated: true, bucket_minutes: 60, time_range_hours: 8 },
    },
  ],
};
