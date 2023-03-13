/*
----------THIS SCRIPT IS MEANT FOR SELLING OFF STOCKS-----------
*/



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
    return pdiff
}

function refresh(ns, stocks, myStocks){
    let corpus = 0;
    myStocks.length = 0;
    for(let i = 0; i < stocks.length; i++){
        let sym = stocks[i].sym;
        stocks[i].price = 0;
        stocks[i].shares  = ns.stock.getPosition(sym)[0];
        stocks[i].buyPrice = 0;
        stocks[i].vol = 0;
        stocks[i].prob = 0;
        stocks[i].expRet = 0;
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

async function sell(ns, stock, numShares) {
    let profit = numShares * ((stock.price - stock.buyPrice) - (2 * commission));
    await ns.stock.sellStock(stock.sym, numShares);
}


export async function main(ns) {
    //kill stock.js
    ns.scriptKill("stock.js", "home");
    
    //Initialise
    ns.disableLog("ALL");
    let stocks = [...ns.stock.getSymbols().map(_sym => {return {sym: _sym}})];
    let myStocks = [];
    let corpus = 0;


    while (true) {
        corpus = refresh(ns, stocks, myStocks);
        //Symbol, Initial Return, Current Return, The % change between
        // the Initial Return and the Current Return.

        //Sell underperforming shares
        for (let i = 0; i < myStocks.length; i++) {
            if (pChange(ns, myStocks[i].sym, myStocks[i].initExpRet, myStocks[i].expRet) <= expRetLossToSell)
                await sell(ns, myStocks[i], myStocks[i].shares);

            if (myStocks[i].expRet <= 0)
                await sell(ns, myStocks[i], myStocks[i].shares);

            corpus -= commission;
        }
        break;
    }
}
