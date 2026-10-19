/// <reference types="@rbxts/testez/globals" />

import { PetInventory } from "..";
import { addPet, makeInventory } from "./fixtures";

function addMany(inventory: PetInventory, species: string, amount: number, tier = 0): string[] {
	const ids: string[] = [];
	for (let index = 0; index < amount; index++) {
		ids.push(addPet(inventory, species, tier));
	}
	return ids;
}

function sortedIds(ids: readonly string[]): string {
	const copy = [...ids];
	return copy.sort((a, b) => a < b).join(",");
}

export = () => {
	describe("merge", () => {
		it("turns five normal pets into one golden", () => {
			const inventory = makeInventory();
			addMany(inventory, "Dog", 6);

			const result = inventory.merge("Dog", 0);

			expect(result.ok).to.equal(true);
			if (result.ok) {
				expect(result.pet.tier).to.equal(1);
				expect(result.pet.level).to.equal(1);
				expect(result.consumed.size()).to.equal(5);
			}
			expect(inventory.count()).to.equal(2);
			expect(inventory.countOf("Dog", 0)).to.equal(1);
			expect(inventory.countOf("Dog", 1)).to.equal(1);
		});

		it("spends unequipped, low level pets before trained or equipped ones", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 7);
			inventory.addXp(ids[0], 600);
			inventory.addXp(ids[1], 100);
			inventory.equip(ids[2]);

			const result = inventory.merge("Dog", 0);

			expect(result.ok).to.equal(true);
			if (result.ok) {
				expect(sortedIds(result.consumed)).to.equal(sortedIds([ids[1], ids[3], ids[4], ids[5], ids[6]]));
			}
			expect(inventory.get(ids[0])).to.be.ok();
			expect(inventory.get(ids[2])).to.be.ok();
		});

		it("leaves locked pets alone and says when there aren't enough", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 5);
			inventory.setLocked(ids[0], true);

			const result = inventory.merge("Dog", 0);

			expect(!result.ok && result.reason).to.equal("NotEnoughPets");
			expect(inventory.count()).to.equal(5);
		});

		it("can use equipped pets when asked, and the result keeps their slot", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 5);
			inventory.equip(ids[0]);
			inventory.equip(ids[1]);

			expect(inventory.merge("Dog", 0).ok).to.equal(false);

			const result = inventory.merge("Dog", 0, true);
			expect(result.ok).to.equal(true);
			if (result.ok) {
				expect(result.pet.equipped).to.equal(true);
			}
			expect(inventory.getEquipped().size()).to.equal(1);
		});

		it("chains golden into rainbow", () => {
			const inventory = makeInventory();
			addMany(inventory, "Cat", 25);

			for (let index = 0; index < 5; index++) {
				expect(inventory.merge("Cat", 0).ok).to.equal(true);
			}
			const rainbow = inventory.merge("Cat", 1);

			expect(rainbow.ok).to.equal(true);
			expect(inventory.count()).to.equal(1);
			if (rainbow.ok) {
				expect(rainbow.pet.tier).to.equal(2);
				expect(inventory.catalog.multiplierOf(rainbow.pet)).to.be.near(1.5 * 6);
			}
		});

		it("stops at the highest tier", () => {
			const inventory = makeInventory();
			addMany(inventory, "Dog", 5, 2);

			const result = inventory.merge("Dog", 2);
			expect(!result.ok && result.reason).to.equal("MaxTier");
		});

		it("reports species and tiers that don't exist", () => {
			const inventory = makeInventory();

			const species = inventory.merge("Unicorn", 0);
			expect(!species.ok && species.reason).to.equal("NotFound");

			const tier = inventory.merge("Dog", 7);
			expect(!tier.ok && tier.reason).to.equal("NotFound");
		});

		it("changes nothing when it fails", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 4);
			let changes = 0;
			inventory.onChanged(() => changes++);

			inventory.merge("Dog", 0);

			expect(changes).to.equal(0);
			for (const id of ids) {
				expect(inventory.get(id)).to.be.ok();
			}
		});

		it("doesn't remove anything if the id generator throws", () => {
			let calls = 0;
			const inventory = makeInventory({
				generateId: () => {
					calls += 1;
					return calls <= 5 ? `pet${calls}` : "pet1";
				},
			});
			addMany(inventory, "Dog", 5);

			expect(() => inventory.merge("Dog", 0)).to.throw("already taken");
			expect(inventory.count()).to.equal(5);
		});
	});

	describe("mergeSelected", () => {
		it("consumes exactly the pets the player picked", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 6);
			const picked = [ids[5], ids[4], ids[3], ids[2], ids[1]];

			const result = inventory.mergeSelected(picked);

			expect(result.ok).to.equal(true);
			if (result.ok) {
				expect(sortedIds(result.consumed)).to.equal(sortedIds(picked));
			}
			expect(inventory.get(ids[0])).to.be.ok();
		});

		it("lets equipped picks through and keeps the slot", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 5);
			inventory.equip(ids[2]);

			const result = inventory.mergeSelected(ids);

			expect(result.ok && result.pet.equipped).to.equal(true);
		});

		it("rejects the wrong number of pets", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 4);

			const result = inventory.mergeSelected(ids);
			expect(!result.ok && result.reason).to.equal("WrongCount");
		});

		it("rejects mixed species or tiers", () => {
			const inventory = makeInventory();
			const dogs = addMany(inventory, "Dog", 4);
			const cat = addPet(inventory, "Cat");
			const golden = addPet(inventory, "Dog", 1);

			const species = inventory.mergeSelected([...dogs, cat]);
			expect(!species.ok && species.reason).to.equal("MixedPets");

			const tiers = inventory.mergeSelected([...dogs, golden]);
			expect(!tiers.ok && tiers.reason).to.equal("MixedPets");
			expect(inventory.count()).to.equal(6);
		});

		it("rejects locked, repeated and missing pets", () => {
			const inventory = makeInventory();
			const ids = addMany(inventory, "Dog", 5);

			const repeated = inventory.mergeSelected([ids[0], ids[0], ids[1], ids[2], ids[3]]);
			expect(!repeated.ok && repeated.reason).to.equal("Duplicate");

			const missing = inventory.mergeSelected([ids[0], ids[1], ids[2], ids[3], "nope"]);
			expect(!missing.ok && missing.reason).to.equal("NotFound");

			inventory.setLocked(ids[4], true);
			const locked = inventory.mergeSelected(ids);
			expect(!locked.ok && locked.reason).to.equal("Locked");

			const empty = inventory.mergeSelected([]);
			expect(!empty.ok && empty.reason).to.equal("NotFound");
			expect(inventory.count()).to.equal(5);
		});
	});
};
