from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import settings
from DAL import User

# Use bcrypt_sha256 to avoid bcrypt's 72-byte password length limit
_pwd_context = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated="auto")


class AuthService:

    @staticmethod
    def hash_password(password: str) -> str:
        return _pwd_context.hash(password)

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        return _pwd_context.verify(plain, hashed)

    @staticmethod
    def create_access_token(user_id: int, expires_delta: Optional[timedelta] = None) -> str:
        expire = datetime.now(timezone.utc) + (
            expires_delta or timedelta(hours=settings.jwt_access_token_expire_hours)
        )
        payload = {"user_id": user_id, "exp": expire}
        return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    @staticmethod
    def decode_token(token: str) -> dict:
        try:
            return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        except JWTError:
            raise ValueError("Invalid or expired token")

    def authenticate_user(self, db: Session, username: str, password: str) -> Optional[User]:
        user = db.query(User).filter(User.username == username).first()
        if not user or not self.verify_password(password, user.hashed_password):
            return None
        if not user.is_active:
            return None
        return user

    def seed_admin(self, db: Session):
        """Create the default admin account if it does not exist yet."""
        existing = db.query(User).filter(User.username == settings.seed_admin_username).first()
        if existing:
            return
        admin = User(
            username=settings.seed_admin_username,
            email=settings.seed_admin_email,
            hashed_password=self.hash_password(settings.seed_admin_password),
            is_active=True,
        )
        db.add(admin)
        db.commit()
