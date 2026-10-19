/// <reference types="@rbxts/testez/globals" />

import { PetChange, PetInventory } from "..";
import { addPet, makeCatalog, makeInventory } from "./fixtures";

function describeChange(change: PetChange): string {
	return change.kind === "removed" ? `removed ${change.id}` : `${change.kind} ${change.pet.id}`;
}

export = () => {
	describe("adding", () => {
		it("adds pets at level 1 with ids from the generator", () => {
			const inventory = makeInventory();
			const result = inventory.add("Dog");

			expect(result.ok).to.equal(true);
			if (result.ok) {
				expect(result.pet.id).to.equal("pet1");
				expect(result.pet.species).to.equal("Dog");
				expect(result.pet.tier).to.equal(0);
				expect(result.pet.level).to.equal(1);
				expect(result.pet.xp).to.equal(0);
				expect(result.pet.equipped).to.equal(false);
			}
			expect(inventory.count()).to.equal(1);
		});

		it("can add straight into a higher tier", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Cat", 2);

			expect(inventory.get(id)!.tier).to.equal(2);
		});

		it("throws for species or tiers the catalog doesn't have", () => {
			const inventory = makeInventory();

			expect(() => inventory.add("Unicorn")).to.throw('unknown species "Unicorn"');
			expect(() => inventory.add("Dog", 3)).to.throw("tier 3");
		});

		it("refuses an id generator that repeats itself", () => {
			const inventory = new PetInventory(makeCatalog(), { generateId: () => "same" });

			inventory.add("Dog");
			expect(() => inventory.add("Dog")).to.throw("already taken");
			expect(inventory.count()).to.equal(1);
		});

		it("rejects bad capacity and slot counts", () => {
			expect(() => makeInventory({ capacity: -1 })).to.throw("capacity");
			expect(() => makeInventory({ maxEquipped: 1.5 })).to.throw("maxEquipped");
		});
	});

	describe("storage", () => {
		it("blocks adding once storage is full", () => {
			const inventory = makeInventory({ capacity: 2 });
			addPet(inventory, "Dog");
			addPet(inventory, "Dog");

			const result = inventory.add("Dog");
			expect(result.ok).to.equal(false);
			if (!result.ok) {
				expect(result.reason).to.equal("StorageFull");
			}
			expect(inventory.freeSpace()).to.equal(0);

			inventory.setCapacity(3);
			expect(inventory.add("Dog").ok).to.equal(true);
		});

		it("never deletes pets when capacity is lowered", () => {
			const inventory = makeInventory();
			addPet(inventory, "Dog");
			addPet(inventory, "Cat");
			addPet(inventory, "Dragon");

			inventory.setCapacity(1);

			expect(inventory.count()).to.equal(3);
			expect(inventory.freeSpace()).to.equal(0);
			expect(inventory.add("Dog").ok).to.equal(false);
		});
	});

	describe("removing and locking", () => {
		it("removes pets and reports ones that don't exist", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dog");

			expect(inventory.remove(id).ok).to.equal(true);
			expect(inventory.get(id)).never.to.be.ok();

			const missing = inventory.remove(id);
			expect(!missing.ok && missing.reason).to.equal("NotFound");
		});

		it("won't remove locked pets until they're unlocked", () => {
			const inventory = makeInventory();
			const id = addPet(inventory, "Dragon");
			inventory.setLocked(id, true);

			const result = inventory.remove(id);
			expect(!result.ok && result.reason).to.equal("Locked");
			expect(inventory.count()).to.equal(1);

			inventory.setLocked(id, false);
			expect(inventory.remove(id).ok).to.equal(true);
		});

		it("frees the equip slot when an equipped pet is removed", () => {
			const inventory = makeInventory({ maxEquipped: 1 });
			const first = addPet(inventory, "Dog");
			const second = addPet(inventory, "Cat");
			inventory.equip(first);

			inventory.remove(first);

			expect(inventory.getEquipped().size()).to.equal(0);
			expect(inventory.equip(second).ok).to.equal(true);
		});

		it("removes many pets all or nothing", () => {
			const inventory = makeInventory();
			const a = addPet(inventory, "Dog");
			const b = addPet(inventory, "Dog");
			const c = addPet(inventory, "Dog");
			inventory.setLocked(c, true);

			const blocked = inventory.removeMany([a, b, c]);
			expect(!blocked.ok && blocked.reason).to.equal("Locked");
			expect(inventory.count()).to.equal(3);

			const repeated = inventory.removeMany([a, a]);
			expect(!repeated.ok && repeated.reason).to.equal("Duplicate");
			expect(inventory.count()).to.equal(3);

			expect(inventory.removeMany([a, b]).ok).to.equal(true);
			expect(inventory.count()).to.equal(1);
			expect(inventory.get(c)).to.be.ok();
		});

		it("reports NotFound when locking a missing pet", () => {
			const result = makeInventory().setLocked("nope", true);
			expect(!result.ok && result.reason).to.equal("NotFound");
		});
	});

	describe("queries", () => {
		it("lists pets in the order they were obtained", () => {
			const inventory = makeInventory();
			addPet(inventory, "Dragon");
			addPet(inventory, "Dog");
			addPet(inventory, "Cat");

			expect(
				inventory
					.getAll()
					.map((pet) => pet.species)
					.join(","),
			).to.equal("Dragon,Dog,Cat");
		});

		it("counts pets by species and tier", () => {
			const inventory = makeInventory();
			addPet(inventory, "Dog");
			addPet(inventory, "Dog");
			addPet(inventory, "Dog", 1);
			addPet(inventory, "Cat");

			expect(inventory.countOf("Dog")).to.equal(3);
			expect(inventory.countOf("Dog", 0)).to.equal(2);
			expect(inventory.countOf("Dog", 1)).to.equal(1);
			expect(inventory.countOf("Dragon")).to.equal(0);
		});
	});

	describe("changes", () => {
		it("reports adds, updates and removals in order", () => {
			const inventory = makeInventory();
			const changes: string[] = [];
			inventory.onChanged((change) => changes.push(describeChange(change)));

			const id = addPet(inventory, "Dog");
			inventory.equip(id);
			inventory.setLocked(id, true);
			inventory.setLocked(id, true);
			inventory.setLocked(id, false);
			inventory.remove(id);

			expect(changes.join(",")).to.equal("added pet1,updated pet1,updated pet1,updated pet1,removed pet1");
		});

		it("stops calling a listener once disconnected", () => {
			const inventory = makeInventory();
			let calls = 0;
			const disconnect = inventory.onChanged(() => calls++);

			addPet(inventory, "Dog");
			disconnect();
			addPet(inventory, "Dog");

			expect(calls).to.equal(1);
		});
	});
};
