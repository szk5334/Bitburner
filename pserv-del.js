/** @param {NS} ns */
export async function main(ns) {
	var currentServers = ns.getPurchasedServers();
	//ns.tprint(currentServers);
	for (var i = 0; i < currentServers.length; ++i) {
    	//ns.tprint(i);
		var serv = currentServers[i];
		//ns.tprint(serv);
		ns.killall(serv);
		ns.deleteServer(serv);
	}
}
