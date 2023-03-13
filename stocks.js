let fracL = 0.1;     //Fraction of assets to keep as cash in hand
let fracH = 0.2;
let commission = 100000; //Buy or sell commission
let numCycles = 2;   //Each cycle is 5 seconds
let expRetLossToSell = -0.4; // As a percent, the amount of change between the initial
// forecasted return and the current return of the stock. I.e. -40% less forecasted return now
// than when we purchased the stock.


function pChange(ns, sym, oldNum, newNum){

    const diff = newNum < oldNum ? -(oldNum - newNum) : newNum - oldNum;
    let pdiff = diff / oldNum;
    ns.print(`${sym}:\t${oldNum.toFixed(5)} -> ${newNum.toFixed(5)} | ${(pdiff*100).toFixed(3)}%`);
    return pdiff
}

function refresh(ns, stocks, myStocks){
    let corpus = ns.getServerMoneyAvailable("home");
    myStocks.length = 0;
    for(let i = 0; i < stocks.length; i++){
        let sym = stocks[i].sym;
        stocks[i].price = ns.stock.getPrice(sym);
        stocks[i].shares  = ns.stock.getPosition(sym)[0];
        stocks[i].buyPrice = ns.stock.getPosition(sym)[1];
        stocks[i].vol = ns.stock.getVolatility(sym);
        stocks[i].prob = 2* (ns.stock.getForecast(sym) - 0.5);
        stocks[i].expRet = stocks[i].vol * stocks[i].prob / 2;
        if (stocks[i].shares > 0){
            stocks[i].initExpRet ||= stocks[i].expRet;
        }else{
            stocks[i].initExpRet = null;
        }

        corpus += stocks[i].price * stocks[i].shares;
        if(stocks[i].shares > 0) myStocks.push(stocks[i]);
        // ns.print(JSON.stringify(stocks[i]))
    }
    stocks.sort(function(a, b){return b.expRet - a.expRet});
    return corpus;
}

function format(num){
    let symbols = ["","K","M","B","T","Qa","Qi","Sx","Sp","Oc"];
    let i = 0;
    for(; (num >= 1000) && (i < symbols.length); i++) num /= 1000;

    return ( (Math.sign(num) < 0)?"-$":"$") + num.toFixed(3) + symbols[i];
}

async function buy(ns, stock, numShares) {
    const max = ns.stock.getMaxShares(stock.sym)
    numShares = max < numShares ?  max : numShares;

    await ns.stock.buyStock(stock.sym, numShares);
    ns.print(`Bought ${stock.sym} for ${format(numShares * stock.price)}`);
}

async function sell(ns, stock, numShares) {
    let profit = numShares * ((stock.price - stock.buyPrice) - (2 * commission));
    await ns.stock.sellStock(stock.sym, numShares);
    ns.print(`Sold ${stock.sym} for profit of ${format(profit)}`);
}


export async function main(ns) {
    //Initialise
    ns.disableLog("ALL");
    let stocks = [...ns.stock.getSymbols().map(_sym => {return {sym: _sym}})];
    let myStocks = [];
    let corpus = 0;


    while (true) {
        corpus = refresh(ns, stocks, myStocks);
        //Symbol, Initial Return, Current Return, The % change between
        // the Initial Return and the Current Return.
        ns.print("Currently Owned Stocks:")
        ns.print("SYM | InitReturn -> CurReturn | % change")
        //Sell underperforming shares
        for (let i = 0; i < myStocks.length; i++) {
            if (pChange(ns, myStocks[i].sym, myStocks[i].initExpRet, myStocks[i].expRet) <= expRetLossToSell)
                await sell(ns, myStocks[i], myStocks[i].shares);

            if (myStocks[i].expRet <= 0)
                await sell(ns, myStocks[i], myStocks[i].shares);

            corpus -= commission;
        }
        ns.print("----------------------------------------")

        //Buy shares with cash remaining in hand
        for (let stock of stocks){

            if (stock.shares > 0) continue;
            if (stock.expRet <= 0) continue;
            let cashToSpend = ns.getServerMoneyAvailable("home") - (fracH * corpus);
            let numShares = Math.floor((cashToSpend - commission) / stock.price);
            if ((numShares * stock.expRet * stock.price * numCycles) > commission)
                await buy(ns, stock, numShares);
                break;
        }

        await ns.sleep(5 * 1000 * numCycles + 200);
    }
}
