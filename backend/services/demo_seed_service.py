import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from DAL import Dashboard, DashboardWidget, Sensor, SensorReading, User

_DEMO_DASHBOARD_NAME = "Demo Dashboard"


def seed_demo_data(db: Session) -> None:
    """Insert demo sensors, 24 h of synthetic readings, and a demo dashboard.

    Idempotent — skips everything if DEMO-TEMP-001 already exists.
    """
    if db.query(Sensor).filter(Sensor.moneo_sensor_id == "DEMO-TEMP-001").first():
        return

    sensors = _create_sensors(db)
    _create_readings(db, sensors)
    _create_dashboard(db, sensors)


# ── helpers ──────────────────────────────────────────────────────────────────

def _create_sensors(db: Session) -> list[Sensor]:
    defs = [
        dict(
            moneo_sensor_id="DEMO-TEMP-001",
            name="Machine Temperature",
            description="Ambient temperature near motor housing",
            sensor_type="temperature",
            unit="°C",
            min_value=0.0,
            max_value=80.0,
            is_active=True,
        ),
        dict(
            moneo_sensor_id="DEMO-VIB-001",
            name="Spindle Vibration",
            description="RMS vibration on main spindle bearing",
            sensor_type="vibration",
            unit="mm/s",
            min_value=0.0,
            max_value=20.0,
            is_active=True,
        ),
        dict(
            moneo_sensor_id="DEMO-PRESS-001",
            name="Hydraulic Pressure",
            description="Hydraulic circuit supply pressure",
            sensor_type="pressure",
            unit="bar",
            min_value=0.0,
            max_value=10.0,
            is_active=True,
        ),
        dict(
            moneo_sensor_id="DEMO-HUM-001",
            name="Cabinet Humidity",
            description="Relative humidity inside control cabinet",
            sensor_type="humidity",
            unit="%RH",
            min_value=0.0,
            max_value=100.0,
            is_active=True,
        ),
    ]
    sensors = [Sensor(**d) for d in defs]
    db.add_all(sensors)
    db.flush()
    return sensors


def _create_readings(db: Session, sensors: list[Sensor]) -> None:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    step = timedelta(minutes=5)
    n_points = 288  # 24 h × 12 per hour

    readings: list[SensorReading] = []
    rng = random.Random(42)

    for i, sensor in enumerate(sensors):
        for k in range(n_points):
            ts = now - step * (n_points - k)
            value = _synthetic_value(i, k, n_points, rng)
            readings.append(
                SensorReading(
                    sensor_id=sensor.id,
                    value=round(value, 3),
                    timestamp=ts.replace(tzinfo=None),  # store naive UTC
                    status="ok",
                )
            )

    db.bulk_save_objects(readings)
    db.flush()


def _synthetic_value(sensor_idx: int, k: int, n: int, rng: random.Random) -> float:
    t = k / n  # 0 → 1 over the 24 h window
    if sensor_idx == 0:
        # Temperature: slow sine 22 ± 4 °C with small noise
        return 22.0 + 4.0 * math.sin(2 * math.pi * t) + rng.gauss(0, 0.3)
    if sensor_idx == 1:
        # Vibration: baseline 1.5 with occasional spikes
        base = 1.5 + 0.5 * math.sin(4 * math.pi * t) + rng.gauss(0, 0.2)
        spike = 4.0 if rng.random() < 0.03 else 0.0
        return max(0.0, base + spike)
    if sensor_idx == 2:
        # Pressure: ramp up then plateau, slight noise
        return 3.5 + 1.5 * math.tanh((t - 0.3) * 6) + rng.gauss(0, 0.05)
    # Humidity: oscillates 55 ± 10 %
    return 55.0 + 10.0 * math.sin(3 * math.pi * t + 1.0) + rng.gauss(0, 1.0)


def _create_dashboard(db: Session, sensors: list[Sensor]) -> None:
    admin: User | None = db.query(User).filter(User.username == "admin").first()
    if admin is None:
        return

    if db.query(Dashboard).filter(
        Dashboard.owner_id == admin.id,
        Dashboard.name == _DEMO_DASHBOARD_NAME,
    ).first():
        return

    dash = Dashboard(
        name=_DEMO_DASHBOARD_NAME,
        description="Pre-populated dashboard showing all widget types with synthetic IFM sensor data.",
        owner_id=admin.id,
        is_public=True,
    )
    db.add(dash)
    db.flush()

    temp_id, vib_id, press_id, hum_id = [s.id for s in sensors]

    widgets = [
        DashboardWidget(
            dashboard_id=dash.id,
            widget_type="line_chart",
            title="Machine Temperature – 24 h",
            subtitle="°C",
            x=0, y=0, cols=6, rows=4,
            settings={"sensor_ids": [temp_id], "time_range_hours": 24, "aggregated": False},
        ),
        DashboardWidget(
            dashboard_id=dash.id,
            widget_type="bar_chart",
            title="Spindle Vibration – 24 h",
            subtitle="mm/s",
            x=6, y=0, cols=6, rows=4,
            settings={"sensor_ids": [vib_id], "time_range_hours": 24, "aggregated": False},
        ),
        DashboardWidget(
            dashboard_id=dash.id,
            widget_type="gauge",
            title="Hydraulic Pressure",
            subtitle="bar",
            x=0, y=4, cols=3, rows=4,
            settings={"sensor_ids": [press_id], "gauge_min": 0, "gauge_max": 10},
        ),
        DashboardWidget(
            dashboard_id=dash.id,
            widget_type="stat_card",
            title="Cabinet Humidity",
            subtitle="%RH",
            x=3, y=4, cols=3, rows=4,
            settings={"sensor_ids": [hum_id]},
        ),
    ]
    db.add_all(widgets)
    db.commit()
