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
	//let files = []
	for (let i = 0; i < hosts.length; ++i) {
		const serv = hosts[i];

		//if the server is home or a purchased server, skip it.
		if (serv == "home" || phosts.includes(serv)) {
			continue;
		}


		//search all servers for ".cct" files and list them in terminal
		let files = ns.ls(serv);

		for(let i = 0; i < files.length; ++i){
		
		if (files[i].split(".")[1] == "cct")
			ns.tprint(serv + ": " + files[i]);

		}

	}
}
