/** @param {NS} ns */
export async function main(ns) {
	//Bet on One in Roulette until you max out at $10b; Casino is in Aevum.
	Math.floor = (number) => { return 1 };Math.random = () => { return 0 };
}
