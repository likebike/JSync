//  JsonDelta - Distributed Delta-Sequence Database
//  (c) 2012 LikeBike LLC
//  JsonDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


// Many ideas inspired by CouchDB and GIT.


(function() {

// First, install ourselves and import our dependencies:
var DeltaDB = {},
    JDelta,
    _;
if(exports !== undefined) {
    // We are on Node.
    exports.DeltaDB = DeltaDB;
    JDelta = require('./JsonDelta');
    _ = require('underscore');
} else if(window !== undefined) {
    // We are in a browser.
    window.DeltaDB = DeltaDB;
    JDelta = window.JDelta;
    _ = window._;
} else throw new Error('This environment is not yet supported.');

DeltaDB.VERSION = '0.1.0a';



// You can sort of think of DeltaDB sort of like a "Delta Integral".
// It maintains the total "sums" of the deltas, and manages events, storage, and network synchronization.
DeltaDB.DB = function(storage) {
    this._storage = storage || new DeltaDB.RamStorage();
    this._master = null;
    this._slaves = [];
    this._cache = {};
    this._states = {}; // State Structure: { state:json, dispatcher:obj }
};
DeltaDB.DB.prototype.setMaster = function() {
};
DeltaDB.DB.prototype.unsetMaster = function() {
};
DeltaDB.DB.prototype.addSlave = function() {
};
DeltaDB.DB.prototype.removeSlave = function() {
};
DeltaDB.DB.prototype._reloadFromMaster = function(id) {
};
DeltaDB.DB.prototype._listMasterItems = function() {
    // Master returns a list of IDs and the corresponding seq #'s / hashes to us so we can make sure we are up to date.
    // For now, if we are out of date, just reload.  Later, we can consider to just fetch the deltas we are missing.
};
DeltaDB.DB.prototype.on = function(id, event, callback) {
    if(!id)
        throw new Error('Invalid id!');
    if(!event)
        throw new Error('Invalid event!');
    if(!callback)
        throw new Error('Invalid callback!');
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) d = state.dispatcher = JDelta.createDispatcher();
    d.on(event, callback, state);  // It is crucial that the callbacks do not modify the state!
};
DeltaDB.DB.prototype._pushToMaster = function(id, delta) {
    //  Error handler that rolls back if the master does not accept the change.
};
DeltaDB.DB.prototype._pushToSlaves = function(id, delta) {
};
DeltaDB.DB.prototype.off = function(id, event, callback) {
    if(!id)
        throw new Error('Invalid id!');
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) return;
    d.off(event, callback, state);
};
DeltaDB.DB.prototype._trigger = function(id, event) {
    var state = this._getRawState(id);
    var d = state.dispatcher
    if(!d) return;
    d.trigger(event);
};
DeltaDB.DB.prototype.render = function(id, endSeq, saveInCache) {
    // For now, we just use a simplistic algorithm of iterating thru all the deltas.
    // It is easily possible to optimize this algorithm by using the undo-hashes to
    // find the minimum number of deltas that we need to merge.  But I'll wait for
    // a performance need to arise before doing that, cuz it's a bit more complex.
    var o = {},
        deltas = this._storage.getDeltas(id, 0, endSeq),
        i, ii;
    for(i=0, ii=deltas.length; i<ii; i++) {
        JDelta.patch(o, deltas[i]);
    }
    return o;
};
DeltaDB.DB.prototype.clearCache = function(namespace) {
};
DeltaDB.DB.prototype.listStates = function() {
    var states = [],
        id;
    for(id in this._states) if(this._states.hasOwnProperty(id)) {
        states[states.length] = id;
    }
    states.sort();
    return states;
};
DeltaDB.DB.prototype._getRawState = function(id) {
    if(!this._states.hasOwnProperty(id))
        throw new Error('No such state: '+id);
    return this._states[id];
};
DeltaDB.DB.prototype.createState = function(id) {
    if(this._states.hasOwnProperty(id))
        throw new Error('State already exists: '+id);
    this._states[id] = {state:{}, dispatcher:null};
};
DeltaDB.DB.prototype._rollback = function(id, toSeq) {
    var state = this._getRawState(id);
    if(toSeq === undefined)
        toSeq = this._storage.getLastDelta(id).seq;
    state.state = this.render(id, toSeq);
    this._trigger(id, 'reset');
};
DeltaDB.DB.prototype._addHashedDelta = function(id, delta) {
    // Called by the DeltaDB API (not the end user) with a delta object like this:
    //     { steps:[...], meta:{...}, seq:int, parentHash:str, undoHash:str, curHash:str, redoHash:str }
    var state = this._getRawState(id);
    var lastDelta = this._storage.getLastDelta(id);
    if(delta.seq !== lastDelta.seq + 1)
        throw new Error('invalid sequence!');
    if(delta.parentHash !== lastDelta.curHash)
        throw new Error('invalid parentHash!');
    try {
        JsonDelta.patch(state.state, delta, state.dispatcher);
    } catch(e) {
        this._rollback(id, lastDelta.seq);
        throw e;
    }
    this._storage.addDelta(id, delta);
    this._pushToMaster(id, delta);
    this._pushToSlaves(id, delta);
};
DeltaDB.DB.prototype.addDelta = function(id, delta) {
    // Called by the end user with a delta object like this:
    //     { steps:[...], meta:{...} }   // meta is optional.
    if(delta.steps === undefined)
        throw new Error("No 'steps' in delta!");
    var state = this._getRawState(id);
    var oldHash = JsonDelta._hash(JsonDelta.stringify(state.state));
    var newStateCopy = JsonDelta.patch(JsonDelta._deepCopy(state.state), delta);
    var newHash = JsonDelta._hash(JsonDelta.stringify(newStateCopy));
    if(newHash === oldHash)
        return;     // No change.  Let's just pretend this never happend...
    var parentSeq = this._storage.getLastDelta(id).seq;
    var newSeq = parentSeq + 1;
    var hashedDelta = { steps:delta.steps, meta:delta.meta || {}, seq:newSeq, parentHash:oldHash, undoHash:oldHash, curHash:newHash, redoHash:null };
    this._addHashedDelta(id, hashedDelta);
};
DeltaDB.DB.prototype.undo = function(id) {
};
DeltaDB.DB.prototype.redo = function(id) {
};






// Delta Structure:  { steps:[...], meta:{...}, seq:int, parentHash:str, undoHash:str, curHash:str, redoHash:str }
DeltaDB.RamStorage = function() {
    this._data = {};
};
DeltaDB.RamStorage.prototype._getRawDeltas = function(id) {
    if(!this._data.hasOwnProperty(id))
        throw new Error("'id' not found: "+id);
    return this._data[id];
};
DeltaDB.RamStorage.prototype.getDeltas = function(id, startSeq, endSeq) {
    var deltaList = this._getRawDeltas(id),
        out = [],
        i, ii, s, inRange;
    for(i=0, ii=deltaList.length; i<ii; i++) {
        inRange = true;
        s = deltaList[i]['seq'];
        if(startSeq!==undefined  &&  s<startSeq)
            inRange = false;
        if(endSeq!==undefined  &&  s>endSeq)
            inRange = false;  // Might be able to optimize by breaking out of loop at this point.
        if(inRange)
            out[out.length] = deltaList[i];
    }
    return out;
};
DeltaDB.RamStorage.prototype.getLastDelta = function(id) {
    var deltaList = this._getRawDeltas(id);
    return deltaList[deltaList.length-1];
};
DeltaDB.RamStorage.prototype.addDelta = function(id, delta) {
    var deltaList = this._getRawDeltas(id);
    deltaList[deltaList.length] = delta;
};


//DeltaDB.RamStorage.prototype.listIDs = function() {
//    var ids = [],
//        k;
//    for(k in this._data) if(this._data.hasOwnProperty(k)) {
//        ids[ids.length] = k;
//    }
//    ids.sort();
//    return ids;
//};













DeltaDB.SqliteStorage = function() {
    throw new Error('coming soon...');
};

})();


