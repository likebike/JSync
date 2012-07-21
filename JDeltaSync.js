//  JDelta - Realtime Delta Distribution
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


(function() {

// First, install ourselves and import our dependencies:
var JDeltaSync = {},
    JDeltaDB,
    JDelta,
    _;
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.DeltaSync = DeltaSync;
    JDeltaDB = require('./JDeltaDB.js').JDeltaDB;
    JDelta = require('./JDelta.js').JDelta;
    _ = require('underscore');
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.DeltaSync = DeltaSync;
    JDeltaDB = window.JDeltaDB;
    JDelta = window.JDelta;
    _ = window._;
} else throw new Error('This environment is not yet supported.');

DeltaSync.VERSION = '0.1.0a';



JDeltaSync.Client = function() {
    // Guard against forgetting the 'new' operator:
    if(this === JDeltaSync)
        return new JDeltaSync.Client();
    this._sendQueue = [];
    this._sentQueue = [];
    this._receiveQueue = [];
};
JDeltaSync.Client.prototype.listStates = function(ids, onSuccess, onError) {
    // Fetches state infos from server.  Does *not* use/affect the queue.
    
    onSuccess([{id:'a', lastDeltaSeq:5, lastDeltaHash:0x12345678},
               {id:'b', lastDeltaSeq:9, lastDeltaHash:0x5eba571a}]);
};
JDeltaSync.Client.prototype.fetchDeltas = function(items, onSuccess, onError) {
    // Fetches state deltas from server.  Does *not* use/affect the queue.
    items = [{id:'a', startSeq:3, endSeq:5},  // Using a query structure like this allows us to minimize # of SQL queries that we need to perform.
             {id:'b', startSeq:9, endSeq:9}];
    onSuccess([{id:'a', delta:{seq:3, curHash:'A', steps:[]}},
               {id:'a', delta:{seq:4, curHash:'B', steps:[]}},
               {id:'a', delta:{seq:5, curHash:'C', steps:[]}},
               {id:'b', delta:{seq:9, curHash:'X', steps:[]}}]);
};


JDeltaSync.Server = function() {
    // Guard against forgetting the 'new' operator:
    if(this === JDeltaSync)
        return new JDeltaSync.Server();
    this._clientConnections = {};
};
JDeltaSync.Server.prototype.listStates = function(clientIP, clientConnectionID, items




})();

