/** @param {NS} ns */
export async function main(ns) {
	//get list of all servers/hosts in the game
	let hosts = ns.scan();
	for(let j=0; j < hosts.length; ++j){
		let newHosts = ns.scan(hosts[j]);
		for(let k=0; k < newHosts.length; ++k){
			hosts.push(newHosts[k]);
			let tempHosts = hosts
			hosts = [...new Set(tempHosts)]
		}
	}

	let phosts = ns.getPurchasedServers();

	for (let i = 0; i < hosts.length; ++i) {
        const serv = hosts[i];

		//if the server is home or a purchased server, skip it.
		if(serv == "home" || phosts.includes(serv)){
			continue;
		}
		
		//open all ports possible
		let ports = 0;
		if(ns.fileExists("BruteSSH.exe", "home")){ns.brutessh(serv); ++ports;}
		if(ns.fileExists("FTPCrack.exe", "home")){ns.ftpcrack(serv); ++ports;}
		if(ns.fileExists("relaySMTP.exe", "home")){ns.relaysmtp(serv); ++ports;}
		if(ns.fileExists("HTTPWorm.exe", "home")){ns.httpworm(serv); ++ports;}
		if(ns.fileExists("SQLInject.exe", "home")){ns.sqlinject(serv); ++ports;}
		
		//gain root access if we can open enough ports
		if (ports >= ns.getServerNumPortsRequired(serv)){
			ns.nuke(serv);
		}
	}
}
