import { InventoryOptions, PetCatalog, PetInventory } from "..";

// xp to level up is level * 100 and every level past 1 adds 10%, so expected values stay easy to work out
export function makeCatalog(): PetCatalog {
	return new PetCatalog({
		pets: [
			{ id: "Dog", rarity: "Common", multiplier: 1, maxLevel: 10 },
			{ id: "Cat", rarity: "Common", multiplier: 1.5, maxLevel: 10 },
			{ id: "Dragon", rarity: "Legendary", multiplier: 10, maxLevel: 25 },
		],
		xpCurve: (level) => level * 100,
		levelBonus: 0.1,
	});
}

export function sequentialIds(): () => string {
	let count = 0;
	return () => {
		count += 1;
		return `pet${count}`;
	};
}

export function makeInventory(options: InventoryOptions = {}): PetInventory {
	return new PetInventory(makeCatalog(), { generateId: sequentialIds(), ...options });
}

export function addPet(inventory: PetInventory, species: string, tier = 0): string {
	const result = inventory.add(species, tier);
	if (!result.ok) {
		throw `couldn't add ${species}: ${result.reason}`;
	}
	return result.pet.id;
}
