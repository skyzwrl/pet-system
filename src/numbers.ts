export function isFiniteNumber(value: unknown): value is number {
	return typeIs(value, "number") && value === value && math.abs(value) !== math.huge;
}

export function isInteger(value: unknown): value is number {
	return isFiniteNumber(value) && value % 1 === 0;
}
