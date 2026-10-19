import { PetCatalog } from "./catalog";
import { isFiniteNumber, isInteger } from "./numbers";

// tuples instead of objects keep a few hundred pets small in the DataStore
export type SavedPet = [id: string, species: string, tier: number, level: number, xp: number, flags: number];

export interface SavedInventory {
	readonly version: number;
	readonly pets: readonly SavedPet[];
}

export const SAVE_VERSION = 1;
export const LOCKED_FLAG = 1;
export const EQUIPPED_FLAG = 2;

export interface RestoredPet {
	readonly id: string;
	readonly species: string;
	readonly tier: number;
	readonly level: number;
	readonly xp: number;
	readonly locked: boolean;
	readonly equipped: boolean;
}

export type ReadResult =
	| { readonly ok: true; readonly pets: readonly RestoredPet[]; readonly problems: string[] }
	| { readonly ok: false; readonly reason: string };

// anything that would make us start the player from nothing is a hard failure, so the caller can
// refuse to load instead of saving an empty inventory over real data. per-pet damage gets repaired
export function readSave(catalog: PetCatalog, data: unknown): ReadResult {
	if (data === undefined) {
		return { ok: true, pets: [], problems: [] };
	} else if (!typeIs(data, "table")) {
		return { ok: false, reason: `expected a table, got ${typeOf(data)}` };
	}

	const { version, pets: entries } = data as { version?: unknown; pets?: unknown };
	if (version !== SAVE_VERSION) {
		return { ok: false, reason: `unsupported save version ${tostring(version)}` };
	} else if (!typeIs(entries, "table")) {
		return { ok: false, reason: "save has no pet list" };
	}

	const pets: RestoredPet[] = [];
	const problems: string[] = [];
	const seen = new Set<string>();
	let position = 0;

	const repair = (id: string, what: string, value: unknown, min: number, max: number) => {
		const fixed = isInteger(value) ? math.clamp(value, min, max) : min;
		if (fixed !== value) {
			problems.push(`${id} had ${what} ${tostring(value)}, set to ${fixed}`);
		}
		return fixed;
	};

	for (const entry of entries as unknown[]) {
		position += 1;
		if (!typeIs(entry, "table")) {
			problems.push(`entry ${position} isn't a pet, dropped`);
			continue;
		}

		const [id, species, tier, level, xp, flags] = entry as unknown[];
		if (!typeIs(id, "string") || id === "" || !typeIs(species, "string")) {
			problems.push(`entry ${position} has no id or species, dropped`);
			continue;
		} else if (seen.has(id)) {
			problems.push(`${id} was saved twice, dropped the copy`);
			continue;
		}

		const definition = catalog.get(species);
		if (definition === undefined) {
			problems.push(`${id} is an unknown species "${species}", dropped`);
			continue;
		}
		seen.add(id);

		let restoredXp = 0;
		if (isFiniteNumber(xp) && xp >= 0) {
			restoredXp = xp;
		} else {
			problems.push(`${id} had xp ${tostring(xp)}, reset to 0`);
		}

		const restoredFlags = repair(id, "flags", flags, 0, LOCKED_FLAG + EQUIPPED_FLAG);
		pets.push({
			id,
			species,
			tier: repair(id, "tier", tier, 0, catalog.highestTier()),
			level: repair(id, "level", level, 1, definition.maxLevel),
			xp: restoredXp,
			locked: (restoredFlags & LOCKED_FLAG) !== 0,
			equipped: (restoredFlags & EQUIPPED_FLAG) !== 0,
		});
	}

	return { ok: true, pets, problems };
}
