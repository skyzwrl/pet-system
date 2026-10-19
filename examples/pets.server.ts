import { Players, ReplicatedStorage } from "@rbxts/services";
import { PetCatalog, PetInventory, SavedInventory } from "@skyzwrl/pet-system";

// whatever the game already uses for player data
declare function loadSavedPets(player: Player): unknown;
declare function storeSavedPets(player: Player, pets: SavedInventory): void;

const catalog = new PetCatalog({
	pets: [
		{ id: "Dog", rarity: "Common", multiplier: 0.25, maxLevel: 50 },
		{ id: "Bunny", rarity: "Uncommon", multiplier: 0.6, maxLevel: 50 },
		{ id: "Phoenix", rarity: "Legendary", multiplier: 4, maxLevel: 100 },
	],
});

const remotes = ReplicatedStorage.WaitForChild("PetRemotes") as Folder;
const equipBestRemote = remotes.WaitForChild("EquipBest") as RemoteEvent;
const mergeRemote = remotes.WaitForChild("Merge") as RemoteEvent;
const petChanged = remotes.WaitForChild("PetChanged") as RemoteEvent;

const inventories = new Map<Player, PetInventory>();

Players.PlayerAdded.Connect((player) => {
	const result = PetInventory.load(catalog, loadSavedPets(player), { capacity: 150, maxEquipped: 4 });
	if (!result.ok) {
		player.Kick("Your pets didn't load, rejoin and try again");
		return;
	}
	for (const problem of result.problems) {
		warn(`pets for ${player.Name}: ${problem}`);
	}

	const inventory = result.inventory;
	inventory.onChanged((change) => petChanged.FireClient(player, change));
	inventories.set(player, inventory);
});

Players.PlayerRemoving.Connect((player) => {
	const inventory = inventories.get(player);
	if (inventory) {
		storeSavedPets(player, inventory.save());
		inventories.delete(player);
	}
});

equipBestRemote.OnServerEvent.Connect((player) => {
	inventories.get(player)?.equipBest();
});

mergeRemote.OnServerEvent.Connect((player, ids) => {
	const inventory = inventories.get(player);
	if (inventory === undefined || !typeIs(ids, "table")) {
		return;
	}
	const picked = (ids as defined[]).filter((id): id is string => typeIs(id, "string"));
	inventory.mergeSelected(picked);
});

export function hatch(player: Player, species: string): boolean {
	const inventory = inventories.get(player);
	return inventory !== undefined && inventory.add(species).ok;
}

export function petMultiplier(player: Player): number {
	return inventories.get(player)?.getMultiplier() ?? 1;
}
