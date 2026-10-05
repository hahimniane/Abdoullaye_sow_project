/**
 * Which composite index a Firestore query needs, and whether
 * my_flutter_app/firestore.indexes.json has it.
 *
 * The emulator does not enforce composite indexes, and production answers a
 * query whose index is missing with an error - a list that never loads. So
 * every query shape the consoles ask for is checked here against the index
 * file (console-query-indexes.test.ts). Pure: no Firebase.
 */

import type { QueryFilterSpec, QueryOrderSpec } from "./paged-query.ts";

export type QueryShape = {
  collection: string;
  /** A collection-group query (indexes with COLLECTION_GROUP scope). */
  group?: boolean;
  filters: readonly QueryFilterSpec[];
  orderBy?: QueryOrderSpec | null;
};

export type IndexField = { fieldPath: string; order?: "ASCENDING" | "DESCENDING"; arrayConfig?: "CONTAINS" };
export type IndexDefinition = {
  collectionGroup: string;
  queryScope: "COLLECTION" | "COLLECTION_GROUP";
  fields: IndexField[];
};

const EQUALITY_OPS = new Set(["==", "in"]);
const RANGE_OPS = new Set(["<", "<=", ">", ">=", "!=", "not-in"]);

export type RequiredIndex = {
  collection: string;
  scope: "COLLECTION" | "COLLECTION_GROUP";
  /** Equality (and array-contains) fields, in any order. */
  prefix: { fieldPath: string; contains: boolean }[];
  /** The ordered field, last in the index. */
  order: { fieldPath: string; order: "ASCENDING" | "DESCENDING" } | null;
};

/**
 * The composite index a shape needs, or null when Firestore serves it from
 * its automatic single-field indexes (one field in play, or equality filters
 * only, or ascending document-id order after equalities).
 *
 * @throws When the shape is one Firestore itself refuses (an inequality on a
 * field other than the first order).
 */
export function requiredIndex(shape: QueryShape): RequiredIndex | null {
  const equalities = new Set<string>();
  let contains = "";
  const ranges = new Set<string>();
  for (const [field, op] of shape.filters) {
    if (EQUALITY_OPS.has(op)) equalities.add(field);
    else if (op === "array-contains" || op === "array-contains-any") contains = field;
    else if (RANGE_OPS.has(op)) ranges.add(field);
  }
  if (ranges.size > 1) {
    throw new Error(`${shape.collection}: inequalities on more than one field (${[...ranges].join(", ")})`);
  }
  const range = [...ranges][0] ?? "";
  let order = shape.orderBy
    ? { fieldPath: shape.orderBy.field, order: shape.orderBy.direction === "desc" ? "DESCENDING" as const : "ASCENDING" as const }
    : null;
  if (!order && range) order = { fieldPath: range, order: "ASCENDING" };
  if (range && order && order.fieldPath !== range) {
    throw new Error(`${shape.collection}: the first orderBy must be the inequality field ${range}`);
  }
  // An equality on the ordered field adds nothing to the index.
  if (order) equalities.delete(order.fieldPath);
  const prefix = [
    ...[...equalities].sort().map((fieldPath) => ({ fieldPath, contains: false })),
    ...(contains ? [{ fieldPath: contains, contains: true }] : []),
  ];
  const scope = shape.group ? "COLLECTION_GROUP" as const : "COLLECTION" as const;
  if (!order) {
    // Equality filters alone merge single-field indexes - except alongside
    // array-contains, where this repo keeps an explicit index.
    return contains && equalities.size > 0 ? { collection: shape.collection, scope, prefix, order: null } : null;
  }
  if (prefix.length === 0) return null;
  if (order.fieldPath === "__name__" && order.order === "ASCENDING") return null;
  return { collection: shape.collection, scope, prefix, order };
}

/** Whether `index` is exactly the one `need` describes. */
export function indexMatches(index: IndexDefinition, need: RequiredIndex): boolean {
  if (index.collectionGroup !== need.collection || index.queryScope !== need.scope) return false;
  const fields = index.fields.filter((f) => f.fieldPath !== "__name__");
  const expectedLength = need.prefix.length + (need.order ? 1 : 0);
  if (fields.length !== expectedLength) return false;
  const head = need.order ? fields.slice(0, -1) : fields;
  if (need.order) {
    const last = fields[fields.length - 1];
    if (last.fieldPath !== need.order.fieldPath || last.order !== need.order.order) return false;
  }
  const wanted = new Map(need.prefix.map((p) => [p.fieldPath, p.contains] as const));
  return head.every((field) => {
    if (!wanted.has(field.fieldPath)) return false;
    return wanted.get(field.fieldPath) ? field.arrayConfig === "CONTAINS" : Boolean(field.order);
  });
}

/** The index in `indexes` that serves `shape`, true when none is needed, or false. */
export function shapeIsIndexed(shape: QueryShape, indexes: readonly IndexDefinition[]): boolean {
  const need = requiredIndex(shape);
  if (!need) return true;
  return indexes.some((index) => indexMatches(index, need));
}

/** A readable description of the index a shape needs (for failure messages). */
export function describeRequiredIndex(shape: QueryShape): string {
  const need = requiredIndex(shape);
  if (!need) return "no composite index";
  const parts = need.prefix.map((p) => `${p.fieldPath} ${p.contains ? "CONTAINS" : "ASC"}`);
  if (need.order) parts.push(`${need.order.fieldPath} ${need.order.order === "DESCENDING" ? "DESC" : "ASC"}`);
  return `${need.collection} (${need.scope}): ${parts.join(", ")}`;
}
