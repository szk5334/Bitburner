export async function main(ns) {
    // How much RAM each purchased server will have. In this case, it'll
    // be 8GB.
    const ram = ns.args[0];

    let totalCost = ns.getPurchasedServerCost(ns.args[0]) * (ns.getPurchasedServerLimit()-ns.getPurchasedServers().length);


    if (ns.getPurchasedServers().length == ns.getPurchasedServerLimit()) {
        ns.prompt("You already have the max amount of purchased servers.")
        ns.exit();
    }
    else if (!ns.prompt("This action will cost: $" + ns.nFormat(totalCost, '0.000a') + "\nWould you like to proceed?", { type: "boolean" })) { ns.exit(); }
    // Iterator we'll use for our loop
    let i = 0;

    // Continuously try to purchase servers until we've reached the maximum
    // amount of servers
    while (i < ns.getPurchasedServerLimit()) {
        // Check if we have enough money to purchase a server
        if (ns.getServerMoneyAvailable("home") > ns.getPurchasedServerCost(ram)) {

            const hostname = ns.purchaseServer("pserv-" + i, ram);

            ++i;
        }
        //Make the script wait for a second before looping again.
        //Removing this line will cause an infinite loop and crash the game.
        await ns.sleep(1000);
    }
}
