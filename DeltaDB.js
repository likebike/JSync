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
    JDelta = require('./JsonDelta').JDelta;
    _ = require('underscore');
} else if(window !== undefined) {
    // We are in a browser.
    window.DeltaDB = DeltaDB;
    JDelta = window.JDelta;
    _ = window._;
} else throw new Error('This environment is not yet supported.');

DeltaDB.VERSION = '0.1.0a';



// You can sort of think of DeltaDB like a "Delta Integral"; It maintains the total "sums" of the deltas.
// It also and manages events, storage, and network synchronization.
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
DeltaDB.DB.prototype._pushToMaster = function(id, delta) {
    //  Error handler that rolls back if the master does not accept the change.
};
DeltaDB.DB.prototype._pushToSlaves = function(id, delta) {
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
DeltaDB.DB.prototype.off = function(id, event, callback) {
    if(!id)
        throw new Error('Invalid id!');
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) return;
    d.off(event, callback, state);
};
DeltaDB.DB.prototype._trigger = function(id, path, data) {
    var state = this._getRawState(id);
    var d = state.dispatcher
    if(!d) return;
    d.trigger(path, data);
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
    this._storage.create(id);
    this._states[id] = {state:{}, dispatcher:null};
};
DeltaDB.DB.prototype.rollback = function(id, toSeq) {
    // This function is useful when a state has become corrupted (maybe by external tampering,
    // or by a partial delta application), and you want to revert to the previous good state.
    var state = this._getRawState(id);
    if(toSeq === undefined)
        toSeq = 0;  // Some number in case there are no deltas.
        var lastDelta = this._storage.getLastDelta(id);
        if(lastDelta) 
            toSeq = lastDelta.seq;
    state.state = this.render(id, toSeq);
    this._trigger(id, '$', {op:'reset'});
};
DeltaDB._EMPTY_OBJ_HASH = JDelta._hash('{}');
DeltaDB.DB.prototype._addHashedDelta = function(id, delta) {
    // Called by the DeltaDB API (not the end user) with a delta object like this:
    //     { steps:[...], meta:{...}, parentHash:str, curHash:str, seq:int, undoSeq:int, redoSeq:int }
    var state = this._getRawState(id),
        lastDelta = this._storage.getLastDelta(id),
        parentSeq = 0,
        parentHash = DeltaDB._EMPTY_OBJ_HASH;
    if(lastDelta) {
        parentSeq = lastDelta.seq;
        parentHash = lastDelta.curHash;
    }
    if(delta.seq !== parentSeq + 1)
        throw new Error('invalid sequence!');
    if(delta.parentHash !== parentHash)
        throw new Error('invalid parentHash: '+delta.parentHash+' != '+parentHash);
    try {
        JDelta.patch(state.state, delta, state.dispatcher);
        if(JDelta._hash(JDelta.stringify(state.state)) !== delta.curHash)
            throw new Error('invalid curHash!');
    } catch(e) {
        this.rollback(id, parentSeq);
        throw e;
    }
    this._storage.addDelta(id, delta);
    this._pushToMaster(id, delta);
    this._pushToSlaves(id, delta);
};
DeltaDB.DB.prototype._addDelta = function(id, delta) {
    var state = this._getRawState(id);
    var oldHash = JDelta._hash(JDelta.stringify(state.state));
    var newStateCopy = JDelta.patch(JDelta._deepCopy(state.state), delta);
    var newHash = JDelta._hash(JDelta.stringify(newStateCopy));
    if(newHash === oldHash)
        return;     // No change.  Let's just pretend this never happend...
    var parentSeq = null;
    var lastDelta = this._storage.getLastDelta(id);
    if(lastDelta) parentSeq = lastDelta.seq;
    var newSeq = parentSeq + 1;
    var hashedDelta = { steps:delta.steps, meta:delta.meta || {}, parentHash:oldHash, curHash:newHash, seq:newSeq, undoSeq:-newSeq, redoSeq:null };
    this._addHashedDelta(id, hashedDelta);
};

/*******************************************************************************
 *
 *  EXAMPLE SEQUENCE of operations, so you can see how the sequence pieces fit together:
 *
 *
 *  seq  undoSeq  redoSeq  parentHash  curHash  steps
 *  ---  -------  -------  ----------  -------  ------------
 *    1       -1     null    hash({})        a  #1                       // {} --> a
 *    2       -2     null           a        b  #2                       // a  --> b
 *    3       -3     null           b        c  #3                       // b  --> c
 *    4       -4     null           c        d  #4                       // c  --> d
 *    5       -5     null           d        e  #5                       // d  --> e
 *    6       -4       -6           e        d  #6 = rev(#5)  <--- undo  // e  --> d
 *    7       -3       -7           d        c  #7 = rev(#4)  <--- undo  // d  --> c
 *    8       -2       -8           c        b  #8 = rev(#3)  <--- undo  // c  --> b
 *    9       -9       -7           b        c  #9 = rev(#8)  <--- REDO  // b  --> c
 *   10       -2      -10           c        b  #10= rev(#9)  <--- undo  // c  --> b.  undoSeq=-2 comes from seq 8 (the one previous to 9, which was our undoSeq)
 *   11       -1      -11           b        a  #11= rev(#2)  <--- undo  // b  --> a
 *   12     null      -12           a hash({})  #12= rev(#1)  <--- undo  // a  --> {}.  Unable to undo any more because undoSeq == null.
 *   13      -13      -11    hash({})        a  #13= rev(#12) <--- REDO  // {} --> a
 *   14      -14      -10           a        b  #14= rev(#11) <--- REDO  // a  --> b
 *   15      -15       -7           b        c  #15= rev(#10) <--- REDO  // b  --> c.  redoSeq=-7 comes from seq 9 (the one previous to 10, which was our redoSeq).
 *   16      -16       -6           c        d  #16= rev(#7)  <--- REDO  // c  --> d
 *   17      -17     null           d        e  #17= rev(#6)  <--- REDO  // d  --> e.  Unable to redo any more because redoSeq == null.
 *   18      -16      -18           e        d  #18= rev(#17) <--- undo  // e  --> d
 *   19      -15      -19           d        c  #19= rev(#16) <--- undo  // d  --> c
 *   20      -20     null           c        f  #20                      // c  --> f
 *   21      -21     null           f        g  #21                      // f  --> g
 *   22      -22     null           g        h  #22                      // g  --> h
 *   23      -21      -23           h        g  #23= rev(#22) <--- undo  // h  --> g
 *   24      -20      -24           g        f  #24= rev(#21) <--- undo  // g  --> f
 *   25      -15      -25           f        c  #25= rev(#20) <--- undo  // f  --> c.  Did you notice that either the undoSeq or redoSeq is always equal to -seq?
 *
 ******************************************************************************/
DeltaDB.DB.prototype.edit = function(id, operations, meta) {
    // Called by the end user with an 'operations' arg like JsonDelta.create.
    // Can also include an optional 'meta' object to include info about the change, such as date, user, etc.
    var state = this._getRawState(id);
    var delta = JDelta.create(state.state, operations);
    delta.meta = meta;
    this._addDelta(id, delta);
};
DeltaDB.DB.prototype.canUndo = function(id) {
    var lastDelta = this._storage.getLastDelta(id);
    return lastDelta.undoSeq < 0;
};
DeltaDB.DB.prototype.undo = function(id) {
    var lastDelta = this._storage.getLastDelta(id);
    if(!lastDelta)
        throw new Error('unable to undo (no deltas)!');
    if(lastDelta.undoSeq >= 0)
        throw new Error('unable to undo (already at beginning)!');
    var newSeq = lastDelta.seq + 1;
    var undoDeltaSteps = JDelta.reverse(this._storage.getDelta(id, -lastDelta.undoSeq));
    var newUndoSeq = lastDelta.undoSeq + 1;
    var newRedoSeq = -newSeq;
    var postUndoHash,
        newMeta;
    if(newUndoSeq < 0) {
        // We are able to perform a normal undo.  We have not reached the beginning.
        postUndoDelta = this._storage.getDelta(id, -lastDelta.undoSeq - 1);
        postUndoHash = postUndoDelta.curHash;
        newMeta = JDelta._deepCopy(postUndoDelta.meta);
    } else {
        // We have reached the beginning.
        postUndoHash = DeltaDB._EMPTY_OBJ_HASH;
        newMeta = {};
    }
    newMeta.operation = 'undo';
    var hashedDelta = { steps:undoDeltaSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postUndoHash, seq:newSeq, undoSeq:newUndoSeq, redoSeq:newRedoSeq };
    this._addHashedDelta(id, hashedDelta);
};
DeltaDB.DB.prototype.canRedo = function(id) {};
DeltaDB.DB.prototype.redo = function(id) {
};






// Delta Structure:  { steps:[...], meta:{...}, parentHash:str, curHash:str, seq:int, undoSeq:int, redoSeq:int }
DeltaDB.RamStorage = function() {
    this._data = {};
};
DeltaDB.RamStorage.prototype._getRawDeltas = function(id) {
    if(!this._data.hasOwnProperty(id))
        throw new Error("'id' not found: "+id);
    return this._data[id];
};
DeltaDB.RamStorage.prototype.create = function(id) {
    if(this._data.hasOwnProperty(id))
        throw new Error('Already exists: '+id);
    this._data[id] = [];
};
DeltaDB.RamStorage.prototype.getDelta = function(id, seq) {
    // There is probably a much faster way to search for the right delta... maybe a binary search, or maybe even some heuristics based on the sequence number and the array index.
    var deltaList = this._getRawDeltas(id),
        i, ii, d;
    for(i=0, ii=deltaList.length; i<ii; i++) {
        d = deltaList[i];
        if(d.seq === seq) return d;
    }
    throw new Error('Not Found: '+id+', '+seq);
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


