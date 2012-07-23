//  JDelta - Delta-Sequence Database
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


// Many ideas inspired by CouchDB and GIT.


(function() {

// First, install ourselves and import our dependencies:
var JDeltaDB = {},
    JDelta,
    _,
    serverTimeOffset = 0;
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.JDeltaDB = JDeltaDB;
    JDelta = require('./JDelta.js').JDelta;
    _ = require('underscore');
    // Assume that we are the time authority.
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.JDeltaDB = JDeltaDB;
    JDelta = window.JDelta;
    _ = window._;
    jQuery = window.jQuery  ||  window.$;
    jQuery.ajax({url:'/gettime'}).always(function(arg1, arg2, arg3) {
        var xhr = arg1;
        if(typeof arg3 !== undefined  &&  arg3.getResponseHeader !== undefined)
            xhr = arg3;
        if(xhr.getResponseHeader === undefined)
            throw new Error('Unable to find XHR object for server time.');
        var serverDate = new Date(xhr.getResponseHeader('Date'));
        serverTimeOffset = serverDate.getTime() - new Date().getTime();
    });
} else throw new Error('This environment is not yet supported.');

JDeltaDB.VERSION = '0.1.0a';



// You can sort of think of JDeltaDB like a "Delta Integral"; It maintains the total "sums" of the deltas.
JDeltaDB.DB = function(storage) {
    // Guard against forgetting the 'new' operator:  "var db = JDeltaDB.DB();"   instead of   "var db = new JDeltaDB.DB();"
    if(this === JDeltaDB)
        return new JDeltaDB.DB(storage);
    this._storage = storage || new JDeltaDB.RamStorage();
    this._states = {}; // State Structure: { state:json, dispatcher:obj }
    this._regexListeners = [];
};
JDeltaDB.DB.prototype.on = function(id, event, callback) {
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
JDeltaDB.DB.prototype.off = function(id, event, callback) {
    if(!id)
        throw new Error('Invalid id!');
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) return;
    d.off(event, callback, state);
};
JDeltaDB.DB.prototype.onRegex = function(idRegex, callback) {
    this._regexListeners[this._regexListeners.length] = {regex:idRegex, func:callback};
};
JDeltaDB.DB.prototype.offRegex = function(idRegex, callback) {
    var i, l;
    for(i=this._regexListeners.length-1; i>=0; i--) {
        l = this._regexListeners[i];
        if(l.regex === idRegex  &&  l.func === callback) {
            this._regexListeners.splice(i, 1);
        }
    }
};
JDeltaDB.DB.prototype._regexTrigger = function(id, data) {
    var state = this._getRawState(id),
        i, ii, l, j, jj, e;
    for(i=0, ii=this._regexListeners.length; i<ii; i++) {
        l = this._regexListeners[i];
        if(l.regex.test(id)) 
            l.func.call(state, id, data);
    }
};
JDeltaDB.DB.prototype._trigger = function(id, path, data) {
    var state = this._getRawState(id);
    var d = state.dispatcher
    if(!d) return;
    d.trigger(path, data);
};
JDeltaDB.DB.prototype.render = function(id, endSeq, onSuccess, onError) {
    if(endSeq === null) endSeq = undefined;  // Allow the user to specify null too.
    this._storage.getDeltas(id, 0, endSeq,
        function(deltas){
            // For now, we just use a simplistic algorithm of iterating thru all the deltas.
            // It is easily possible to optimize this algorithm by using the undo-hashes to
            // find the minimum number of deltas that we need to merge.  But I'll wait for
            // a performance need to arise before doing that, cuz it's a bit more complex.
            var o = {},
                i, ii;
            for(i=0, ii=deltas.length; i<ii; i++) {
                JDelta.patch(o, deltas[i]);
            }
            onSuccess(o);
        }, function(error){
            if(onError) return onError(error);
            else throw error;
        });
};
JDeltaDB.DB.prototype._listStates = function() {
    var states = [],
        id;
    for(id in this._states) if(this._states.hasOwnProperty(id)) {
        states[states.length] = id;
    }
    states.sort();
    return states;
};
JDeltaDB.DB.prototype.iterStates = function(idRegex, func) {
    var ids = this._listStates(),
        i, ii, id;
    for(i=0, ii=ids.length; i<ii; i++) {
        id = ids[i];
        if(idRegex.test(id))
            func(id, this._getRawState(id));
    }
};
JDeltaDB.DB.prototype._getRawState = function(id) {
    if(!this._states.hasOwnProperty(id))
        throw new Error('No such state: '+id);
    return this._states[id];
};
JDeltaDB.DB.prototype.createStateSync = function(id) {   ///////////   Turn this into a delta operation.  stateCreate and stateDelete
    if(this._states.hasOwnProperty(id))
        throw new Error('State already exists: '+id);
    this._storage.createSync(id);
    this._states[id] = {state:{}, dispatcher:null};
    this._regexTrigger(id, {op:'createState'});
};
JDeltaDB.DB.prototype.rollback = function(id, toSeq, onSuccess, onError) {
    // This function is useful when a state has become corrupted (maybe by external tampering,
    // or by a partial delta application), and you want to revert to the previous good state.
    var that = this;
    var doRender = function(toSeq) {
        var state = that._getRawState(id);
        that.render(id, toSeq,
                    function(o){
                        state.state = o;
                        that._trigger(id, '$', {op:'reset'});
                        that._regexTrigger(id, {op:'reset'});
                        if(onSuccess) onSuccess();
                    },
                    function(err){if(onError) onError(err);
                                  else throw err;});
    };
    if(toSeq === undefined)
        this._storage.getLastDelta(id,
            function(lastDelta) {
                toSeq = 0;  // Some number in case there are no deltas.
                if(lastDelta) 
                    toSeq = lastDelta.seq;
                doRender(toSeq);
            }, onError);
    else
        doRender(toSeq);
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
JDeltaDB._EMPTY_OBJ_HASH = JDelta._hash('{}');
JDeltaDB.DB.prototype._addHashedDelta = function(id, delta, onSuccess, onError) {
    // Called by the JDeltaDB API (not the end user) with a delta object like this:
    //     { steps:[...], meta:{...}, parentHash:str, curHash:str, seq:int, undoSeq:int, redoSeq:int }
    var that = this;
    this._storage.getLastDelta(id,
        function(lastDelta) {
            var state = that._getRawState(id),
                parentSeq = 0,
                parentHash = JDeltaDB._EMPTY_OBJ_HASH;
            if(lastDelta) {
                parentSeq = lastDelta.seq;
                parentHash = lastDelta.curHash;
            }
            if(delta.seq !== parentSeq + 1) {
                var err = new Error('invalid sequence!');
                if(onError) return onError(err);
                else throw err;
            }
            if(delta.parentHash !== parentHash) {
                var err =  new Error('invalid parentHash: '+delta.parentHash+' != '+parentHash);
                if(onError) return onError(err);
                else throw err;
            }
            delta.meta.date = new Date(new Date().getTime() + serverTimeOffset).toUTCString();
            try {
                JDelta.patch(state.state, delta, state.dispatcher);
                if(JDelta._hash(JDelta.stringify(state.state)) !== delta.curHash) {
                    var err = new Error('invalid curHash!');
                    if(onError) return onError(err);
                    else throw err;
                }
            } catch(e) {
                that.rollback(id, parentSeq);
                throw e;
            }
            that._storage.addDelta(id, delta,
                function() {
                    that._regexTrigger(id, delta);
                    //that._pushToMaster(id, delta);
                    //that._pushToSlaves(id, delta);
                    if(onSuccess) onSuccess();
                }, onError);
        }, onError);
};
JDeltaDB.DB.prototype._addDelta = function(id, delta, onSuccess, onError) {
    var that = this;
    var state = this._getRawState(id);
    var oldHash = JDelta._hash(JDelta.stringify(state.state));
    var newStateCopy = JDelta.patch(JDelta._deepCopy(state.state), delta);
    var newHash = JDelta._hash(JDelta.stringify(newStateCopy));
    if(newHash === oldHash)
        return;     // No change.  Let's just pretend this never happend...
    var parentSeq = null;
    this._storage.getLastDelta(id,
        function(lastDelta) {
            if(lastDelta) parentSeq = lastDelta.seq;
            var newSeq = parentSeq + 1;
            var hashedDelta = { steps:delta.steps, meta:delta.meta || {}, parentHash:oldHash, curHash:newHash, seq:newSeq, undoSeq:-newSeq, redoSeq:null };
            that._addHashedDelta(id, hashedDelta, onSuccess, onError);
        }, function(err) {
            if(onError) onError(err);
            else throw err;
        });
};
JDeltaDB.DB.prototype.edit = function(id, operations, meta, onSuccess, onError) {
    // Called by the end user with an 'operations' arg like JDelta.create.
    // Can also include an optional 'meta' object to include info about the change, such as date, user, etc.
    var state = this._getRawState(id);
    var delta = JDelta.create(state.state, operations);
    delta.meta = meta;
    this._addDelta(id, delta, onSuccess, onError);
};
JDeltaDB.DB.prototype.canUndo = function(id, onSuccess, onError) {
    this._storage.getLastDelta(id,
        function(lastDelta) {
            onSuccess(lastDelta.undoSeq !== null);
        }, onError);
};
JDeltaDB.DB.prototype.undo = function(id, onSuccess, onError) {
    var that = this;
    this._storage.getLastDelta(id,
        function(lastDelta) {
            if(!lastDelta) {
                var err = new Error('unable to undo (no deltas)!');
                if(onError) return onError(err);
                else throw err;
            }
            if(lastDelta.undoSeq === null) {
                var err = new Error('unable to undo (already at beginning)!');
                if(onError) return onError(err);
                else throw err;
            }
            var newSeq = lastDelta.seq + 1;
            var newRedoSeq = -newSeq;
            that._storage.getDelta(id, -lastDelta.undoSeq,
                function(preUndoDelta) {
                    var undoSteps = JDelta.reverse(preUndoDelta);
                    var postUndoSeq = (-lastDelta.undoSeq) - 1;
                    if(postUndoSeq > 0) {
                        that._storage.getDelta(id, postUndoSeq,
                            function(postUndoDelta) {
                                var postUndoUndoSeq = postUndoDelta.undoSeq;
                                var postUndoHash = postUndoDelta.curHash;
                                var newMeta = _.extend(JDelta._deepCopy(postUndoDelta.meta), {operation:'undo'});
                                var hashedDelta = { steps:undoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postUndoHash, seq:newSeq, undoSeq:postUndoUndoSeq, redoSeq:newRedoSeq };
                                that._addHashedDelta(id, hashedDelta, onSuccess, onError);
                            }, onError);
                    } else {
                        var postUndoUndoSeq = null;
                        var postUndoHash = JDeltaDB._EMPTY_OBJ_HASH;
                        var newMeta = {operation:'undo'};
                        var hashedDelta = { steps:undoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postUndoHash, seq:newSeq, undoSeq:postUndoUndoSeq, redoSeq:newRedoSeq };
                        that._addHashedDelta(id, hashedDelta, onSuccess, onError);
                    }
                }, onError);
        }, onError);
};
JDeltaDB.DB.prototype.canRedo = function(id, onSuccess, onError) {
    this._storage.getLastDelta(id,
        function(lastDelta) {
            onSuccess(lastDelta.redoSeq !== null);
        }, onError);
};
JDeltaDB.DB.prototype.redo = function(id, onSuccess, onError) {
    var that = this;
    this._storage.getLastDelta(id,
        function(lastDelta) {
            if(!lastDelta) {
                var err = new Error('unable to redo (no deltas)!');
                if(onError) return onError(err);
                else throw err;
            }
            if(lastDelta.redoSeq === null) {
                var err = new Error('unable to redo (already at end)!');
                if(onError) return onError(err);
                else throw err;
            }
            var newSeq = lastDelta.seq + 1;
            var newUndoSeq = -newSeq;
            that._storage.getDelta(id, -lastDelta.redoSeq,
                function(preRedoDelta) {
                    var redoSteps = JDelta.reverse(preRedoDelta);
                    var postRedoSeq = (-lastDelta.redoSeq) - 1;
                    that._storage.getDelta(id, postRedoSeq,
                        function(postRedoDelta) {
                            var postRedoRedoSeq = postRedoDelta.redoSeq;
                            var postRedoHash = postRedoDelta.curHash;
                            var newMeta = _.extend(JDelta._deepCopy(postRedoDelta.meta), {operation:'redo'});
                            var hashedDelta = { steps:redoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postRedoHash, seq:newSeq, undoSeq:newUndoSeq, redoSeq:postRedoRedoSeq };
                            that._addHashedDelta(id, hashedDelta, onSuccess, onError);
                        }, onError);
                }, onError);
        }, onError);
};

/////////// If you need multi-state edits, YOU'RE DOING IT WRONG!!!  Multi-state edit is riddled with complexity and cornercase issues.  It is a bad way to do things.
////  JDeltaDB.DB.prototype.multiStateEdit = function(operations, onSuccess, onError) {
////      // "Transactions" across multiple states.  Undo/Redo becomes *really* complicated across multiple states (which could possibly be edited individually), so please just don't do it.  If you really want to undo/redo a multi-state operation, you'll have to do that yourself.  Maybe your particular situation will allow you to accomplish it easily.  But this is a very difficult problem to solve "in general".
////      // Multi-state operations are essential for keeping multiple things in sync.
////      // Also need to be able to create/delete states.  (Like adding a comment item, and also appending the commentID to a user's list.)  Need to be able to handle ID creation/concurrency/error handling here.
////      // ...but VIEWS are usually a better solution.
////      throw new Error('not implemented yet because Views will probably be way better.');
////  };








// Delta Structure:  { steps:[...], meta:{...}, parentHash:str, curHash:str, seq:int, undoSeq:int, redoSeq:int }
JDeltaDB.RamStorage = function() {
    // Guard against forgetting the 'new' operator:  "var db = JDeltaDB.RamStorage();"   instead of   "var db = new JDeltaDB.RamStorage();"
    if(this === JDeltaDB)
        return new JDeltaDB.RamStorage();
    this._data = {};
};
JDeltaDB.RamStorage.prototype.createSync = function(id) {
    if(this._data.hasOwnProperty(id))
        throw new Error('Already exists: '+id);
    this._data[id] = [];
};
JDeltaDB.RamStorage.prototype.create = function(id, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    if(this._data.hasOwnProperty(id)) {
        var err = new Error('Already exists: '+id);
        if(onError) return onError(err);
        else throw err;
    }
    this._data[id] = [];
    onSuccess();
};
JDeltaDB.RamStorage.prototype._getRawDeltas = function(id, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    if(!this._data.hasOwnProperty(id)) {
        var err = new Error("'id' not found: "+id);
        if(onError) return onError(err);
        else throw err;
    }
    onSuccess(this._data[id]);
};
JDeltaDB.RamStorage.prototype.getDelta = function(id, seq, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id,
        function(deltaList) {
            // There are much faster ways to search for the right delta... maybe a binary search, or maybe even some heuristics based on the sequence number and the array index.
            var i, ii, d;
            for(i=0, ii=deltaList.length; i<ii; i++) {
                d = deltaList[i];
                if(d.seq === seq) return onSuccess(d);
            }
            var err = new Error('Not Found: '+id+', '+seq);
            if(onError) return onError(err);
            else throw err;
        }, onError);
};
JDeltaDB.RamStorage.prototype.getDeltas = function(id, startSeq, endSeq, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id,
        function(deltaList) {
            var out = [],
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
            onSuccess(out);
        }, onError);
};
JDeltaDB.RamStorage.prototype.getLastDelta = function(id, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id,
        function(deltaList) {
            onSuccess(deltaList[deltaList.length-1]);
        }, onError);
};
JDeltaDB.RamStorage.prototype.addDelta = function(id, delta, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id,
        function(deltaList) {
            deltaList[deltaList.length] = delta;
            onSuccess();
        }, onError);
};


//JDeltaDB.RamStorage.prototype.listIDs = function() {
//    var ids = [],
//        k;
//    for(k in this._data) if(this._data.hasOwnProperty(k)) {
//        ids[ids.length] = k;
//    }
//    ids.sort();
//    return ids;
//};













JDeltaDB.SqliteStorage = function() {
    throw new Error('coming soon...');
};

})();


