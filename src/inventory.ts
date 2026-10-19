import { HttpService } from "@rbxts/services";
import { PetCatalog } from "./catalog";
import { isFiniteNumber, isInteger } from "./numbers";
import { EQUIPPED_FLAG, LOCKED_FLAG, readSave, SAVE_VERSION, SavedInventory, SavedPet } from "./save";

export interface Pet {
	readonly id: string;
	readonly species: string;
	readonly tier: number;
	readonly level: number;
	readonly xp: number;
	readonly locked: boolean;
	readonly equipped: boolean;
}

interface PetRecord {
	id: string;
	species: string;
	tier: number;
	level: number;
	xp: number;
	locked: boolean;
	equipped: boolean;
	obtained: number;
}

export type PetError =
	| "NotFound"
	| "StorageFull"
	| "SlotsFull"
	| "AlreadyEquipped"
	| "NotEquipped"
	| "Locked"
	| "Duplicate"
	| "MaxTier"
	| "NotEnoughPets"
	| "MixedPets"
	| "WrongCount";

export type Failure = { readonly ok: false; readonly reason: PetError };
export type Outcome = { readonly ok: true } | Failure;
export type AddOutcome = { readonly ok: true; readonly pet: Pet } | Failure;
export type XpOutcome = { readonly ok: true; readonly levelsGained: number; readonly overflow: number } | Failure;
export type MergeOutcome = { readonly ok: true; readonly pet: Pet; readonly consumed: readonly string[] } | Failure;

export type LoadResult =
	| { readonly ok: true; readonly inventory: PetInventory; readonly problems: readonly string[] }
	| { readonly ok: false; readonly reason: string };

export type PetChange =
	| { readonly kind: "added"; readonly pet: Pet }
	| { readonly kind: "updated"; readonly pet: Pet }
	| { readonly kind: "removed"; readonly id: string };

export interface MultiplierBreakdown {
	readonly total: number;
	readonly pets: readonly { readonly id: string; readonly species: string; readonly multiplier: number }[];
}

export interface InventoryOptions {
	readonly capacity?: number;
	readonly maxEquipped?: number;
	readonly generateId?: () => string;
}

const OK: Outcome = { ok: true };

function fail(reason: PetError): Failure {
	return { ok: false, reason };
}

function checkCount(value: number, name: string): number {
	if (!isInteger(value) || value < 0) {
		throw `${name} must be a whole number of 0 or more, got ${value}`;
	}
	return value;
}

export class PetInventory {
	private readonly pets = new Map<string, PetRecord>();
	private readonly equipped: PetRecord[] = [];
	private readonly listeners = new Set<(change: PetChange) => void>();
	private readonly generateId: () => string;
	private capacity: number;
	private maxEquipped: number;
	private obtainedCount = 0;

	public constructor(
		public readonly catalog: PetCatalog,
		options: InventoryOptions = {},
	) {
		this.capacity = checkCount(options.capacity ?? 100, "capacity");
		this.maxEquipped = checkCount(options.maxEquipped ?? 3, "maxEquipped");
		this.generateId = options.generateId ?? (() => HttpService.GenerateGUID(false));
	}

	public static load(catalog: PetCatalog, data: unknown, options?: InventoryOptions): LoadResult {
		const result = readSave(catalog, data);
		if (!result.ok) {
			return result;
		}

		const inventory = new PetInventory(catalog, options);
		const problems = result.problems;
		for (const saved of result.pets) {
			const pet = inventory.insert(saved.id, saved.species, saved.tier);
			pet.level = saved.level;
			pet.xp = saved.xp;
			pet.locked = saved.locked;
			// xp past the next level means the curve got cheaper since this was saved, so level them up
			inventory.applyXp(pet, 0);
			if (saved.equipped) {
				pet.equipped = true;
				inventory.equipped.push(pet);
			}
		}

		const equippedCount = inventory.equipped.size();
		if (equippedCount > inventory.maxEquipped) {
			problems.push(
				`${equippedCount} pets were equipped with ${inventory.maxEquipped} slots, kept the strongest`,
			);
			inventory.trimEquipped();
		}
		if (inventory.pets.size() > inventory.capacity) {
			problems.push(`holding ${inventory.pets.size()} pets with room for ${inventory.capacity}, kept them all`);
		}

		return { ok: true, inventory, problems };
	}

	public save(): SavedInventory {
		const pets: SavedPet[] = [];
		for (const pet of this.sortedByObtained()) {
			const flags = (pet.locked ? LOCKED_FLAG : 0) + (pet.equipped ? EQUIPPED_FLAG : 0);
			pets.push([pet.id, pet.species, pet.tier, pet.level, pet.xp, flags]);
		}
		return { version: SAVE_VERSION, pets };
	}

	public onChanged(listener: (change: PetChange) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	public get(id: string): Pet | undefined {
		return this.pets.get(id);
	}

	public getAll(): Pet[] {
		return this.sortedByObtained();
	}

	public getEquipped(): Pet[] {
		return table.clone(this.equipped);
	}

	public count(): number {
		return this.pets.size();
	}

	public countOf(species: string, tier?: number): number {
		let total = 0;
		for (const [, pet] of this.pets) {
			if (pet.species === species && (tier === undefined || pet.tier === tier)) {
				total += 1;
			}
		}
		return total;
	}

	public getCapacity(): number {
		return this.capacity;
	}

	public freeSpace(): number {
		return math.max(this.capacity - this.pets.size(), 0);
	}

	public setCapacity(capacity: number): void {
		// lowering it never deletes anything, adding is just blocked until there's room again
		this.capacity = checkCount(capacity, "capacity");
	}

	public getMaxEquipped(): number {
		return this.maxEquipped;
	}

	public setMaxEquipped(count: number): void {
		this.maxEquipped = checkCount(count, "maxEquipped");
		this.trimEquipped();
	}

	public add(species: string, tier = 0): AddOutcome {
		if (!this.catalog.has(species)) {
			throw `unknown species "${species}"`;
		} else if (this.catalog.getTier(tier) === undefined) {
			throw `tier ${tier} doesn't exist`;
		} else if (this.pets.size() >= this.capacity) {
			return fail("StorageFull");
		}

		const pet = this.insert(this.newId(), species, tier);
		this.emit({ kind: "added", pet });
		return { ok: true, pet };
	}

	public remove(id: string): Outcome {
		const pet = this.pets.get(id);
		if (pet === undefined) {
			return fail("NotFound");
		} else if (pet.locked) {
			return fail("Locked");
		}
		this.delete(pet);
		return OK;
	}

	public removeMany(ids: readonly string[]): Outcome {
		const seen = new Set<string>();
		for (const id of ids) {
			const pet = this.pets.get(id);
			if (pet === undefined) {
				return fail("NotFound");
			} else if (pet.locked) {
				return fail("Locked");
			} else if (seen.has(id)) {
				return fail("Duplicate");
			}
			seen.add(id);
		}

		for (const id of ids) {
			this.delete(this.pets.get(id)!);
		}
		return OK;
	}

	public setLocked(id: string, locked: boolean): Outcome {
		const pet = this.pets.get(id);
		if (pet === undefined) {
			return fail("NotFound");
		}
		if (pet.locked !== locked) {
			pet.locked = locked;
			this.emit({ kind: "updated", pet });
		}
		return OK;
	}

	public equip(id: string): Outcome {
		const pet = this.pets.get(id);
		if (pet === undefined) {
			return fail("NotFound");
		} else if (pet.equipped) {
			return fail("AlreadyEquipped");
		} else if (this.equipped.size() >= this.maxEquipped) {
			return fail("SlotsFull");
		}
		this.setEquipped(pet, true);
		return OK;
	}

	public unequip(id: string): Outcome {
		const pet = this.pets.get(id);
		if (pet === undefined) {
			return fail("NotFound");
		} else if (!pet.equipped) {
			return fail("NotEquipped");
		}
		this.setEquipped(pet, false);
		return OK;
	}

	public equipBest(): void {
		const all: PetRecord[] = [];
		for (const [, pet] of this.pets) {
			all.push(pet);
		}

		const best = this.strongestFirst(all);
		// unequip first so the slot count never goes over the limit while listeners run
		best.forEach((pet, index) => {
			if (index >= this.maxEquipped) {
				this.setEquipped(pet, false);
			}
		});
		best.forEach((pet, index) => {
			if (index < this.maxEquipped) {
				this.setEquipped(pet, true);
			}
		});
	}

	public addXp(id: string, amount: number): XpOutcome {
		if (!isFiniteNumber(amount) || amount < 0) {
			throw `xp amount must be a finite number of 0 or more, got ${amount}`;
		}
		const pet = this.pets.get(id);
		if (pet === undefined) {
			return fail("NotFound");
		}
		return this.applyXp(pet, amount);
	}

	public addXpToEquipped(amount: number): number {
		if (!isFiniteNumber(amount) || amount < 0) {
			throw `xp amount must be a finite number of 0 or more, got ${amount}`;
		}
		let levelsGained = 0;
		for (const pet of table.clone(this.equipped)) {
			levelsGained += this.applyXp(pet, amount).levelsGained;
		}
		return levelsGained;
	}

	public merge(species: string, tier: number, includeEquipped = false): MergeOutcome {
		const cost = this.catalog.mergeCost(tier + 1);
		if (!this.catalog.has(species) || this.catalog.getTier(tier) === undefined) {
			return fail("NotFound");
		} else if (cost === undefined) {
			return fail("MaxTier");
		}

		const candidates: PetRecord[] = [];
		for (const [, pet] of this.pets) {
			if (pet.species === species && pet.tier === tier && !pet.locked && (includeEquipped || !pet.equipped)) {
				candidates.push(pet);
			}
		}
		if (candidates.size() < cost) {
			return fail("NotEnoughPets");
		}

		// spend unequipped, low level pets first so the ones the player has been training survive
		candidates.sort((a, b) => {
			if (a.equipped !== b.equipped) {
				return !a.equipped;
			} else if (a.level !== b.level) {
				return a.level < b.level;
			}
			return a.obtained < b.obtained;
		});
		const chosen = candidates.filter((_, index) => index < cost);
		return this.combine(species, tier, chosen);
	}

	public mergeSelected(ids: readonly string[]): MergeOutcome {
		const first = ids.size() > 0 ? this.pets.get(ids[0]) : undefined;
		if (first === undefined) {
			return fail("NotFound");
		}

		const cost = this.catalog.mergeCost(first.tier + 1);
		if (cost === undefined) {
			return fail("MaxTier");
		} else if (ids.size() !== cost) {
			return fail("WrongCount");
		}

		const chosen: PetRecord[] = [];
		const seen = new Set<string>();
		for (const id of ids) {
			const pet = this.pets.get(id);
			if (pet === undefined) {
				return fail("NotFound");
			} else if (seen.has(id)) {
				return fail("Duplicate");
			} else if (pet.species !== first.species || pet.tier !== first.tier) {
				return fail("MixedPets");
			} else if (pet.locked) {
				return fail("Locked");
			}
			seen.add(id);
			chosen.push(pet);
		}
		return this.combine(first.species, first.tier, chosen);
	}

	public getMultiplier(): number {
		let total = 1;
		for (const pet of this.equipped) {
			total += this.catalog.multiplierOf(pet);
		}
		return total;
	}

	public getMultiplierBreakdown(): MultiplierBreakdown {
		const pets = this.strongestFirst(table.clone(this.equipped)).map((pet) => ({
			id: pet.id,
			species: pet.species,
			multiplier: this.catalog.multiplierOf(pet),
		}));
		return { total: this.getMultiplier(), pets };
	}

	private newId(): string {
		const id = this.generateId();
		if (this.pets.has(id)) {
			throw `generateId returned "${id}", which is already taken`;
		}
		return id;
	}

	private insert(id: string, species: string, tier: number): PetRecord {
		this.obtainedCount += 1;
		const pet: PetRecord = {
			id,
			species,
			tier,
			level: 1,
			xp: 0,
			locked: false,
			equipped: false,
			obtained: this.obtainedCount,
		};
		this.pets.set(id, pet);
		return pet;
	}

	private delete(pet: PetRecord): void {
		if (pet.equipped) {
			pet.equipped = false;
			this.equipped.remove(this.equipped.indexOf(pet));
		}
		this.pets.delete(pet.id);
		this.emit({ kind: "removed", id: pet.id });
	}

	private combine(species: string, tier: number, consumed: PetRecord[]): MergeOutcome {
		// take the id before touching anything so a failing generator can't leave the merge half done
		const id = this.newId();
		const consumedIds = consumed.map((pet) => pet.id);
		const takesSlot = consumed.some((pet) => pet.equipped);

		for (const pet of consumed) {
			this.delete(pet);
		}

		const pet = this.insert(id, species, tier + 1);
		if (takesSlot) {
			pet.equipped = true;
			this.equipped.push(pet);
		}
		this.emit({ kind: "added", pet });
		return { ok: true, pet, consumed: consumedIds };
	}

	private applyXp(pet: PetRecord, amount: number): { readonly ok: true; levelsGained: number; overflow: number } {
		const maxLevel = this.catalog.get(pet.species)!.maxLevel;
		let level = pet.level;
		let xp = pet.xp + amount;

		while (level < maxLevel) {
			const needed = this.catalog.xpToNext(level);
			if (xp < needed) {
				break;
			}
			xp -= needed;
			level += 1;
		}

		let overflow = 0;
		if (level >= maxLevel) {
			overflow = xp;
			xp = 0;
		}

		const levelsGained = level - pet.level;
		if (level !== pet.level || xp !== pet.xp) {
			pet.level = level;
			pet.xp = xp;
			this.emit({ kind: "updated", pet });
		}
		return { ok: true, levelsGained, overflow };
	}

	private setEquipped(pet: PetRecord, equipped: boolean): void {
		if (pet.equipped === equipped) {
			return;
		}
		pet.equipped = equipped;
		if (equipped) {
			this.equipped.push(pet);
		} else {
			this.equipped.remove(this.equipped.indexOf(pet));
		}
		this.emit({ kind: "updated", pet });
	}

	private trimEquipped(): void {
		if (this.equipped.size() <= this.maxEquipped) {
			return;
		}
		const strongest = this.strongestFirst(table.clone(this.equipped));
		for (let index = this.maxEquipped; index < strongest.size(); index++) {
			this.setEquipped(strongest[index], false);
		}
	}

	private strongestFirst(pets: PetRecord[]): PetRecord[] {
		const multipliers = new Map<PetRecord, number>();
		for (const pet of pets) {
			multipliers.set(pet, this.catalog.multiplierOf(pet));
		}
		// ties go to whichever pet was obtained first, so equipBest gives the same answer every time
		return pets.sort((a, b) => {
			const difference = multipliers.get(a)! - multipliers.get(b)!;
			return difference !== 0 ? difference > 0 : a.obtained < b.obtained;
		});
	}

	private sortedByObtained(): PetRecord[] {
		const pets: PetRecord[] = [];
		for (const [, pet] of this.pets) {
			pets.push(pet);
		}
		return pets.sort((a, b) => a.obtained < b.obtained);
	}

	private emit(change: PetChange): void {
		const listeners: ((change: PetChange) => void)[] = [];
		for (const listener of this.listeners) {
			listeners.push(listener);
		}
		for (const listener of listeners) {
			listener(change);
		}
	}
}
