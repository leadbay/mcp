/**
 * Shared fixture geography for the `leadbay_tour_plan` specs.
 *
 * Two towns with different names are different places. The tour keeps a
 * Discover lead whose own coordinates put it within `radius_km` of the town
 * the user named (product#4141), so a fixture set that puts Austin, Boston and
 * Chicago on one point reads as three companies at the same address. Every
 * distinct town name here gets its own cell of a 2-degree grid, roughly
 * 200 km from every other one.
 *
 * A spec that wants two towns next to each other passes its own `pos` with
 * real coordinates — `tour-plan-nearby-towns.test.ts` does.
 */
const gridCells = new Map<string, [number, number]>();

export function distinctTownPos(city: string): [number, number] {
  const known = gridCells.get(city);
  if (known) return known;
  const n = gridCells.size;
  const cell: [number, number] = [20 + (n % 20) * 2, -120 + Math.floor(n / 20) * 2];
  gridCells.set(city, cell);
  return cell;
}
