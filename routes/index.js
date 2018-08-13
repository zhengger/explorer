var mongoose = require( 'mongoose' );

var Block     = mongoose.model( 'Block' );
var Transaction = mongoose.model( 'Transaction' );
var Contract = mongoose.model('Contract');
var filters = require('./filters')


var async = require('async');

module.exports = function(app){
  var web3relay = require('./web3relay');

  //var DAO = require('./dao');
  var Token = require('./token');
  var tokenListData = require('./tokenListData');
  var contractListData = require('./contractListData');
  var transactionData = require('./transactionData');
  var tokenTransfer = require('./tokenTransfer');
  var witnessData = require('./witnessData');
  var witnessListData = require('./witnessListData');  
  var compile = require('./compiler');
  var fiat = require('./fiat');
  var stats = require('./stats');
  var eventLog = require('./eventLog.js');
  var publicAPIData = require('./publicAPIData.js');

  /* 
    Local DB: data request format
    { "address": "0x1234blah", "txin": true } 
    { "tx": "0x1234blah" }
    { "block": "1234" }
  */
  app.post('/addr', getAddr);
  app.post('/tx', getTx);
  app.post('/block', getBlock);
  app.post('/data', getData);
  app.get('/totaletz', getTotalEtz);

  //app.post('/daorelay', DAO);
  app.post('/tokenrelay', Token);  
  app.post('/tokenListData', tokenListData); 
  app.post('/contractListData', contractListData); 
  app.post('/transactionRelay', transactionData); 
  app.post('/tokenTransfer', tokenTransfer);
  app.post('/witnessData', witnessData);
  app.post('/witnessListData', witnessListData);
  app.post('/eventLog', eventLog);
  app.post('/web3relay', web3relay.data);
  app.post('/compile', compile);
  app.post('/publicAPIData', publicAPIData);

  app.post('/fiat', fiat);
  app.post('/stats', stats);
  

}

var getAddr = function(req, res){
  // TODO: validate addr and tx
  var addr = req.body.addr.toLowerCase();
  var count = parseInt(req.body.count);
  var limit = parseInt(req.body.length);
  var start = parseInt(req.body.start);
  var data = { draw: parseInt(req.body.draw), recordsFiltered: count, recordsTotal: count };
  
  if(count == 1){//need calculate records count
    Transaction.count({ $or: [{"to": addr}, {"from": addr}] }).exec().then(function(recordCount)
    {
      data.recordsFiltered = recordCount;
      data.recordsTotal = recordCount;

      var addrFind = Transaction.find( { $or: [{"to": addr}, {"from": addr}] })
      addrFind.lean(true).sort('-blockNumber').skip(start).limit(limit).exec("find", function (err, docs) {
        if (docs)
          data.data = filters.filterTX(docs, addr);      
        else 
          data.data = [];
        res.write(JSON.stringify(data));
        res.end();
      });
    })
  }
  

};
 


var getBlock = function(req, res) {

  // TODO: support queries for block hash
  var txQuery = "number";
  var number = parseInt(req.body.block);

  var blockFind = Block.findOne( { number : number }).lean(true);
  blockFind.exec(function (err, doc) {
    if (err || !doc) {
      console.error("BlockFind error: " + err)
      console.error(req.body);
      res.write(JSON.stringify({"error": true}));
    } else {
      var block = filters.filterBlocks([doc]);
      res.write(JSON.stringify(block[0]));
    }
    res.end();
  });

};

var getTx = function(req, res){

  var tx = req.body.tx.toLowerCase();

  var txFind = Block.findOne( { "transactions.hash" : tx }, "transactions timestamp")
                  .lean(true);
  txFind.exec(function (err, doc) {
    if (!doc){
      console.log("missing: " +tx)
      res.write(JSON.stringify({}));
      res.end();
    } else {
      // filter transactions
      var txDocs = filters.filterBlock(doc, "hash", tx)
      res.write(JSON.stringify(txDocs));
      res.end();
    }
  });

};


/*
  Fetch data from DB
*/
var getData = function(req, res){

  // TODO: error handling for invalid calls
  var action = req.body.action.toLowerCase();
  var limit = req.body.limit

  if (action in DATA_ACTIONS) {
    if (isNaN(limit))
      var lim = MAX_ENTRIES;
    else
      var lim = parseInt(limit);
    
    DATA_ACTIONS[action](lim, res);

  } else {
  
    console.error("Invalid Request: " + action)
    res.status(400).send();
  }

};

var getTotalEtz = function(req, res) {
  var block = Block.findOne({}, "number")
                      .lean(true).sort('-number');
  block.exec(function (err, doc) {
    // res.write(JSON.stringify(doc));
    var total = 194000000 + (doc.number - 4936270) * 1.8;
    res.write(total.toString());
    res.end();
  });
} 


/* 
  temporary blockstats here
*/
var latestBlock = function(req, res) {
  var block = Block.findOne({}, "totalDifficulty")
                      .lean(true).sort('-number');
  block.exec(function (err, doc) {
    res.write(JSON.stringify(doc));
    res.end();
  });
} 


var getLatest = function(lim, res, callback) {
  var blockFind = Block.find({}, "number transactions timestamp miner extraData")
                      .lean(true).sort('-number').limit(lim);
  blockFind.exec(function (err, docs) {
    callback(docs, res);
  });
}

/* get blocks from db */
var sendBlocks = function(lim, res) {
  var blockFind = Block.find({}, "number txs timestamp miner extraData")
                      .lean(true).sort('-number').limit(lim);
  blockFind.exec(function (err, docs) {
    //latest data
    docs = filters.filterBlocks(docs);
    var result = {"blocks": docs};
    if(docs.length>1){
      result.blockHeight = docs[0].number;
      var totalTXs = 0;
      var costTime = docs[0].timestamp-docs[docs.length-1].timestamp;
      result.blockTime = costTime/(docs.length-1);
      result.blockTime = Math.round(result.blockTime*1000)/1000;
      for(var i=0; i<docs.length; i++){
        if(docs[i].txs)
          totalTXs+=docs[i].txs.length;
      }
      //result.TPS = Math.round(totalTXs/costTime);
      result.TPS = totalTXs/costTime;
      result.TPS = Math.round(result.TPS*1000)/1000;
    }

    res.write(JSON.stringify(result));
    res.end();
  });
}

var sendTxs = function(lim, res) {
  Transaction.find({}).lean(true).sort('-blockNumber').limit(lim)
        .exec(function (err, txs) {
          res.write(JSON.stringify({"txs": txs}));
          res.end();
        });
}

const MAX_ENTRIES = 10;

const DATA_ACTIONS = {
  "latest_blocks": sendBlocks,
  "latest_txs": sendTxs
}

// //listen every token in db
// var eth = require('./web3relay').eth;
// var TokenTransferGrabber = require('./grabTokenTransfer');
// TokenTransferGrabber.Init(eth);
// var ContractFind = Contract.find({ERC:{$gt:0}}).lean(true);
// var transforEvent;
// ContractFind.exec(function(err, doc){
//   if(doc){
//     for(var i=0; i<doc.length; i++){
//       transforEvent = TokenTransferGrabber.GetTransferEvent(doc[i].abi, doc[i].address)
//       TokenTransferGrabber.ListenTransferTokens(transforEvent);
//     }
    
//   }
// })
