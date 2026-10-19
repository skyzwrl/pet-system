/// <reference types="@rbxts/testez/globals" />

import { addPet, makeInventory } from "./fixtures";

export = () => {
	describe("addXp", () => {
		it("keeps partial xp below the next level", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			const result = inventory.addXp(id, 50);

			expect(result.ok && result.levelsGained).to.equal(0);
			expect(inventory.get(id)!.level).to.equal(1);
			expect(inventory.get(id)!.xp).to.equal(50);
		});

		it("levels up exactly at the threshold", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			inventory.addXp(id, 60);
			const result = inventory.addXp(id, 40);

			expect(result.ok && result.levelsGained).to.equal(1);
			expect(inventory.get(id)!.level).to.equal(2);
			expect(inventory.get(id)!.xp).to.equal(0);
		});

		it("applies several levels from one big grant and keeps the remainder", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			// 100 + 200 + 300 gets to level 4, 25 is left over
			const result = inventory.addXp(id, 625);

			expect(result.ok && result.levelsGained).to.equal(3);
			expect(inventory.get(id)!.level).to.equal(4);
			expect(inventory.get(id)!.xp).to.equal(25);
		});

		it("stops at max level and hands back the overflow", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			// level 1 to 10 costs 100 + 200 + ... + 900 = 4500
			const result = inventory.addXp(id, 5000);

			expect(result.ok).to.equal(true);
			if (result.ok) {
				expect(result.levelsGained).to.equal(9);
				expect(result.overflow).to.equal(500);
			}
			expect(inventory.get(id)!.level).to.equal(10);
			expect(inventory.get(id)!.xp).to.equal(0);
		});

		it("returns everything as overflow once the pet is maxed", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");
			inventory.addXp(id, 4500);

			const result = inventory.addXp(id, 300);

			expect(result.ok && result.levelsGained).to.equal(0);
			expect(result.ok && result.overflow).to.equal(300);
		});

		it("throws on amounts that are negative or not finite", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			expect(() => inventory.addXp(id, -1)).to.throw("xp amount");
			expect(() => inventory.addXp(id, 0 / 0)).to.throw("xp amount");
			expect(() => inventory.addXp(id, math.huge)).to.throw("xp amount");
		});

		it("reports pets that don't exist", () => {
			const result = makeInventory().addXp("nope", 10);
			expect(!result.ok && result.reason).to.equal("NotFound");
		});

		it("only reports a change when something moved", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");
			let changes = 0;
			inventory.onChanged(() => changes++);

			inventory.addXp(id, 0);
			expect(changes).to.equal(0);

			inventory.addXp(id, 5);
			expect(changes).to.equal(1);
		});
	});

	describe("addXpToEquipped", () => {
		it("gives the full amount to every equipped pet and nothing to the rest", () => {
			const inventory = makeInventory({ maxEquipped: 2 });
			const a = addPet(inventory, "Dog");
			const b = addPet(inventory, "Cat");
			const benched = addPet(inventory, "Dragon");
			inventory.equip(a);
			inventory.equip(b);

			const levels = inventory.addXpToEquipped(300);

			expect(levels).to.equal(4);
			expect(inventory.get(a)!.level).to.equal(3);
			expect(inventory.get(b)!.level).to.equal(3);
			expect(inventory.get(benched)!.level).to.equal(1);
			expect(inventory.get(benched)!.xp).to.equal(0);
		});
	});
};
