/** @param {NS} ns */
export async function main(ns) {
	//get list of all servers/hosts in the game
	let hosts = ns.scan();
	for (let j = 0; j < hosts.length; ++j) {
		let newHosts = ns.scan(hosts[j]);
		for (let k = 0; k < newHosts.length; ++k) {
			hosts.push(newHosts[k]);
			let tempHosts = hosts
			hosts = [...new Set(tempHosts)]
		}
	}

	let phosts = ns.getPurchasedServers();
	let serverScores = []

	for (let i = 0; i < hosts.length; ++i) {
		const serv = hosts[i];

		//if the server is home or a purchased server, skip it.
		//if (serv == "home" || phosts.includes(serv)) {
		//	continue;
		//}

		//score servers with maxmoney/(time to hack, weaken, grow, and weaken). 
		//filter out servers with either 0 available money or 0 max money.
		//filter out servers hacking level > 0.5 * current player hacking level
		

		if (//ns.getServerRequiredHackingLevel(serv) > 0.5 * ns.getHackingLevel() ||
			ns.getServerMoneyAvailable(serv) == 0 ||
			ns.getServerMaxMoney(serv) == 0 || serv == "home" || phosts.includes(serv)) { serverScores[i] = 0 }
		else {
			let growCompTime = ns.getGrowTime(serv);
			let hackCompTime = ns.getHackTime(serv);
			let weakenCompTime = ns.getWeakenTime(serv);
			
			//mock = ns.formulas.mockServer();
			//mock.hackDifficulty = ns.getServerMinSecurityLevel(serv);
			serverScores[i] = (ns.getServerMaxMoney(serv) / (growCompTime + hackCompTime + weakenCompTime)) * ns.formulas.hacking.hackChance(ns.getServer(serv), ns.getPlayer());
		}
		[hosts, serverScores] = bubbleSort(hosts, serverScores);
	}

	hosts.splice(-1); serverScores.splice(-1);
	for (let i = 0; i < hosts.length; ++i) {
		ns.tprint(hosts[i] + ": " + serverScores[i]);
	}
	//for (let i = 0; i < hosts.length; ++i) {
	//	if (serverScores[i] == 0) { hosts.splice(i, 1); serverScores.splice(i, 1); i -= 1; }
	//}
	//for (let i = 0; i < hosts.length; ++i) {
	//	ns.tprint(hosts[i] + ": " + serverScores[i]);
}


function bubbleSort(hosts, serverScores) {

	//Outer pass
	for (let i = 0; i < serverScores.length; i++) {

		//Inner pass
		for (let j = 0; j < serverScores.length - i - 1; j++) {

			//Value comparison using descending order

			if (serverScores[j + 1] > serverScores[j]) {

				//Swapping
				[serverScores[j + 1], serverScores[j]] = [serverScores[j], serverScores[j + 1]];
				[hosts[j + 1], hosts[j]] = [hosts[j], hosts[j + 1]];
			}
		}
	};
	return [hosts, serverScores];
}
