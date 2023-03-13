/*
Format for running is "run genpath.ns <target_node>" example: 
[home ~/]> run genpath.ns I.I.I.I
*/

export function autocomplete(data, args) {
return [...data.servers];
}

/** @param {NS} ns **/
export async function main(ns) {
	var temp = ns.scan(ns.args[0]) //initializing temp to array of scan of target system
	var path = ""; //initializing final output
	var prev = temp[0]; //intitializing previous server to first result (previous server) of the temp scan
	var done = 0; //prepping for while loop
	while (done == 0){ //workloop start  this could probably just be a ture/false or 1/0, optimize as you will
		if (prev == "home"){ //when the previous server is home, trigger this
			ns.tprint("\n" + path + "connect " + ns.args[0]); //compile the final path to the target
			done = 1; //set var to get us out of the while loop, ending the program.
		}
		else { //if the previous server is anything other than home, this runs
			temp = ns.scan(prev); //scan the next server in the path
			path = "connect " + prev + ";" + path;  // compile the current path
			prev = temp[0]; //set the previous server as the new server to scan from
		}
	}
}
