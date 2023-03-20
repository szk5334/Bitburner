/** @param {NS} ns */
export async function main(ns) {
	let pservs = ns.getPurchasedServers();

	//get array of upgrade costs
	let upgradeCosts = pservs.map(server => ns.getPurchasedServerUpgradeCost(server, ns.getServerMaxRam(server) * 2))

	//combine the arrays such that the server name and cost are the same index, [i][0] and [i][1] respectively
	let temp_serversAndCosts = pservs.map((server, i) => [server, upgradeCosts[i]])

	//filter out any NaN costs
	let serversAndCosts = temp_serversAndCosts.filter(server => server[1] !== NaN)

	//sort serversAndCosts by cheapest to most expensive
	serversAndCosts.sort((a, b) => a[1] - b[1])

	let totalCost = upgradeCosts.reduce((a, c) => a + c)

	if (await ns.prompt("Total cost is " + ns.nFormat(totalCost, '0.000a'), { type: "boolean" })) {
		//upgrade the servers
		serversAndCosts.forEach(serverAndCost => ns.upgradePurchasedServer(serverAndCost[0], ns.getServerMaxRam(serverAndCost[0]) * 2))
	}
}
