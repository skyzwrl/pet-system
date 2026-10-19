/// <reference types="@rbxts/testez/globals" />

import { InventoryOptions, PetInventory } from "..";
import { addPet, makeCatalog, makeInventory, sequentialIds } from "./fixtures";

function load(data: unknown, options: InventoryOptions = {}) {
	return PetInventory.load(makeCatalog(), data, { generateId: sequentialIds(), ...options });
}

function loadOk(data: unknown, options: InventoryOptions = {}) {
	const result = load(data, options);
	if (!result.ok) {
		throw `expected the save to load, got: ${result.reason}`;
	}
	return result;
}

function hasProblem(problems: readonly string[], text: string): boolean {
	return problems.some((problem) => string.find(problem, text, 1, true)[0] !== undefined);
}

export = () => {
	describe("round trip", () => {
		it("restores every field and the original order", () => {
			const inventory = makeInventory();
			const dog = addPet(inventory, "Dog");
			const dragon = addPet(inventory, "Dragon", 1);
			const cat = addPet(inventory, "Cat", 2);
			inventory.addXp(dragon, 650);
			inventory.setLocked(dragon, true);
			inventory.equip(dragon);
			inventory.equip(cat);

			const { inventory: restored, problems } = loadOk(inventory.save());

			expect(problems.size()).to.equal(0);
			expect(
				restored
					.getAll()
					.map((pet) => pet.id)
					.join(","),
			).to.equal([dog, dragon, cat].join(","));

			const pet = restored.get(dragon)!;
			expect(pet.tier).to.equal(1);
			expect(pet.level).to.equal(4);
			expect(pet.xp).to.equal(50);
			expect(pet.locked).to.equal(true);
			expect(pet.equipped).to.equal(true);
			expect(restored.get(dog)!.equipped).to.equal(false);
			expect(restored.getMultiplier()).to.be.near(inventory.getMultiplier());
		});

		it("refuses to reuse the id of a loaded pet", () => {
			const inventory = makeInventory();
			addPet(inventory, "Dog");
			const saved = inventory.save();

			const { inventory: restored } = loadOk(saved, { generateId: sequentialIds() });

			expect(() => restored.add("Dog")).to.throw("already taken");
		});
	});

	describe("missing or unreadable saves", () => {
		it("starts a new player with an empty inventory", () => {
			const { inventory, problems } = loadOk(undefined);

			expect(inventory.count()).to.equal(0);
			expect(problems.size()).to.equal(0);
		});

		it("refuses saves it can't read instead of starting empty", () => {
			const notTable = load("garbage");
			expect(!notTable.ok && notTable.reason).to.equal("expected a table, got string");

			const newer = load({ version: 2, pets: [] });
			expect(!newer.ok && newer.reason).to.equal("unsupported save version 2");

			const noPets = load({ version: 1 });
			expect(!noPets.ok && noPets.reason).to.equal("save has no pet list");
		});
	});

	describe("repairs", () => {
		it("drops entries it can't trust and says why", () => {
			const { inventory, problems } = loadOk({
				version: 1,
				pets: [
					["a", "Dog", 0, 1, 0, 0],
					["a", "Dog", 0, 1, 0, 0],
					["b", "Unicorn", 0, 1, 0, 0],
					[5, "Dog", 0, 1, 0, 0],
					"not a pet",
				],
			});

			expect(inventory.count()).to.equal(1);
			expect(inventory.get("a")).to.be.ok();
			expect(problems.size()).to.equal(4);
			expect(hasProblem(problems, "a was saved twice")).to.equal(true);
			expect(hasProblem(problems, 'unknown species "Unicorn"')).to.equal(true);
			expect(hasProblem(problems, "entry 4 has no id or species")).to.equal(true);
			expect(hasProblem(problems, "entry 5 isn't a pet")).to.equal(true);
		});

		it("clamps tiers, levels and flags into range", () => {
			const { inventory, problems } = loadOk({
				version: 1,
				pets: [
					["a", "Dog", 9, 50, 0, 99],
					["b", "Dog", -1, 0.5, -20, "x"],
				],
			});

			const a = inventory.get("a")!;
			expect(a.tier).to.equal(2);
			expect(a.level).to.equal(10);
			expect(a.locked).to.equal(true);
			expect(a.equipped).to.equal(true);

			const b = inventory.get("b")!;
			expect(b.tier).to.equal(0);
			expect(b.level).to.equal(1);
			expect(b.xp).to.equal(0);
			expect(b.locked).to.equal(false);

			expect(hasProblem(problems, "a had tier 9, set to 2")).to.equal(true);
			expect(hasProblem(problems, "b had xp -20, reset to 0")).to.equal(true);
			expect(problems.size()).to.equal(7);
		});

		it("levels pets up when the xp curve got cheaper since they were saved", () => {
			const { inventory, problems } = loadOk({ version: 1, pets: [["a", "Dog", 0, 1, 350, 0]] });

			expect(inventory.get("a")!.level).to.equal(3);
			expect(inventory.get("a")!.xp).to.equal(50);
			expect(problems.size()).to.equal(0);
		});

		it("keeps the strongest pets equipped when the save has too many", () => {
			const { inventory, problems } = loadOk(
				{
					version: 1,
					pets: [
						["dog", "Dog", 0, 1, 0, 2],
						["dragon", "Dragon", 0, 1, 0, 2],
						["cat", "Cat", 0, 1, 0, 2],
					],
				},
				{ maxEquipped: 2 },
			);

			expect(inventory.get("dog")!.equipped).to.equal(false);
			expect(inventory.get("dragon")!.equipped).to.equal(true);
			expect(inventory.get("cat")!.equipped).to.equal(true);
			expect(hasProblem(problems, "3 pets were equipped with 2 slots")).to.equal(true);
		});

		it("keeps every pet when the save is over capacity", () => {
			const { inventory, problems } = loadOk(
				{
					version: 1,
					pets: [
						["a", "Dog", 0, 1, 0, 0],
						["b", "Dog", 0, 1, 0, 0],
					],
				},
				{ capacity: 1 },
			);

			expect(inventory.count()).to.equal(2);
			expect(hasProblem(problems, "holding 2 pets with room for 1")).to.equal(true);
		});
	});
};
