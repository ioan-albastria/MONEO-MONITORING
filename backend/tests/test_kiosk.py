from datetime import datetime, timedelta, timezone

import pytest

from DAL.models.kiosk_token import KioskToken
from DAL.models.user import User
from services.auth_service import AuthService

_auth = AuthService()


# ── Helpers ─────────────────────────────────────────────────────────────────

def _make_admin(db) -> User:
    user = User(
        username="admin",
        email="admin@test.com",
        hashed_password=_auth.hash_password("pass"),
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_kiosk_token(db, dashboard_ids=None, is_active=True,
                      expires_at=None) -> KioskToken:
    kt = KioskToken(
        dashboard_ids=dashboard_ids or [1, 2],
        label="Test token",
        is_active=is_active,
        expires_at=expires_at,
    )
    db.add(kt)
    db.commit()
    db.refresh(kt)
    return kt


# ── create_kiosk_token ───────────────────────────────────────────────────────

def test_create_kiosk_token_returns_valid_jwt(db):
    kt = _make_kiosk_token(db)
    expires = datetime.now(timezone.utc) + timedelta(days=365)
    token = _auth.create_kiosk_token(kt.id, expires)
    payload = _auth.decode_token(token)
    assert payload["kiosk_token_id"] == kt.id


def test_kiosk_token_payload_has_no_user_id(db):
    kt = _make_kiosk_token(db)
    expires = datetime.now(timezone.utc) + timedelta(days=365)
    token = _auth.create_kiosk_token(kt.id, expires)
    payload = _auth.decode_token(token)
    assert "user_id" not in payload


def test_kiosk_token_expired_raises(db):
    kt = _make_kiosk_token(db)
    expired = datetime.now(timezone.utc) - timedelta(seconds=1)
    token = _auth.create_kiosk_token(kt.id, expired)
    with pytest.raises(ValueError):
        _auth.decode_token(token)


# ── kiosk token model ────────────────────────────────────────────────────────

def test_kiosk_token_default_is_active(db):
    kt = _make_kiosk_token(db)
    assert kt.is_active is True


def test_kiosk_token_revoke(db):
    kt = _make_kiosk_token(db)
    kt.is_active = False
    db.commit()
    db.refresh(kt)
    assert kt.is_active is False


def test_kiosk_token_stores_dashboard_ids(db):
    kt = _make_kiosk_token(db, dashboard_ids=[3, 7, 42])
    db.refresh(kt)
    assert kt.dashboard_ids == [3, 7, 42]


def test_kiosk_token_no_expiry_is_none(db):
    kt = _make_kiosk_token(db, expires_at=None)
    assert kt.expires_at is None


def test_kiosk_token_future_expiry_not_expired(db):
    future = datetime.now(timezone.utc) + timedelta(days=365)
    kt = _make_kiosk_token(db, expires_at=future)
    # SQLite returns naive datetimes; compare without tzinfo
    stored = kt.expires_at
    now = datetime.now()
    assert stored.replace(tzinfo=None) > now


# ── KioskPrincipal (middleware) ──────────────────────────────────────────────

def test_kiosk_principal_role_is_kiosk():
    from middleware import KioskPrincipal
    p = KioskPrincipal(kiosk_dashboard_ids=[1, 2])
    assert p.role == "kiosk"
    assert p.is_kiosk is True
    assert p.kiosk_dashboard_ids == [1, 2]


def test_kiosk_principal_is_not_admin():
    from middleware import KioskPrincipal
    p = KioskPrincipal()
    assert p.role not in ("admin", "operator")


# ── User model properties ────────────────────────────────────────────────────

def test_real_user_is_kiosk_false(db):
    user = _make_admin(db)
    assert user.is_kiosk is False
    assert user.kiosk_dashboard_ids == []


# ── admin user routes (service-level, no HTTP client) ────────────────────────

def test_change_role_in_db(db):
    user = _make_admin(db)
    user.role = "operator"
    db.commit()
    db.refresh(user)
    assert user.role == "operator"


def test_cannot_find_nonexistent_user(db):
    result = db.get(User, 999)
    assert result is None
