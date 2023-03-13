/** @param {NS} ns */
export async function main(ns) {
	if (ns.args.length > 1) { await ns.sleep(ns.args[1]) }
	await ns.grow(ns.args[0], { stock: true });
}
