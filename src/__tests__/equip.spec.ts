/// <reference types="@rbxts/testez/globals" />

import { PetInventory } from "..";
import { addPet, makeInventory } from "./fixtures";

function equippedIds(inventory: PetInventory): string {
	return inventory
		.getEquipped()
		.map((pet) => pet.id)
		.sort((a, b) => a < b)
		.join(",");
}

export = () => {
	describe("equip and unequip", () => {
		it("equips up to the slot limit", () => {
			const inventory = makeInventory({ maxEquipped: 2 });
			const a = addPet(inventory, "Dog");
			const b = addPet(inventory, "Dog");
			const c = addPet(inventory, "Dog");

			expect(inventory.equip(a).ok).to.equal(true);
			expect(inventory.equip(b).ok).to.equal(true);

			const full = inventory.equip(c);
			expect(!full.ok && full.reason).to.equal("SlotsFull");
			expect(inventory.get(c)!.equipped).to.equal(false);
		});

		it("explains why an equip or unequip did nothing", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			const notEquipped = inventory.unequip(id);
			expect(!notEquipped.ok && notEquipped.reason).to.equal("NotEquipped");

			inventory.equip(id);
			const again = inventory.equip(id);
			expect(!again.ok && again.reason).to.equal("AlreadyEquipped");

			const missing = inventory.equip("nope");
			expect(!missing.ok && missing.reason).to.equal("NotFound");
		});

		it("lets locked pets be equipped", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dragon");
			inventory.setLocked(id, true);

			expect(inventory.equip(id).ok).to.equal(true);
		});
	});

	describe("equipBest", () => {
		it("picks the pets with the highest multipliers", () => {
			const inventory = makeInventory({ maxEquipped: 2 });
			addPet(inventory, "Dog");
			const cat = addPet(inventory, "Cat");
			const dragon = addPet(inventory, "Dragon");

			inventory.equipBest();

			expect(equippedIds(inventory)).to.equal([cat, dragon].sort((a, b) => a < b).join(","));
		});

		it("counts tier and level, not just the species", () => {
			const inventory = makeInventory({ maxEquipped: 1 });
			const cat = addPet(inventory, "Cat");
			const goldenDog = addPet(inventory, "Dog", 1);

			inventory.equipBest();
			expect(equippedIds(inventory)).to.equal(goldenDog);

			// 1.5 * (1 + 0.1 * 9) = 2.85 beats the golden dog's 2.5
			inventory.addXp(cat, 4500);
			inventory.equipBest();
			expect(equippedIds(inventory)).to.equal(cat);
		});

		it("breaks ties in favour of the pet obtained first", () => {
			const inventory = makeInventory({ maxEquipped: 1 });
			const first = addPet(inventory, "Dog");
			addPet(inventory, "Dog");
			addPet(inventory, "Dog");

			inventory.equipBest();
			expect(equippedIds(inventory)).to.equal(first);
		});

		it("replaces whatever was equipped by hand", () => {
			const inventory = makeInventory({ maxEquipped: 1 });
			const dog = addPet(inventory, "Dog");
			const dragon = addPet(inventory, "Dragon");
			inventory.equip(dog);

			inventory.equipBest();

			expect(inventory.get(dog)!.equipped).to.equal(false);
			expect(equippedIds(inventory)).to.equal(dragon);
		});

		it("doesn't report changes when the best pets are already equipped", () => {
			const inventory = makeInventory({ maxEquipped: 2 });
			addPet(inventory, "Dog");
			addPet(inventory, "Cat");
			addPet(inventory, "Dragon");
			inventory.equipBest();

			let changes = 0;
			inventory.onChanged(() => changes++);
			inventory.equipBest();

			expect(changes).to.equal(0);
		});

		it("never goes over the slot limit while listeners run", () => {
			const inventory = makeInventory({ maxEquipped: 2 });
			const dog = addPet(inventory, "Dog");
			const cat = addPet(inventory, "Cat");
			addPet(inventory, "Dragon");
			addPet(inventory, "Dragon");
			inventory.equip(dog);
			inventory.equip(cat);

			let most = 0;
			inventory.onChanged(() => {
				most = math.max(most, inventory.getEquipped().size());
			});
			inventory.equipBest();

			expect(most).to.equal(2);
		});
	});

	describe("slots", () => {
		it("unequips the weakest pets when slots are taken away", () => {
			const inventory = makeInventory({ maxEquipped: 3 });
			const dog = addPet(inventory, "Dog");
			const cat = addPet(inventory, "Cat");
			const dragon = addPet(inventory, "Dragon");
			inventory.equipBest();

			inventory.setMaxEquipped(1);

			expect(equippedIds(inventory)).to.equal(dragon);
			expect(inventory.get(dog)!.equipped).to.equal(false);
			expect(inventory.get(cat)!.equipped).to.equal(false);
		});
	});

	describe("multiplier", () => {
		it("is 1 with nothing equipped", () => {
			const inventory = makeInventory();
			addPet(inventory, "Dragon");

			expect(inventory.getMultiplier()).to.equal(1);
		});

		it("adds every equipped pet on top of 1", () => {
			const inventory = makeInventory();
			const dog = addPet(inventory, "Dog");
			const cat = addPet(inventory, "Cat");
			addPet(inventory, "Dragon");
			inventory.equip(dog);
			inventory.equip(cat);

			expect(inventory.getMultiplier()).to.be.near(1 + 1 + 1.5);
		});

		it("breaks the total down strongest first", () => {
			const inventory = makeInventory();
			const dog = addPet(inventory, "Dog");
			const dragon = addPet(inventory, "Dragon", 1);
			inventory.equip(dog);
			inventory.equip(dragon);

			const breakdown = inventory.getMultiplierBreakdown();

			expect(breakdown.pets.size()).to.equal(2);
			expect(breakdown.pets[0].id).to.equal(dragon);
			expect(breakdown.pets[0].multiplier).to.be.near(25);
			expect(breakdown.pets[1].multiplier).to.be.near(1);
			expect(breakdown.total).to.be.near(1 + breakdown.pets[0].multiplier + breakdown.pets[1].multiplier);
		});
	});
};
