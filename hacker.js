// If the percentage of money on server is LESS than this, grow it to max
const growPercent = 90
// hack the sever only if the percentage of money on server is MORE than this 
const hackPercent = 70
// hack the sever only if the security of the server is this many above the minimal
const secThreshold = 50
// amount of server's max money to hack
const hackPct = 0.4;

//variable to determine how much space to leave available on home server
let reservedHomeSpace = 32;

//variable to determine how much space to leave available on all servers
let reservedServerSpace = 0;

//Variable to determine how much of total server RAM to use. in decimal percentage (0.5 = 50%)
let globalMemoryUsage = 1;

//variable to determine how much (max) of the remaining RAM to use. 
let targetRAMslice = 0.75;    //values less than 1 seem to increase the dynamic cycling of the target list
//values less than 0.5 seem to hinder production

//turn on/off shotgun "batching" mode. If this is true, make sure fullMonty is false.
const shotgunBatching = false;

//turn on/off full-monty mode (turns off limitation of scripts running multiple times on the same server)
//ensure shotgunBatching is false if this is true
const fullMonty = false;

//limit targets to the number specified, otherwise target all prioritized targets
const limitTargets = true;
const targetLimit = 3;
const dynamicTargeting = true;
const dynamicTargetingCap = 7;
let targetLimitMod = 0; //modified by script, leave at 0. Will never be negative.

//array to hold PIDs of _weaken scripts associated with their respective servers and expected termination times
let weakenPIDs = []
//array to hold PIDs of _grow scripts associated with their respective servers and expected termination times
let growPIDs = []
//array to hold PIDs of _hack scripts associated with their respective servers and expected termination times
let hackPIDs = []

// time to sleep in miliseconds between main loop executions
const buffer = 200;


/** @param {NS} ns **/
export async function main(ns) {
    ///////////////////////////////DEBUGGING/////////////////////////////////    
    //reservedHomeSpace = ns.getServerMaxRam("home")

    //prime all optimal servers in the background for better targeting 
    while (true) {
        // scan and hack all accesible servers
        var servers = scanAndHack(ns);
        // ns.tprint(`servers:${[...servers.values()]}`)

        // transfer file to servers
        distribute(ns);

        // find servers that we can run scripts on
        var freeRams = getFreeRam(ns, servers);
        // ns.tprint(`freeRams:${freeRams.map(value => JSON.stringify(value))}`)



        // find servers that we can hack, targeting optimal servers
        //var hackables = getHackable(ns, servers);
        var hackables = targetList(ns);

        // get currently running scripts on servers
        var hackstates = getHackStates(ns, servers, hackables);

        //limit the number of targets as set by targetLimit
        if (limitTargets) { hackables.splice(targetLimit + targetLimitMod) }


        let adjustedTargetRAMslice = targetRAMslice;
        [hackstates, adjustedTargetRAMslice] = adjust(ns, servers, freeRams, hackables, hackstates);


        // ns.tprint(`hackable:${[...hackables.values()]}`)
        // ns.tprint(`hackstates:${[...hackstates.entries()].map((v, _i) => `${v[0]}:{${JSON.stringify(v[1])}}\n`)}`)

        // Main logic sits here, determine whether or not and how many threads
        // we should call weaken, grow and hack asynchronously 
        manageAndHack(ns, freeRams, hackables, hackstates, adjustedTargetRAMslice)

        await ns.sleep(buffer)
    }
}

function adjust(ns, servers, freeRams, hackables, hackstates) {

    let adjustedTargetRAMslice = targetRAMslice;

    //total free ram in network, then calculate total thread capacity
    let totalFreeRAM = 0;
    for (let i = 0; i < freeRams.length; ++i) {
        totalFreeRAM += freeRams[i].freeRam;
    }
    //ASSUMPTION: _weaken.js, _grow.js, and _hack.js are all the same size
    let threadCapactiy = totalFreeRAM / ns.getScriptRam("_weaken.js");


    //calculate total threads necessary for this cycle
    let totalThreads = 0;
    for (let target of hackables.values()) {
        let secDiff = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target)
        if (secDiff > 0) {
            totalThreads += Math.floor(secDiff / 0.05)
                - hackstates.get(target).weaken;
        }

        let moneyPercent = (ns.getServerMoneyAvailable(target) / ns.getServerMaxMoney(target)) * 100
        if (moneyPercent < growPercent) {
            totalThreads += Math.floor(ns.growthAnalyze(target, 100 / moneyPercent))
                - hackstates.get(target).grow;
        }

        if (moneyPercent > hackPercent && secDiff < secThreshold) {
            totalThreads += Math.floor(ns.hackAnalyzeThreads(target, ns.getServerMoneyAvailable(target) * hackPct))
                - hackstates.get(target).hack
        }
    }

    //use totalThreads to calculate ratios for each target's operations this cycle
    for (let hackable of hackables.values()) {
        let secDiff = ns.getServerSecurityLevel(hackable) - ns.getServerMinSecurityLevel(hackable)
        let moneyPercent = (ns.getServerMoneyAvailable(hackable) / ns.getServerMaxMoney(hackable)) * 100
        if (hackstates.has(hackable)) {
            ///////////////////////////////DEBUGGING/////////////////////////////////
            hackstates.get(hackable).wRatio = (Math.floor(secDiff / 0.05) - hackstates.get(hackable).weaken) / totalThreads
            //ns.tprint(hackable + " wRatio: " + hackstates.get(hackable).wRatio)
            ///////////////////////////////DEBUGGING/////////////////////////////////
            hackstates.get(hackable).gRatio = (Math.floor(ns.growthAnalyze(hackable, 100 / moneyPercent)) - hackstates.get(hackable).grow) / totalThreads
            //ns.tprint(hackable + " gRatio: " + hackstates.get(hackable).gRatio)
            ///////////////////////////////DEBUGGING/////////////////////////////////
            hackstates.get(hackable).hRatio = (Math.floor(ns.hackAnalyzeThreads(hackable, ns.getServerMoneyAvailable(hackable) * hackPct)) - hackstates.get(hackable).hack) / totalThreads
            //ns.tprint(hackable + " hRatio: " + hackstates.get(hackable).hRatio)
            hackstates.get(hackable).wMaxThreads = Math.floor(threadCapactiy * hackstates.get(hackable).wRatio)
            hackstates.get(hackable).gMaxThreads = Math.floor(threadCapactiy * hackstates.get(hackable).gRatio)
            hackstates.get(hackable).hMaxThreads = Math.floor(threadCapactiy * hackstates.get(hackable).hRatio)

            //iterate through the freeRams and weakenPIDs, growPIDs, and hackPIDs to determine if the script can be run on the given server
            //server must not be running either hack grow or weaken, if trying to run hack grow or weaken respectively
            //server must also have free ram available greater than the size of the script

            //Reset the viable server count
            hackstates.get(hackable).wCount = 0;
            hackstates.get(hackable).gCount = 0;
            hackstates.get(hackable).hCount = 0;

            //first check the servers for enough space
            for (let i = 0; i < freeRams.length; ++i) {

                //if the server has enough free ram to run, check to see if it is running an instance of weaken/grow/hack with hackable as the target 
                if (freeRams[i].freeRam >= ns.getScriptRam("_weaken.js")) {
                    //iterate through the weaken PIDs, if the current server is not running a weaken script 
                    //targetted at hackable, count it as a viable server

                    let isViable = true;
                    for (let j = 0; j < weakenPIDs.length; ++j) {
                        //check for weaken scripts running with this hackable as its target whose host is the same as the server with free ram,
                        //if we find a weaken script running with this hackable a sa target on this server with free ram, it is not viable
                        if (weakenPIDs[j].server == freeRams[i].host && weakenPIDs[j].hackable == hackable) {
                            isViable = false;
                        }

                    }
                    if (isViable || fullMonty) { hackstates.get(hackable).wCount += 1; }

                    isViable = true;
                    for (let j = 0; j < growPIDs.length; ++j) {
                        //check for grow scripts running with this hackable as its target whose host is the same as the server with free ram,
                        //if we find a grow script running with this hackable as a target on this server with free ram, it is not viable
                        if (growPIDs[j].server == freeRams[i].host && growPIDs[j].hackable == hackable) {
                            isViable = false;
                        }

                    }
                    if (isViable || fullMonty) { hackstates.get(hackable).gCount += 1; }

                    isViable = true;
                    for (let j = 0; j < hackPIDs.length; ++j) {
                        //check for hack scripts running with this hackable as its target whose host is the same as the server with free ram,
                        //if we find a hack script running with this hackable a sa target on this server with free ram, it is not viable
                        if (hackPIDs[j].server == freeRams[i].host && hackPIDs[j].hackable == hackable) {
                            isViable = false;
                        }

                    }
                    if (isViable || fullMonty) { hackstates.get(hackable).hCount += 1; }
                }
            }
        }
    }

    let cantRunCount = 0
    //check that all hackables are able to perform their operations for this round. If they cannot, count them. 
    //If the count >= the length of hackables, add a target. Otherwise do nothing.
    for (let target of hackables.values()) {
        let secDiff = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target)
        let moneyPercent = (ns.getServerMoneyAvailable(target) / ns.getServerMaxMoney(target)) * 100
        if (secDiff > 0) {

            //if no viables servers found for this target's operation, increment the cantRunCount
            if (hackstates.get(target).wCount == 0) { cantRunCount += 1 }
        }

        else if (moneyPercent < growPercent) {

            //if no viables servers found for this target's operation, increment the cantRunCount
            if (hackstates.get(target).gCount == 0) { cantRunCount += 1 }
        }

        else if (moneyPercent > hackPercent && secDiff < secThreshold) {

            //if no viables servers found for this target's operation, increment the cantRunCount
            if (hackstates.get(target).hCount == 0) { cantRunCount += 1 }

        }
    }


    //Count servers with enough RAM to run one thread 
    //ASSUMPTION: (all of _weaken, _hack, and _grow are the same size)
    let haveSpaceRAM = 0;
    let haveSpaceSlice = 0;
    let scriptSize = ns.getScriptRam("_weaken.js");

    for (let i = 0; i < freeRams.length; ++i) {
        if (freeRams[i].freeRam >= scriptSize) {
            //ns.tprint(freeRams[i].freeRam);
            haveSpaceRAM += 1
        }
        if (freeRams[i].freeRam * targetRAMslice >= scriptSize) {
            //ns.tprint(freeRams[i].freeRam * targetRAMslice);
            haveSpaceSlice += 1
        }

    }

    //

    if (dynamicTargeting) {
        //determine if number of targets or RAMslice should change, or both, or neither.
        if (totalThreads == 0) {
            if (haveSpaceSlice > 0) {
                //ns.tprint("No Threads, Have Slice Space, Add Target")
                if (targetLimitMod + targetLimit < dynamicTargetingCap) { targetLimitMod += 1; }
            }
            else if (haveSpaceRAM > 0) {
                //ns.tprint("No Threads, Have RAM Space, Add Target")
                if (targetLimitMod + targetLimit < dynamicTargetingCap) { targetLimitMod += 1; }
                adjustTargetRAMslice = 1;
            }
            else {
                //ns.tprint("No Threads, No RAM Space");
            }
        }
        else {
            if (haveSpaceSlice > 0) {
                if (cantRunCount >= hackables.length) {
                    //ns.tprint("No Viable Servers for Operations, Add Target")
                    if (targetLimitMod + targetLimit < dynamicTargetingCap) { targetLimitMod += 1; }
                }
                else {
                    //ns.tprint("Have Threads, Have Slice Space");
                }
            }
            // }
            else if (haveSpaceRAM > 0) {
                if (cantRunCount >= hackables.length) {
                    //ns.tprint("No Viable Servers for Operations, Add Target")
                    if (targetLimitMod + targetLimit < dynamicTargetingCap) { targetLimitMod += 1; }
                }
                else {
                    //ns.tprint("Have Threads, Have RAM Space")
                    adjustedTargetRAMslice = 1;
                }
            }
            else {
                if (targetLimitMod > 0) {
                    //ns.tprint("Have Threads, No RAM Space, Remove Target")
                    if (targetLimitMod > 0) { targetLimitMod -= 1; }
                }
                else {
                   // ns.tprint("Have Threads, No RAM Space, No Added Targets");
                }
            }
        }
    }

    return [hackstates, adjustedTargetRAMslice]
}

/** @param {NS} ns **/
function distribute(ns) {
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

    for (let i = 0; i < hosts.length; ++i) {
        const serv = hosts[i];

        //if the server is home or a purchased server, skip it.
        if (serv == "home") {
            continue;
        }

        //copy hack, grow, and weaken
        ns.scp("_hack.js", serv, "home")
        ns.scp("_grow.js", serv, "home")
        ns.scp("_weaken.js", serv, "home")

    }
}

/** @param {NS} ns **/
async function manageAndHack(ns, freeRams, hackables, hackstates, targetRAMslice) {
    for (let target of hackables) {
        const money = ns.getServerMoneyAvailable(target);
        const maxMoney = ns.getServerMaxMoney(target);
        const minSec = ns.getServerMinSecurityLevel(target);
        const sec = ns.getServerSecurityLevel(target);
        var secDiff = sec - minSec;
        var moneyPercent = (money / maxMoney) * 100;

        /////-----SHOTGUN-----/////
        if (!shotgunBatching) {
            // weaken if the security of the host is not at its minimum

            if (secDiff > 0) {
                var threads = Math.floor(secDiff / 0.05) - hackstates.get(target).weaken;
                var threadsAllowed = hackstates.get(target).wMaxThreads - hackstates.get(target).weaken;
                if (threads > threadsAllowed) { threads = threadsAllowed; }

                if (threads > 0) {
                    // if we didnt find any place to run, 
                    // it means we have ran out of places to run anything, so stop this 
                    // and wait for next cycle
                    if (!findPlaceToRun(ns, "_weaken.js", threads, freeRams, target, targetRAMslice, 0)) {
                        continue;
                    }
                }

            }


            // grow if money is less than the percentage 

            if (moneyPercent < growPercent) {
                var threads = Math.floor(ns.growthAnalyze(target, 100 / moneyPercent))
                    - hackstates.get(target).grow;
                var threadsAllowed = hackstates.get(target).gMaxThreads - hackstates.get(target).grow;
                if (threads > threadsAllowed) { threads = threadsAllowed; }

                if (threads > 0) {
                    // if we didnt find any place to run, 
                    // it means we have ran out of places to run anything, so stop this 
                    // and wait for next cycle
                    if (!findPlaceToRun(ns, "_grow.js", threads, freeRams, target, targetRAMslice, 0)) {
                        continue;
                    }
                }
            }

            if (moneyPercent > hackPercent && secDiff < secThreshold) {
                var threads = Math.floor(ns.hackAnalyzeThreads(target, money * hackPct))
                    - hackstates.get(target).hack
                var threadsAllowed = hackstates.get(target).hMaxThreads - hackstates.get(target).hack;
                if (threads > threadsAllowed) { threads = threadsAllowed; }

                if (threads > 0) {
                    // hack to money percent = 70
                    if (!findPlaceToRun(ns, "_hack.js", threads, freeRams, target, targetRAMslice, 0)) {
                        continue;
                    }
                }
            }
        }
        /////-----END SHOTGUN-----/////


        /////-----SHOTGUN BATCHING-----/////
        else {
            // weaken if the security of the host is not at its minimum, execute batch
            if (secDiff > 0) {

                let [growThreadNum,
                    hackThreadNum,
                    gWeakenThreadNum,
                    hWeakenThreadNum,
                    growCompTime,
                    hackCompTime,
                    weakenCompTime] = timingCalculations(ns, target);



                var threads = hWeakenThreadNum - hackstates.get(target).weaken;
                var threadsAllowed = hackstates.get(target).wMaxThreads - hackstates.get(target).weaken;
                if (threads > threadsAllowed) { threads = threadsAllowed; }

                if (threads > 0) {
                    // if we didnt find any place to run, 
                    // it means we have ran out of places to run anything, so stop this 
                    // and wait for next cycle
                    if (!findPlaceToRun(ns, "_weaken.js", threads, freeRams, target, targetRAMslice, 0)) {
                        continue;
                    }
                }
                // grow if money is less than the percentage 
                if (moneyPercent < growPercent) {
                    var moneyPercent = (money / maxMoney) * 100
                    var threads = growThreadNum - hackstates.get(target).grow;
                    var threadsAllowed = hackstates.get(target).gMaxThreads - hackstates.get(target).grow;
                    if (threads > threadsAllowed) { threads = threadsAllowed; }
                    if (threads > 0) {
                        // if we didnt find any place to run, 
                        // it means we have ran out of places to run anything, so stop this 
                        // and wait for next cycle
                        if (!findPlaceToRun(ns, "_grow.js", threads, freeRams, target, targetRAMslice, weakenCompTime - growCompTime + buffer)) {
                            continue;
                        }
                    }
                    // weaken if the security of the host is not at its minimum
                    if (secDiff > 0) {
                        var threads = gWeakenThreadNum - hackstates.get(target).weaken;
                        var threadsAllowed = hackstates.get(target).wMaxThreads - hackstates.get(target).weaken;
                        if (threads > threadsAllowed) { threads = threadsAllowed; }
                        if (threads > 0) {
                            // if we didnt find any place to run, 
                            // it means we have ran out of places to run anything, so stop this 
                            // and wait for next cycle
                            if (!findPlaceToRun(ns, "_weaken.js", threads, freeRams, target, targetRAMslice, buffer * 2)) {
                                continue;
                            }
                        }

                        //if ready to hack now, hack!
                        if (moneyPercent > hackPercent && secDiff < secThreshold) {

                            //ns.tprint("Grow Comp Time: " + growCompTime, 
                            //"Hack Comp Time: " + hackCompTime, 
                            //"Weaken Comp Time: " + weakenCompTime)

                            var threads = hackThreadNum - hackstates.get(target).hack
                            var threadsAllowed = hackstates.get(target).hMaxThreads - hackstates.get(target).hack;
                            if (threads > threadsAllowed) { threads = threadsAllowed; }
                            if (hackThreadNum > 0) {

                                if (!findPlaceToRun(ns, "_hack.js", hackThreadNum, freeRams, target, targetRAMslice, 0)) {
                                    continue;
                                }
                            }
                        }
                        //else, wait till batch is done to hack 
                        else {
                            var threads = hackThreadNum - hackstates.get(target).hack
                            var threadsAllowed = hackstates.get(target).hMaxThreads - hackstates.get(target).hack;
                            if (threads > threadsAllowed) { threads = threadsAllowed; }
                            if (hackThreadNum > 0) {

                                if (!findPlaceToRun(ns, "_hack.js", hackThreadNum, freeRams, target, targetRAMslice, weakenCompTime - hackCompTime + buffer * 3)) {
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
            // grow if money is less than the percentage, execute partial batch 
            else if (moneyPercent < growPercent) {

                let [growThreadNum,
                    hackThreadNum,
                    gWeakenThreadNum,
                    hWeakenThreadNum,
                    growCompTime,
                    hackCompTime,
                    weakenCompTime] = timingCalculations(ns, target);

                var moneyPercent = (money / maxMoney) * 100
                var threads = growThreadNum - hackstates.get(target).grow;
                var threadsAllowed = hackstates.get(target).gMaxThreads - hackstates.get(target).grow;
                if (threads > threadsAllowed) { threads = threadsAllowed; }
                if (threads > 0) {
                    // if we didnt find any place to run, 
                    // it means we have ran out of places to run anything, so stop this 
                    // and wait for next cycle
                    if (!findPlaceToRun(ns, "_grow.js", threads, freeRams, target, targetRAMslice, 0)) {
                        continue;
                    }
                }
                // weaken if the security of the host is not at its minimum
                if (secDiff > 0) {
                    var threads = gWeakenThreadNum - hackstates.get(target).weaken;
                    var threadsAllowed = hackstates.get(target).wMaxThreads - hackstates.get(target).weaken;
                    if (threads > threadsAllowed) { threads = threadsAllowed; }
                    if (threads > 0) {
                        // if we didnt find any place to run, 
                        // it means we have ran out of places to run anything, so stop this 
                        // and wait for next cycle
                        if (!findPlaceToRun(ns, "_weaken.js", threads, freeRams, target, targetRAMslice, 0)) {
                            continue;
                        }
                    }

                    //if ready to hack now, hack!
                    if (moneyPercent > hackPercent && secDiff < secThreshold) {

                        //ns.tprint("Grow Comp Time: " + growCompTime, 
                        //"Hack Comp Time: " + hackCompTime, 
                        //"Weaken Comp Time: " + weakenCompTime)

                        var threads = hackThreadNum - hackstates.get(target).hack
                        var threadsAllowed = hackstates.get(target).hMaxThreads - hackstates.get(target).hack;
                        if (threads > threadsAllowed) { threads = threadsAllowed; }
                        if (hackThreadNum > 0) {

                            if (!findPlaceToRun(ns, "_hack.js", hackThreadNum, freeRams, target, targetRAMslice, 0)) {
                                continue;
                            }
                        }
                    }
                    //else, wait til partial batch is done to hack 
                    else {
                        var threads = hackThreadNum - hackstates.get(target).hack
                        var threadsAllowed = hackstates.get(target).hMaxThreads - hackstates.get(target).hack;
                        if (threads > threadsAllowed) { threads = threadsAllowed; }
                        if (hackThreadNum > 0) {

                            if (!findPlaceToRun(ns, "_hack.js", hackThreadNum, freeRams, target, targetRAMslice, weakenCompTime + buffer)) {
                                continue;
                            }
                        }
                    }
                }
            }
            else if (moneyPercent > hackPercent && secDiff < secThreshold) {


                let [growThreadNum,
                    hackThreadNum,
                    gWeakenThreadNum,
                    hWeakenThreadNum,
                    growCompTime,
                    hackCompTime,
                    weakenCompTime] = timingCalculations(ns, target);
                //ns.tprint("Grow Comp Time: " + growCompTime, 
                //"Hack Comp Time: " + hackCompTime, 
                //"Weaken Comp Time: " + weakenCompTime)

                var threads = hackThreadNum - hackstates.get(target).hack
                var threadsAllowed = hackstates.get(target).hMaxThreads - hackstates.get(target).hack;
                if (threads > threadsAllowed) { threads = threadsAllowed; }
                if (hackThreadNum > 0) {

                    if (!findPlaceToRun(ns, "_hack.js", hackThreadNum, freeRams, target, targetRAMslice, 0)) {
                        continue;
                    }
                }
            }
        }
        /////-----END SHOTGUN BATCHING-----/////
        //kill all PIDs past termination time
        for (let i = 0; i < weakenPIDs.length; ++i) {
            if (weakenPIDs[i].termination <= performance.now()) {
                ns.kill(weakenPIDs[i].PID);
                weakenPIDs.splice(i, 1);
                i -= 1;
            }
        }
        for (let i = 0; i < growPIDs.length; ++i) {
            if (growPIDs[i].termination <= performance.now()) {
                ns.kill(growPIDs[i].PID);
                growPIDs.splice(i, 1);
                i -= 1;
            }
        }
        for (let i = 0; i < hackPIDs.length; ++i) {
            if (hackPIDs[i].termination <= performance.now()) {
                ns.kill(hackPIDs[i].PID);
                hackPIDs.splice(i, 1);
                i -= 1;
            }
        }
    }
}


//use formulas.exe to calculate run times for hack grow and weaken of a given target
//to get formulas, just patch the RNG and play roulette (on 1) at the casino for 10bn
//then buy a TOR router, then run the command "buy -a"
//RNG patch: Math.floor = (number) => { return 1 };Math.random = () => { return 0 }; 
/** @param {NS} ns **/
function timingCalculations(ns, hostname) {
    //mock = ns.formulas.mockServer();
    //server = ns.getServer(hostname);

    //configure the mock server
    //mock.hostname = server.hostname;
    //mock.hackDifficulty = server.hackDifficulty;
    //mock.minDifficulty = server.minDifficulty;
    //mock.moneyAvailable = server.moneyAvailable;
    //mock.moneyMax = server.moneyMax;
    //mock.serverGrowth = server.serverGrowth;

    //-----TIMING VARIABLES-----//
    let weakenCompTime = 0;
    let growCompTime = 0;
    let hackCompTime = 0;
    let hWeakenThreadNum = 0;
    let gWeakenThreadNum = 0;
    let growThreadNum = 0;
    let hackThreadNum = 0;
    //-----END TIMING VARIABLES-----//

    growThreadNum = Math.ceil(ns.growthAnalyze(hostname, ns.getServerMaxMoney(hostname) / (ns.getServerMoneyAvailable(hostname) * hackPct)));
    hackThreadNum = Math.ceil(ns.hackAnalyzeThreads(hostname, ns.getServerMaxMoney(hostname) * hackPct));

    let gSecDif = growThreadNum * 0.004; //documentation says 0.004 is the amount grow() increases security
    //let hSecDif = hackThreadNum * 0.002; //documentation says 0.002 is the amount hack() increases security

    //Intial security level will be set from last hack that happened. So take the difference of current security
    //level and minimum security level to get the amount by which the first weaken operation will need to decrease
    //security in order to get to minimum level. Same applies for grow and hack operations: when they are initialized
    //the security level will still be the initial level as set by the previous cycle's final hack operation.
    gWeakenThreadNum = Math.ceil(gSecDif / 0.05); //documentation says 0.05 is the amount weaken() decreases security
    hWeakenThreadNum = Math.ceil((ns.getServerSecurityLevel(hostname) - ns.getServerMinSecurityLevel(hostname)) / 0.05);

    growCompTime = ns.getGrowTime(hostname);
    hackCompTime = ns.getHackTime(hostname);

    weakenCompTime = ns.getWeakenTime(hostname);

    return [growThreadNum,
        hackThreadNum,
        gWeakenThreadNum,
        hWeakenThreadNum,
        growCompTime,
        hackCompTime,
        weakenCompTime]

}

//function scores all servers, prunes zero scores, then averages scores and 
//prunes below-average scores, then sorts from hoghest to lowest remaining scores
function targetList(ns) {
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
    let serverScores = [];
    let executionTimes = [];

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
            executionTimes[i]
        }
    }




    let scoreTotal = 0;
    let scoreAverage = 0;
    //prune list of zeros
    for (let i = 0; i < hosts.length; ++i) {
        //	ns.tprint(hosts[i] + ": " + serverScores[i]);
        if (serverScores[i] == 0) { hosts.splice(i, 1); serverScores.splice(i, 1); i -= 1; }
        //else { scoreTotal += serverScores[i]; }
    }

    //average scores, then prune server scores below average
    scoreAverage = scoreTotal / serverScores.length;
    for (let i = 0; i < hosts.length; ++i) {
        //ns.tprint(hosts[i] + ": " + serverScores[i]);
        if (serverScores[i] < scoreAverage) { hosts.splice(i, 1); serverScores.splice(i, 1); i -= 1; }
    }

    //sort by highest score first
    [hosts, serverScores, executionTimes] = dbubbleSort(hosts, serverScores, executionTimes);

    //sort by smallest execution time first
    //[hosts, executionTimes, serverScores] = abubbleSort(hosts, executionTimes, serverScores);

    return hosts;
}

function dbubbleSort(hosts, serverScores, executionTimes) {

    //Outer pass
    for (let i = 0; i < serverScores.length; i++) {

        //Inner pass
        for (let j = 0; j < serverScores.length - i - 1; j++) {

            //Value comparison using descending order

            if (serverScores[j + 1] > serverScores[j]) {

                //Swapping
                [hosts[j + 1], hosts[j]] = [hosts[j], hosts[j + 1]];
                [serverScores[j + 1], serverScores[j]] = [serverScores[j], serverScores[j + 1]];
                [executionTimes[j + 1], executionTimes[j]] = [executionTimes[j], executionTimes[j + 1]];

            }
        }
    };
    return [hosts, serverScores, executionTimes];
}

function abubbleSort(hosts, executionTimes, serverScores) {

    //Outer pass
    for (let i = 0; i < executionTimes.length; i++) {

        //Inner pass
        for (let j = 0; j < executionTimes.length - i - 1; j++) {

            //Value comparison using ascending order

            if (executionTimes[j + 1] < executionTimes[j]) {

                //Swapping
                [hosts[j + 1], hosts[j]] = [hosts[j], hosts[j + 1]];
                [executionTimes[j + 1], executionTimes[j]] = [executionTimes[j], executionTimes[j + 1]];
                [serverScores[j + 1], serverScores[j]] = [serverScores[j], serverScores[j + 1]];
            }
        }
    };
    return [hosts, executionTimes, serverScores];
}

// find some place to run the script with given amount of threads
// returns ture means script was executed, false means it didnt
/** @param {NS} ns **/
function findPlaceToRun(ns, script, threads, freeRams, target, adjustedTargetRAMslice, delay) {
    let scriptRam = ns.getScriptRam(script)
    var remaingThread = threads;

    let pid = 0;
    //ns.tprint(script + ": " + delay);
    while (true) {
        // if no more host with ram, return false
        if (freeRams.length === 0) {
            return false;
        }

        // try with first availiable host
        var host = freeRams[0].host;
        var ram = freeRams[0].freeRam;
        //ns.tprint("Free RAM: " + freeRams[0].freeRam)

        // if not enough ram on host to even run 1 thread, remove the host from list
        if (ram * adjustedTargetRAMslice < scriptRam) {
            freeRams.shift()
            //ns.tprint("1");
            // else if the ram on the host is not enough to run all threads, just run as much as it can
        } else if (ram * adjustedTargetRAMslice < scriptRam * remaingThread) {
            const threadForThisHost = Math.floor(((ram * adjustedTargetRAMslice) / scriptRam))
            //ns.tprint("2");
            // try to run the script, at this point this will only fail if
            // the host is already running the script against the same target,
            // from an earlier cycle
            // record the PID of the newly launched script, along with this host, the target, and expected termination time
            if (fullMonty) {
                //ns.tprint("3");
                pid = ns.exec(script, host, threadForThisHost, target, delay, Math.random())
            }
            else {
                //ns.tprint("4");
                pid = ns.exec(script, host, threadForThisHost, target, delay)//, Math.random())
            }

            if (script == "_weaken.js" && pid != 0) {
                //ns.tprint("5");
                weakenPIDs.push({ PID: pid, server: host, hackable: target, termination: performance.now() + delay + ns.getWeakenTime(target) + 60000 })
            }
            else if (script == "_grow.js" && pid != 0) {
                //ns.tprint("6");
                growPIDs.push({ PID: pid, server: host, hackable: target, termination: performance.now() + delay + ns.getGrowTime(target) + 60000 })
            }
            else if (script == "_hack.js" && pid != 0) {
                //ns.tprint("7");
                hackPIDs.push({ PID: pid, server: host, hackable: target, termination: performance.now() + delay + ns.getHackTime(target) + 60000 })
            }
            else {}//ns.tprint("7_fail")}

            if (pid === 0) {
                //ns.tprint("8");
                // if failed, than find the next host to run it, and return its result
                return findPlaceToRun(ns, script, threads, freeRams.slice(1), target, adjustedTargetRAMslice, delay)
            } else {
                //ns.tprint("9");
                // if run successed update thread to run and remove this host from the list
                // if (script === "hack.js") {
                // ns.tprint(`executing ${script} on ${host} with ${threadForThisHost} threads, targeting ${target}`)
                // }
                remaingThread -= threadForThisHost
                freeRams.shift()
            }

        } else {
            //ns.tprint("10");
            // try to run the script, at this point this will only fail if
            // the host is already running the script against the same target,
            // from an earlier cycle
            // record the PID of the newly launched script, along with this host, the target, and expected termination time
            if (fullMonty) {
                //ns.tprint("11");
                pid = ns.exec(script, host, remaingThread, target, delay, Math.random())
            }
            else {
                //ns.tprint("12");
                pid = ns.exec(script, host, remaingThread, target, delay)//, Math.random())
            }


            if (script == "_weaken.js" && pid != 0) {
                //ns.tprint("13");
                weakenPIDs.push({ PID: pid, server: host, hackable: target, termination: performance.now() + delay + ns.getHackTime(target) + 60000 })
            }
            else if (script == "_grow.js" && pid != 0) {
                //ns.tprint("14");
                growPIDs.push({ PID: pid, server: host, hackable: target, termination: performance.now() + delay + ns.getHackTime(target) + 60000 })
            }
            else if (script == "_hack.js" && pid != 0) {
                //ns.tprint("15");
                hackPIDs.push({ PID: pid, server: host, hackable: target, termination: performance.now() + delay + ns.getHackTime(target) + 60000 })
            }

            if (pid === 0) {
                //ns.tprint("16");
                // if failed, then find the next host to run it, and return its result
                if (!findPlaceToRun(ns, script, threads, freeRams.slice(1), target, adjustedTargetRAMslice, delay)) {
                    //ns.tprint("17");
                    return false;
                }
            } else {
                //ns.tprint("18");
                // if run successed update the remaining ram for this host
                // if (script === "hack.js") {
                //     ns.tprint(`executing ${script} on ${host} with ${remaingThread} threads, targeting ${target}`)
                // }
                freeRams[0].freeRam -= scriptRam * remaingThread
            }

            return true;

        }
    }
}

// gets the number of running threads against hackable servers
/** @param {NS} ns **/
function getHackStates(ns, servers, hackables) {
    var hackstates = new Map();

    for (let hackable of hackables.values()) {

        if (hackstates.has(hackable)) {
            hackstates.get(hackable).weaken = 0;
            for (let i = 0; i < weakenPIDs.length; ++i) {
                if (weakenPIDs[i].hackable == hackable) {
                    hackstates.get(hackable).weaken += ns.getRunningScript(weakenPIDs[i].PID).threads
                }
            }
            hackstates.get(hackable).grow = 0;
            for (let i = 0; i < growPIDs.length; ++i) {
                if (growPIDs[i].hackable == hackable) {
                    hackstates.get(hackable).grow += ns.getRunningScript(growPIDs[i].PID).threads
                }
            }
            hackstates.get(hackable).hack = 0;
            for (let i = 0; i < hackPIDs.length; ++i) {
                if (hackPIDs[i].hackable == hackable) {
                    hackstates.get(hackable).hack += ns.getRunningScript(hackPIDs[i].PID).threads
                }
            }

        } else {

            hackstates.set(hackable, {
                weaken: 0,
                grow: 0,
                hack: 0,
                wRatio: 0,
                gRatio: 0,
                hRatio: 0,
                wMaxThreads: 0,
                gMaxThreads: 0,
                hMaxThreads: 0,
                wCount: 0,
                gCount: 0,
                hCount: 0
            })
        }
    }

    return hackstates
}

// filter the list for hackable servers
/** @param {NS} ns **/
function getHackable(ns, servers) {
    return [...servers.values()].filter(server => ns.getServerMaxMoney(server) > 1000000
        && ns.getServerRequiredHackingLevel(server) <= ns.getHackingLevel()
        && ns.getServerMoneyAvailable(server) > 1000
        && ns.getServerGrowth(server))
        .sort((a, b) => ns.getServerRequiredHackingLevel(a) - ns.getServerRequiredHackingLevel(b))
}

// filter the list for servers where we can run script on
/** @param {NS} ns **/
function getFreeRam(ns, servers) {
    const freeRams = [];
    for (let server of servers) {
        const freeRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
        if (freeRam > reservedHomeSpace && server == "home") {
            freeRams.push({ host: server, freeRam: (freeRam - reservedHomeSpace) * globalMemoryUsage });
        }
        else if (freeRam > reservedServerSpace && server != "home") {
            freeRams.push({ host: server, freeRam: (freeRam - reservedServerSpace) * globalMemoryUsage });
        }

    }
    var sortedFreeRams = freeRams.sort((a, b) => b.freeRam - a.freeRam);
    return sortedFreeRams;
}

// scan all servers from home and hack them if we can
/** @param {NS} ns **/
function scanAndHack(ns) {
    let servers = new Set(["home"]);
    scanAll("home", servers, ns);
    const accesibleServers = new Set();
    for (let server of servers) {
        if (ns.hasRootAccess(server)) {
            accesibleServers.add(server)
        } else {
            var portOpened = 0;
            if (ns.fileExists("BruteSSH.exe")) {
                ns.brutessh(server);
                portOpened++;
            }
            if (ns.fileExists("FTPCrack.exe")) {
                ns.ftpcrack(server);
                portOpened++;
            }

            if (ns.fileExists("HTTPWorm.exe")) {
                ns.httpworm(server);
                portOpened++;
            }
            if (ns.fileExists("relaySMTP.exe")) {
                ns.relaysmtp(server);
                portOpened++;
            }

            if (ns.fileExists("SQLInject.exe")) {
                ns.sqlinject(server);
                portOpened++;
            }

            if (ns.getServerNumPortsRequired(server) <= portOpened) {
                ns.nuke(server);
                accesibleServers.add(server);
            }
        }


    }
    return accesibleServers;
}

/** @param {NS} ns **/
function scanAll(host, servers, ns) {
    var hosts = ns.scan(host);
    for (let i = 0; i < hosts.length; i++) {
        if (!servers.has(hosts[i])) {
            servers.add(hosts[i]);
            scanAll(hosts[i], servers, ns);
        }

    }
}
