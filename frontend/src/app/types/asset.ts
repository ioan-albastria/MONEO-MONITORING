export type AssetKind =
  | 'factory' | 'area' | 'line' | 'cell' | 'machine' | 'equipment';

export interface Asset {
  id: number;
  name: string;
  description?: string | null;
  kind: AssetKind;
  parent_id?: number | null;
  path?: string | null;
  location?: string | null;
}

/** Recursive tree node returned by GET /api/assets/tree */
export interface AssetNode extends Asset {
  children: AssetNode[];
}
