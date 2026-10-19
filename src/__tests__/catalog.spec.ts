/// <reference types="@rbxts/testez/globals" />

import { DEFAULT_TIERS, exponentialXp, PetCatalog, polynomialXp } from "..";
import { makeCatalog } from "./fixtures";

const dog = { id: "Dog", rarity: "Common", multiplier: 1, maxLevel: 10 };

export = () => {
	describe("validation", () => {
		it("rejects duplicate pets", () => {
			expect(() => new PetCatalog({ pets: [dog, dog] })).to.throw('duplicate pet "Dog"');
		});

		it("rejects multipliers that are negative or not finite", () => {
			expect(() => new PetCatalog({ pets: [{ ...dog, multiplier: -1 }] })).to.throw("multiplier");
			expect(() => new PetCatalog({ pets: [{ ...dog, multiplier: 0 / 0 }] })).to.throw("multiplier");
			expect(() => new PetCatalog({ pets: [{ ...dog, multiplier: math.huge }] })).to.throw("multiplier");
		});

		it("rejects max levels below 1 or with fractions", () => {
			expect(() => new PetCatalog({ pets: [{ ...dog, maxLevel: 0 }] })).to.throw("maxLevel");
			expect(() => new PetCatalog({ pets: [{ ...dog, maxLevel: 2.5 }] })).to.throw("maxLevel");
		});

		it("needs a merge cost of at least 2 on every tier past the first", () => {
			expect(
				() =>
					new PetCatalog({
						pets: [dog],
						tiers: [
							{ name: "Normal", multiplier: 1 },
							{ name: "Golden", multiplier: 2 },
						],
					}),
			).to.throw('tier "Golden" needs a whole mergeCost');
			expect(
				() =>
					new PetCatalog({
						pets: [dog],
						tiers: [
							{ name: "Normal", multiplier: 1 },
							{ name: "Golden", multiplier: 2, mergeCost: 1 },
						],
					}),
			).to.throw("mergeCost");
		});

		it("rejects an empty tier list and a negative level bonus", () => {
			expect(() => new PetCatalog({ pets: [dog], tiers: [] })).to.throw("at least one tier");
			expect(() => new PetCatalog({ pets: [dog], levelBonus: -0.1 })).to.throw("levelBonus");
		});

		it("refuses xp curves that hand back zero", () => {
			const catalog = new PetCatalog({ pets: [dog], xpCurve: () => 0 });
			expect(() => catalog.xpToNext(1)).to.throw("has to be positive");
		});
	});

	describe("rules", () => {
		it("multiplies base, tier and level together", () => {
			const catalog = makeCatalog();

			expect(catalog.multiplierOf({ species: "Dog", tier: 0, level: 1 })).to.be.near(1);
			expect(catalog.multiplierOf({ species: "Dragon", tier: 1, level: 5 })).to.be.near(10 * 2.5 * 1.4);
			expect(catalog.multiplierOf({ species: "Cat", tier: 2, level: 10 })).to.be.near(1.5 * 6 * 1.9);
		});

		it("looks up merge costs by the tier being made", () => {
			const catalog = makeCatalog();

			expect(catalog.mergeCost(0)).never.to.be.ok();
			expect(catalog.mergeCost(1)).to.equal(5);
			expect(catalog.mergeCost(2)).to.equal(5);
			expect(catalog.mergeCost(3)).never.to.be.ok();
			expect(catalog.highestTier()).to.equal(DEFAULT_TIERS.size() - 1);
		});

		it("builds exponential and polynomial xp curves", () => {
			expect(exponentialXp(100, 2)(1)).to.equal(100);
			expect(exponentialXp(100, 2)(3)).to.equal(400);
			expect(exponentialXp(100, 1.5)(2)).to.equal(150);
			expect(polynomialXp(50, 2)(3)).to.equal(450);
		});
	});
};
