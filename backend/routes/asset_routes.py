from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.asset import Asset as AssetModel
from middleware import get_current_user, requires_role
from routes.response_models.asset import AssetRead, AssetNodeRead, AssetCreate, AssetUpdate
from services.asset_service import AssetService

asset_router = APIRouter(prefix="/api/assets", tags=["assets"])
_service = AssetService()


@asset_router.get("/tree", response_model=list[AssetNodeRead])
async def get_asset_tree(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Nested asset tree from roots down. Children loaded one level per node."""
    return _service.get_tree(db)


@asset_router.get("", response_model=list[AssetRead])
async def get_assets_flat(
    kind: str | None = Query(None),
    parent_id: int | None = Query(None),
    search: str | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _service.get_all_flat(db, kind=kind, parent_id=parent_id, search=search)


@asset_router.get("/{asset_id}/ancestors", response_model=list[AssetRead])
async def get_asset_ancestors(
    asset_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _service.get_ancestors(db, asset_id)


@asset_router.get("/{asset_id}", response_model=AssetRead)
async def get_asset(
    asset_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = _service.get_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return asset


@asset_router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    if body.parent_id is not None and _service.get_by_id(db, body.parent_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent asset not found")
    return _service.create(
        db, name=body.name, kind=body.kind,
        parent_id=body.parent_id, description=body.description,
    )


@asset_router.put("/{asset_id}", response_model=AssetRead)
async def update_asset(
    asset_id: int,
    body: AssetUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    asset = _service.get_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    if body.parent_id is not None and _service.get_by_id(db, body.parent_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent asset not found")
    if body.parent_id is not None and body.parent_id == asset_id:
        raise HTTPException(status_code=400, detail="Asset cannot be its own parent")
    return _service.update(
        db, asset,
        name=body.name,
        kind=body.kind,
        parent_id=body.parent_id if "parent_id" in body.model_fields_set else ...,
        description=body.description if "description" in body.model_fields_set else ...,
    )


@asset_router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(requires_role("admin", "operator")),
):
    asset = _service.get_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    children = db.query(AssetModel).filter_by(parent_id=asset_id).count()
    if children > 0:
        raise HTTPException(status_code=400, detail="Cannot delete asset with children")
    _service.delete(db, asset)
