import pytest
from services.asset_service import AssetService

_svc = AssetService()


# ── create + path ──────────────────────────────────────────────────────────────

def test_create_root_asset(db):
    a = _svc.create(db, name="Plant A", kind="factory")
    assert a.id is not None
    assert a.path == "Plant A"
    assert a.parent_id is None


def test_create_child_asset(db):
    parent = _svc.create(db, name="Plant A", kind="factory")
    child  = _svc.create(db, name="Line 1", kind="line", parent_id=parent.id)
    assert child.path == "Plant A / Line 1"
    assert child.parent_id == parent.id


def test_create_grandchild_path(db):
    factory = _svc.create(db, name="Factory",  kind="factory")
    area    = _svc.create(db, name="Area B",   kind="area",    parent_id=factory.id)
    machine = _svc.create(db, name="Machine X", kind="machine", parent_id=area.id)
    assert machine.path == "Factory / Area B / Machine X"


def test_path_root_only(db):
    a = _svc.create(db, name="Solo", kind="equipment")
    assert a.path == "Solo"


# ── get_all_flat ───────────────────────────────────────────────────────────────

def test_get_all_flat_returns_all(db):
    _svc.create(db, name="A", kind="factory")
    _svc.create(db, name="B", kind="factory")
    results = _svc.get_all_flat(db)
    assert len(results) == 2


def test_get_all_flat_filter_kind(db):
    _svc.create(db, name="Factory", kind="factory")
    _svc.create(db, name="Machine", kind="machine")
    results = _svc.get_all_flat(db, kind="machine")
    assert len(results) == 1
    assert results[0].name == "Machine"


def test_get_all_flat_search(db):
    _svc.create(db, name="Alpha Plant",  kind="factory")
    _svc.create(db, name="Beta Factory", kind="factory")
    results = _svc.get_all_flat(db, search="alpha")
    assert len(results) == 1
    assert results[0].name == "Alpha Plant"


# ── get_tree ───────────────────────────────────────────────────────────────────

def test_get_tree_returns_roots_only(db):
    parent = _svc.create(db, name="Root",  kind="factory")
    child  = _svc.create(db, name="Child", kind="area", parent_id=parent.id)
    roots = _svc.get_tree(db)
    assert len(roots) == 1
    assert roots[0].name == "Root"


# ── update + path propagation ──────────────────────────────────────────────────

def test_update_asset_name_updates_path(db):
    parent = _svc.create(db, name="Old Name", kind="factory")
    child  = _svc.create(db, name="Child",    kind="machine", parent_id=parent.id)
    _svc.update(db, parent, name="New Name")
    db.refresh(child)
    assert parent.path == "New Name"
    assert child.path  == "New Name / Child"


def test_update_reparent_updates_paths(db):
    a = _svc.create(db, name="Alpha", kind="factory")
    b = _svc.create(db, name="Beta",  kind="factory")
    c = _svc.create(db, name="Child", kind="machine", parent_id=a.id)
    assert c.path == "Alpha / Child"
    _svc.update(db, c, parent_id=b.id)
    db.refresh(c)
    assert c.path == "Beta / Child"


def test_update_subtree_three_levels(db):
    root  = _svc.create(db, name="R",   kind="factory")
    mid   = _svc.create(db, name="M",   kind="area",    parent_id=root.id)
    leaf  = _svc.create(db, name="L",   kind="machine", parent_id=mid.id)
    _svc.update(db, root, name="Root2")
    db.refresh(mid)
    db.refresh(leaf)
    assert mid.path  == "Root2 / M"
    assert leaf.path == "Root2 / M / L"


# ── delete ─────────────────────────────────────────────────────────────────────

def test_delete_asset(db):
    a = _svc.create(db, name="ToDelete", kind="factory")
    _svc.delete(db, a)
    assert _svc.get_by_id(db, a.id) is None


# ── get_ancestors ──────────────────────────────────────────────────────────────

def test_get_ancestors_root_returns_empty(db):
    root = _svc.create(db, name="Root", kind="factory")
    ancestors = _svc.get_ancestors(db, root.id)
    assert ancestors == []


def test_get_ancestors_child_returns_parent(db):
    root  = _svc.create(db, name="Root",  kind="factory")
    child = _svc.create(db, name="Child", kind="machine", parent_id=root.id)
    ancestors = _svc.get_ancestors(db, child.id)
    assert len(ancestors) == 1
    assert ancestors[0].id == root.id


def test_get_ancestors_deep(db):
    a = _svc.create(db, name="A", kind="factory")
    b = _svc.create(db, name="B", kind="area",    parent_id=a.id)
    c = _svc.create(db, name="C", kind="machine", parent_id=b.id)
    ancestors = _svc.get_ancestors(db, c.id)
    assert [x.name for x in ancestors] == ["A", "B"]
