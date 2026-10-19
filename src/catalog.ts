import { isFiniteNumber, isInteger } from "./numbers";

export interface PetDefinition {
	readonly id: string;
	readonly rarity: string;
	readonly multiplier: number;
	readonly maxLevel: number;
}

export interface TierDefinition {
	readonly name: string;
	readonly multiplier: number;
	/** pets of the tier below needed to make one of this tier, unused on the first tier */
	readonly mergeCost?: number;
}

/** xp needed to go from `level` to `level + 1` */
export type XpCurve = (level: number) => number;

export interface CatalogOptions {
	readonly pets: readonly PetDefinition[];
	readonly tiers?: readonly TierDefinition[];
	readonly xpCurve?: XpCurve;
	readonly levelBonus?: number;
}

export interface PetStats {
	readonly species: string;
	readonly tier: number;
	readonly level: number;
}

export const DEFAULT_TIERS: readonly TierDefinition[] = [
	{ name: "Normal", multiplier: 1 },
	{ name: "Golden", multiplier: 2.5, mergeCost: 5 },
	{ name: "Rainbow", multiplier: 6, mergeCost: 5 },
];

export function exponentialXp(base: number, growth: number): XpCurve {
	return (level) => math.floor(base * growth ** (level - 1));
}

export function polynomialXp(base: number, exponent: number): XpCurve {
	return (level) => math.floor(base * level ** exponent);
}

export class PetCatalog {
	public readonly levelBonus: number;
	private readonly pets = new Map<string, PetDefinition>();
	private readonly tiers: readonly TierDefinition[];
	private readonly xpCurve: XpCurve;

	public constructor(options: CatalogOptions) {
		for (const pet of options.pets) {
			if (this.pets.has(pet.id)) {
				throw `duplicate pet "${pet.id}"`;
			} else if (!isFiniteNumber(pet.multiplier) || pet.multiplier < 0) {
				throw `pet "${pet.id}" needs a finite multiplier of 0 or more`;
			} else if (!isInteger(pet.maxLevel) || pet.maxLevel < 1) {
				throw `pet "${pet.id}" needs a whole maxLevel of at least 1`;
			}
			this.pets.set(pet.id, pet);
		}

		const tiers = options.tiers ?? DEFAULT_TIERS;
		if (tiers.size() === 0) {
			throw "at least one tier is needed";
		}
		tiers.forEach((tier, index) => {
			if (!isFiniteNumber(tier.multiplier) || tier.multiplier <= 0) {
				throw `tier "${tier.name}" needs a positive multiplier`;
			} else if (index > 0 && (!isInteger(tier.mergeCost) || tier.mergeCost < 2)) {
				throw `tier "${tier.name}" needs a whole mergeCost of at least 2`;
			}
		});
		this.tiers = tiers;

		this.xpCurve = options.xpCurve ?? exponentialXp(100, 1.25);
		this.levelBonus = options.levelBonus ?? 0.05;
		if (!isFiniteNumber(this.levelBonus) || this.levelBonus < 0) {
			throw "levelBonus must be a finite number of 0 or more";
		}
	}

	public get(species: string): PetDefinition | undefined {
		return this.pets.get(species);
	}

	public has(species: string): boolean {
		return this.pets.has(species);
	}

	public getTier(tier: number): TierDefinition | undefined {
		return this.tiers[tier];
	}

	public highestTier(): number {
		return this.tiers.size() - 1;
	}

	public mergeCost(tier: number): number | undefined {
		return tier > 0 ? this.tiers[tier]?.mergeCost : undefined;
	}

	public xpToNext(level: number): number {
		const needed = this.xpCurve(level);
		// a curve that hands back 0 or NaN would spin the level-up loop forever
		if (!isFiniteNumber(needed) || needed <= 0) {
			throw `xp curve returned ${needed} for level ${level}, it has to be positive`;
		}
		return needed;
	}

	public multiplierOf(pet: PetStats): number {
		const definition = this.pets.get(pet.species);
		const tier = this.tiers[pet.tier];
		if (definition === undefined || tier === undefined) {
			throw `no multiplier for ${pet.species} at tier ${pet.tier}`;
		}
		return definition.multiplier * tier.multiplier * (1 + this.levelBonus * (pet.level - 1));
	}
}
