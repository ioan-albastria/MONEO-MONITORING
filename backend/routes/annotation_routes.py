from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from DAL import get_db
from DAL.models.annotation import Annotation
from middleware import get_current_user, requires_role

annotation_router = APIRouter(prefix="/api/annotations", tags=["annotations"])


class AnnotationRead(BaseModel):
    id: int
    kind: str
    scope_kind: str
    scope_id: Optional[int] = None
    label: str
    body: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    color: Optional[str] = None
    source_event_id: Optional[int] = None
    created_by: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class AnnotationCreate(BaseModel):
    kind: str = "manual"
    scope_kind: str = "sensor"
    scope_id: Optional[int] = None
    label: str
    body: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    color: Optional[str] = None


class AnnotationUpdate(BaseModel):
    label: Optional[str] = None
    body: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    color: Optional[str] = None


@annotation_router.get("", response_model=list[AnnotationRead])
async def list_annotations(
    scope_kind: Optional[str] = Query(None),
    scope_id: Optional[int] = Query(None),
    from_ts: Optional[datetime] = Query(None, alias="from"),
    to_ts: Optional[datetime] = Query(None, alias="to"),
    kinds: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Annotation)
    if scope_kind is not None:
        q = q.filter(Annotation.scope_kind == scope_kind)
    if scope_id is not None:
        q = q.filter(Annotation.scope_id == scope_id)
    if from_ts is not None:
        q = q.filter(Annotation.started_at >= from_ts)
    if to_ts is not None:
        # include annotations that started before `to` OR are still open
        q = q.filter(
            (Annotation.started_at <= to_ts) &
            ((Annotation.ended_at.is_(None)) | (Annotation.ended_at >= from_ts))
        )
    if kinds is not None:
        kind_list = [k.strip() for k in kinds.split(",")]
        q = q.filter(Annotation.kind.in_(kind_list))
    return q.order_by(Annotation.started_at.desc()).limit(limit).all()


@annotation_router.post("", response_model=AnnotationRead, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    body: AnnotationCreate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ann = Annotation(**body.model_dump(), created_by=current_user.id)
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


@annotation_router.put("/{annotation_id}", response_model=AnnotationRead)
async def update_annotation(
    annotation_id: int,
    body: AnnotationUpdate,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ann = db.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    # Only the creator or an admin may edit
    if ann.created_by != current_user.id and current_user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Not allowed")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(ann, field, val)
    db.commit()
    db.refresh(ann)
    return ann


@annotation_router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ann = db.get(Annotation, annotation_id)
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if ann.created_by != current_user.id and current_user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(ann)
    db.commit()
