from datetime import datetime, timezone

from sqlalchemy.orm import Session, selectinload

from DAL.models.asset import Asset


class AssetService:
    """CRUD + path maintenance for the asset hierarchy."""

    # ── Read ─────────────────────────────────────────────────────────────

    def get_all_flat(
        self,
        db: Session,
        kind: str | None = None,
        parent_id: int | None = None,
        search: str | None = None,
    ) -> list[Asset]:
        query = db.query(Asset)
        if kind:
            query = query.filter(Asset.kind == kind)
        if parent_id is not None:
            query = query.filter(Asset.parent_id == parent_id)
        if search:
            term = f"%{search.lower()}%"
            query = query.filter(
                Asset.name.ilike(term) | Asset.path.ilike(term)
            )
        return query.order_by(Asset.name).all()

    def get_tree(self, db: Session) -> list[Asset]:
        """Return root assets with children eagerly loaded (recursive selectinload)."""
        all_assets = (
            db.query(Asset)
            .options(selectinload(Asset.children))
            .order_by(Asset.name)
            .all()
        )
        roots = [a for a in all_assets if a.parent_id is None]
        return roots

    def get_ancestors(self, db: Session, asset_id: int) -> list[Asset]:
        """Return [root, ..., direct_parent] for the given asset_id."""
        ancestors: list[Asset] = []
        current = db.get(Asset, asset_id)
        if current is None:
            return []
        current = db.get(Asset, current.parent_id) if current.parent_id else None
        while current:
            ancestors.insert(0, current)
            current = db.get(Asset, current.parent_id) if current.parent_id else None
        return ancestors

    def get_by_id(self, db: Session, asset_id: int) -> Asset | None:
        return db.get(Asset, asset_id)

    # ── Write ────────────────────────────────────────────────────────────

    def create(
        self,
        db: Session,
        name: str,
        kind: str = "machine",
        parent_id: int | None = None,
        description: str | None = None,
    ) -> Asset:
        asset = Asset(
            name=name,
            kind=kind,
            parent_id=parent_id,
            description=description,
        )
        db.add(asset)
        db.flush()  # get id before computing path
        asset.path = self._compute_path(db, asset)
        db.commit()
        db.refresh(asset)
        return asset

    def update(
        self,
        db: Session,
        asset: Asset,
        name: str | None = None,
        kind: str | None = None,
        parent_id: int | None = ...,  # type: ignore[assignment]
        description: str | None = ...,  # type: ignore[assignment]
    ) -> Asset:
        if name is not None:
            asset.name = name
        if kind is not None:
            asset.kind = kind
        if parent_id is not ...:
            asset.parent_id = parent_id  # type: ignore[assignment]
        if description is not ...:
            asset.description = description  # type: ignore[assignment]
        asset.updated_at = datetime.now(timezone.utc)
        self._update_subtree_paths(db, asset)
        db.commit()
        db.refresh(asset)
        return asset

    def delete(self, db: Session, asset: Asset) -> None:
        db.delete(asset)
        db.commit()

    # ── Path helpers ─────────────────────────────────────────────────────

    def _compute_path(self, db: Session, asset: Asset) -> str:
        parts: list[str] = [asset.name]
        parent_id = asset.parent_id
        while parent_id is not None:
            parent = db.get(Asset, parent_id)
            if parent is None:
                break
            parts.append(parent.name)
            parent_id = parent.parent_id
        parts.reverse()
        return " / ".join(parts)

    def _update_subtree_paths(self, db: Session, asset: Asset) -> None:
        """Recursively recompute path for asset and all descendants."""
        asset.path = self._compute_path(db, asset)
        children = db.query(Asset).filter(Asset.parent_id == asset.id).all()
        for child in children:
            self._update_subtree_paths(db, child)
