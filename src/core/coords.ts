/**
 * Coordinates & node keys for the cubic Pente board.
 *
 * A board of size `N` is an `N×N×N` lattice; every node is an integer triple
 * `(x, y, z)` with each component in `0..N-1`. Nodes are keyed by the
 * human-readable string `"x,y,z"` (see GLOSSARY "NodeKey"), which is stable and
 * survives JSON export. This is the pure rules layer: no rendering, network, or DOM.
 */

/** An integer lattice coordinate `(x, y, z)`. */
export type Coord = [number, number, number];

/** The string identity of a node: `"x,y,z"`. */
export type NodeKey = string;

/** Serialize a coordinate to its canonical `"x,y,z"` node key. */
export function keyOf(coord: Coord): NodeKey {
  return `${coord[0]},${coord[1]},${coord[2]}`;
}

/** Parse an `"x,y,z"` node key back into its numeric coordinate triple. */
export function coordsOf(key: NodeKey): Coord {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** True iff every component of `coord` lies within `0..size-1`. */
export function inBounds(coord: Coord, size: number): boolean {
  return coord.every((c) => c >= 0 && c < size);
}
