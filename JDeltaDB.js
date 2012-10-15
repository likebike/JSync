//  JDelta - Delta-Sequence Database
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)

"use strict";

// Many ideas inspired by CouchDB and GIT.


(function() {

// First, install ourselves and import our dependencies:
var JDeltaDB = {},
    JDelta,
    _,
    fs,
    PATH,
    undefined,   //  So undefined really will be undefined.
    gotServerTime = false,
    serverTimeOffset = 0,
    getServerTimeOffset = function() {
        jQuery.ajax({
            url:'/jdelta_gettime',
            type:'GET',
            complete:function(jqXHR, retCodeStr) {
                // 'complete' is always called, whether the ajax is successful or not.
                var serverDate = new Date(jqXHR.getResponseHeader('Date'));
                serverTimeOffset = serverDate.getTime() - new Date().getTime();
                gotServerTime = true;
            }
        });
    },
    waitForServerTime = function(callback) {
        var doCheck = function() {
            if(gotServerTime) return callback(serverTimeOffset);
            else return setTimeout(doCheck, 100);
        }
        doCheck();
    };
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.JDeltaDB = JDeltaDB;
    JDelta = require('./JDelta.js').JDelta;
    _ = require('underscore');
    fs = require('fs');
    PATH = require('path');
    // Assume that we are the time authority.
    gotServerTime = true;
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.JDeltaDB = JDeltaDB;
    JDelta = window.JDelta;
    _ = window._;
    fs = null;
    PATH = null;
    jQuery = window.jQuery  ||  window.$;
    getServerTimeOffset();
} else throw new Error('This environment is not yet supported.');

JDeltaDB.VERSION = '0.2.0';



// You can sort of think of JDeltaDB like a "Delta Integral"; It maintains the total "sums" of the deltas.
JDeltaDB.DB = function(storage, onSuccess, onError) {
    // Guard against forgetting the 'new' operator:  "var db = JDeltaDB.DB();"   instead of   "var db = new JDeltaDB.DB();"
    if(!(this instanceof JDeltaDB.DB))
        return new JDeltaDB.DB(storage, onSuccess, onError);
    this._states = {}; // State Structure: { state:json, dispatcher:obj }
    this._regexListeners = [];
    this._loadListeners = [];
    this._storage = storage || new JDeltaDB.RamStorage();
    this._load();
    this.waitForLoad(onSuccess);
};
JDeltaDB.DB.prototype.waitForLoad = function(callback) {
    if(!callback) return;
    if(!this._loading) return callback(this);
    this._loadListeners[this._loadListeners.length] = callback;
};
JDeltaDB.DB.prototype._load = function() {
    var self = this;
    this._loading = true;
    var notifyLoadListeners = function() {
        self._loading = false;
        for(var i=self._loadListeners.length-1; i>=0; i--) {
            self._loadListeners[i](self);
            delete self._loadListeners[i];
        }
    };
    this._storage.listIDs(function(ids) {
        var tracker = JDeltaDB._AsyncTracker(notifyLoadListeners);
        var id, i, ii;
        for(i=0, ii=ids.length; i<ii; i++) {
            tracker.numOfPendingCallbacks++;
            id = ids[i];
            if(!self._states.hasOwnProperty(id))
                self.createState(id, true);
            self.rollback(id, undefined, function(id) {
                tracker.checkForEnd();
            }, function(err) {
                tracker.thereWasAnError = true;
                setTimeout(notifyLoadListeners, 0);  // Keep going, even though we are going to throw an exception.
                throw err;
                tracker.checkForEnd();
            });
        }
        tracker.checkForEnd();
    }, function(err) {
        setTimeout(notifyLoadListeners, 0);
        throw err;
    });
};
JDeltaDB.DB.prototype.on = function(id, event, callback) {
    if(!id)
        throw new Error('Invalid id!');
    if(!event)
        throw new Error('Invalid event!');
    if(!callback)
        throw new Error('Invalid callback!');
    if(_.isRegExp(id))
        return this._onRegex(id, event, callback);
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) d = state.dispatcher = JDelta.createDispatcher();
    d.on(event, callback, state);  // It is crucial that the callbacks do not modify the state!
};
JDeltaDB.DB.prototype.off = function(id, event, callback) {
    if(!id)
        throw new Error('Invalid id!');
    if(_.isRegExp(id))
        return this._offRegex(id, event, callback);
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) return;
    d.off(event, callback, state);
};
JDeltaDB.DB.prototype._onRegex = function(idRegex, event, callback) {
    this._regexListeners[this._regexListeners.length] = {idRegex:idRegex, event:event, callback:callback};
    var self = this;
    this.iterStates(idRegex, function(id, state) {
        self.on(id, event, callback);
    });
};
JDeltaDB.DB.prototype._offRegex = function(idRegex, event, callback) {
    var self = this;
    this.iterStates(idRegex, function(id, state) {
        self.off(id, event, callback);
    });
    var i, l;
    for(i=this._regexListeners.length-1; i>=0; i--) {
        l = this._regexListeners[i];
        if(l.idRegex === idRegex  &&  l.event === event  &&  l.callback === callback) {
            this._regexListeners.splice(i, 1);
        }
    }
};
JDeltaDB.DB.prototype._trigger = function(path, id, data) {
    var state = this._getRawState(id);
    var d = state.dispatcher
    if(!d) return;
    d.trigger(path, id, data);
};
JDeltaDB.DB.prototype.render = function(id, endSeq, onSuccess, onError) {
    if(endSeq === null) endSeq = undefined;  // Allow the user to specify null too.
    this._storage.getDeltas(id, 0, endSeq,
        function(id, deltas){
            // For now, we just use a simplistic algorithm of iterating thru all the deltas.
            // It is easily possible to optimize this algorithm by using the undo-hashes to
            // find the minimum number of deltas that we need to merge.  But I'll wait for
            // a performance need to arise before doing that, cuz it's a bit more complex.
            var o = JDelta.render(id, deltas);
            return onSuccess(o);
        }, function(error){
            if(onError) return onError(error);
            else throw error;
        });
};
JDeltaDB.DB.prototype.listStates = function() {
    var states = [],
        id;
    for(id in this._states) if(this._states.hasOwnProperty(id)) {
        states[states.length] = id;
    }
    states.sort();
    return states;
};
JDeltaDB.DB.prototype.iterStates = function(idRegex, func) {
    var ids = this.listStates(),
        i, ii, id;
    for(i=0, ii=ids.length; i<ii; i++) {
        id = ids[i];
        if(idRegex.test(id))
            func(id, this._getRawState(id));
    }
};
JDeltaDB.DB.prototype.contains = function(id) {
    return this._states.hasOwnProperty(id);
};
JDeltaDB.DB.prototype._getRawState = function(id) {
    if(!this._states.hasOwnProperty(id))
        throw new Error('No such state: '+id);
    return this._states[id];
};
JDeltaDB.DB.prototype.getState = function(id) {
    return this._getRawState(id).state;
};
JDeltaDB.DB.prototype.createState = function(id, doNotCreateInStorage) {
    if(this._states.hasOwnProperty(id))
        throw new Error('State already exists: '+id);
    if(!doNotCreateInStorage) this._storage.createStateSync(id);  // 'doNotCreateInStorage' is useful when loading a storage database and re-creating the equivalent states in the DB.  In this case, the data is already in the storage, so no need to add it again (plus, it would cause an error).
    this._states[id] = {state:{}, dispatcher:null};
    var i, ii, l;
    for(i=0, ii=this._regexListeners.length; i<ii; i++) {
        l = this._regexListeners[i];
        if(l.idRegex.test(id)) {
            this.on(id, l.event, l.callback);
        }
    }
    this._trigger('!', id, {op:'createState'});
};
JDeltaDB.DB.prototype.deleteState = function(id, onSuccess, onError) {
    if(!this._states.hasOwnProperty(id)) {
        var err = new Error('State does not exist: '+id);
        if(onError) return onError(err);
        else throw err;
    }
    var self = this;
    this._storage.deleteState(id, function(id) {
        self._trigger('!', id, {op:'deleteState'});
        delete self._states[id];
        if(onSuccess) return onSuccess();
    }, onError);
};
JDeltaDB.DB.prototype.rollback = function(id, toSeq, onSuccess, onError, _alreadyLocked) {
    // This function is useful when a state has become corrupted (maybe by external tampering,
    // or by a partial delta application), and you want to revert to the previous good state.
    var self = this;
    this._storage.acquireLock(_alreadyLocked, function(unlock) {
        var doRender = function(toSeq) {
            var state = self._getRawState(id);
            self.render(id, toSeq,
                        function(o){
                            state.state = o;
                            self._trigger('!', id, {op:'reset'});
                            onSuccess && onSuccess(id);
                            return unlock();
                        },
                        function(err){
                            setTimeout(unlock, 0);
                            if(onError) return onError(err);
                            else throw err;
                        });
        };
        if(toSeq === undefined)
            self._storage.getLastDelta(id,
                function(id, lastDelta) {
                    doRender(lastDelta.seq);
                }, onError);
        else
            doRender(toSeq);
    });
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
JDeltaDB._EMPTY_OBJ_HASH = JDelta._dsHash('{}');
JDeltaDB._PSEUDO_DELTA_0 = { steps:[], meta:{pseudoDelta:true}, parentHash:null, curHash:JDeltaDB._EMPTY_OBJ_HASH, seq:0, undoSeq:null, redoSeq:null };
JDeltaDB.DB.prototype._addHashedDelta = function(id, delta, onSuccess, onError, _alreadyLocked) {
    // Called by the JDeltaDB API (not the end user) with a delta object like this:
    //     { steps:[...], meta:{...}, parentHash:str, curHash:str, seq:int, undoSeq:int, redoSeq:int }
    var self = this;
    this._storage.acquireLock(_alreadyLocked, function(unlock) {
        console.log('_addHashedDelta: ACQUIRED LOCK:',id);
        var stdOnErr = function(err) {
            setTimeout(unlock, 0);
            if(onError) return onError(err);
            else throw err;
        };
        self._storage.getLastDelta(id, function(id, lastDelta) {
            var state = self._getRawState(id),
                parentSeq = lastDelta.seq,
                parentHash = lastDelta.curHash;
            if(delta.seq !== parentSeq + 1) return stdOnErr(new Error('invalid sequence! '+delta.seq+' != '+(parentSeq+1)));
            if(delta.parentHash !== parentHash) {
                // This is occuring rarely, and intermittetently.  Occurred on 2012-08-14 suring an edit of the joinDB (which should never have errors because only the server edits it).
                // I have a theory that the state is getting modified/tampered somehow.  I verified that 'parentHash' (derived from lastDelta) is valid, while the 'delta.parentHash' seems invalid.  Hence, my theory about tampered state.
                // 2012-08-15.  This occurred again.  I was able to determine that the join subscription mode was not matching as expected.   On top of that, the subscription mode of one of the items was Silent, but the state was not the global state.  AS far as I know, the Silent state should only really occur in the global state.
                // 2012-08-15.  Occurred when I opened more tabs to the same whiteboard, then closed them, and did a refresh on the final (original) one.  This time, the file had an extra state that the memory did not have.  The delta that triggered the problem was adding a new (different) join connection for the browser that we refreshed.
                // 2012-08-16.  A connection in Memory had a subscription of "sJ+rS" while the disk was "".  Error occurred while creating a different connection.
                // 2012-08-16.  Same as above, except the error occurred while DELETING a different connection.
                // 2012-08-16.  Same as above.
                // 2012-08-17.  Same as above.  (Disk: "", Mem: "sJ+rS", Deleting different connection)
                // ---  Here, I adjusted the logic so that blank subscriptions no longer get placed into non-root join states.
                // 2012-08-21.  The Mem object had an entry that the disk did not.  The operation that triggered this was unrelated.
                console.log('Tampered state???  (You can compare to the file data of %s)',id);
                console.log(JDelta.stringify(state.state));
                console.log(JDelta._dsHash(JDelta.stringify(state.state)));
                console.log(delta);
                return stdOnErr(new Error('invalid parentHash: '+delta.parentHash+' != '+parentHash));
            }

            waitForServerTime(function(serverTimeOffset) {
                if(!delta.meta.hasOwnProperty('date'))
                    delta.meta.date = new Date(new Date().getTime() + serverTimeOffset).toUTCString();
                try {
                    JDelta.patch(id, state.state, delta, state.dispatcher);
                    if(JDelta._dsHash(JDelta.stringify(state.state)) !== delta.curHash)
                        throw new Error('invalid curHash!');  // Rollback in the catch.
                } catch(e) {
                    var delayedUnlock = function() { setTimeout(unlock, 0); };
                    self.rollback(id, parentSeq, delayedUnlock, delayedUnlock, true);  // true = alreadyLocked.
                    if(onError) return onError(e);
                    else throw e;
                }
                self._storage.addDelta(id, delta, function() {
                    self._trigger('!', id, {op:'deltaApplied', delta:delta});
                    console.log('_addHashedDelta: RELEASING LOCK:',id);
                    onSuccess && onSuccess();
                    return unlock();
                }, stdOnErr);
            });
        }, stdOnErr);
    });
};
JDeltaDB.DB.prototype._addDelta = function(id, delta, onSuccess, onError, _alreadyLocked) {
    var self = this;
    this._storage.acquireLock(_alreadyLocked, function(unlock) {
        var stdOnErr = function(err) {
            setTimeout(unlock, 0);
            if(onError) return onError(err);
            else throw err;
        };

        var state = self._getRawState(id);
        var oldHash = JDelta._dsHash(JDelta.stringify(state.state));
        var newStateCopy = JDelta.patch(id, JDelta._deepCopy(state.state), delta);
        var newHash = JDelta._dsHash(JDelta.stringify(newStateCopy));
        if(newHash === oldHash) {
            // No change.  Let's just pretend this never happend...
            onSuccess && onSuccess();
            return unlock();
        }

        self._storage.getLastDelta(id, function(id, lastDelta) {
            var newSeq = lastDelta.seq + 1;
            var hashedDelta = { steps:delta.steps, meta:delta.meta || {}, parentHash:oldHash, curHash:newHash, seq:newSeq, undoSeq:-newSeq, redoSeq:null };
            self._addHashedDelta(id, hashedDelta, function() {
                onSuccess && onSuccess();
                return unlock();
            }, stdOnErr, true);  // true = alreadyLocked.
        }, stdOnErr);
    });
};
JDeltaDB.DB.prototype.edit = function(id, operations, meta, onSuccess, onError) {
    // Called by the end user with an 'operations' arg like JDelta.create.
    // Can also include an optional 'meta' object to include info about the change, such as date, user, etc.
    var self = this;
    this._storage.acquireLock(false, function(unlock) {
        var state = self._getRawState(id);
        var delta = JDelta.create(state.state, operations);
        delta.meta = meta;
        self._addDelta(id, delta, function() {
            onSuccess && onSuccess();
            return unlock();
        }, function(err) {
            setTimeout(unlock, 0);
            if(onError) return onError(err);
            else throw err;
        }, true);  // true = alreadyLocked.
    });
};
JDeltaDB.DB.prototype.canUndo = function(id, onSuccess, onError) {
    this._storage.getLastDelta(id, function(id, lastDelta) {
        return onSuccess(lastDelta.undoSeq !== null);
    }, onError);
};
JDeltaDB.DB.prototype.undo = function(id, meta, onSuccess, onError) {
    var self = this;
    this._storage.acquireLock(false, function(unlock) {
        var stdOnErr = function(err) {
            setTimeout(unlock, 0);
            if(onError) return onError(err);
            else throw err;
        };
        self._storage.getLastDelta(id, function(id, lastDelta) {
            if(!lastDelta) return stdOnErr(new Error('unable to undo (no deltas)!'));
            if(lastDelta.undoSeq === null) return stdOnErr(new Error('unable to undo (already at beginning)!'));
            var newSeq = lastDelta.seq + 1;
            var newRedoSeq = -newSeq;
            self._storage.getDelta(id, -lastDelta.undoSeq, function(id, preUndoDelta) {
                var undoSteps = JDelta.reverse(preUndoDelta);
                var postUndoSeq = (-lastDelta.undoSeq) - 1;

                var finishProcessWithPostUndoDelta = function(id, postUndoDelta) {
                    var postUndoUndoSeq = postUndoDelta.undoSeq;
                    var postUndoHash = postUndoDelta.curHash;
                    var newMeta = _.extend(JDelta._deepCopy(postUndoDelta.meta), {operation:'undo'}, meta);
                    var hashedDelta = { steps:undoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postUndoHash, seq:newSeq, undoSeq:postUndoUndoSeq, redoSeq:newRedoSeq };
                    self._addHashedDelta(id, hashedDelta, function() {
                        onSuccess && onSuccess();
                        return unlock();
                    }, stdOnErr, true);  // true = alreadyLocked.
                };

                if(postUndoSeq > 0) {
                    return self._storage.getDelta(id, postUndoSeq, finishProcessWithPostUndoDelta, stdOnErr);
                } else {
                    return finishProcessWithPostUndoDelta(id, JDeltaDB._PSEUDO_DELTA_0);
                }
            }, stdOnErr);
        }, stdOnErr);
    });
};
JDeltaDB.DB.prototype.canRedo = function(id, onSuccess, onError) {
    this._storage.getLastDelta(id, function(id, lastDelta) {
        return onSuccess(lastDelta.redoSeq !== null);
    }, onError);
};
JDeltaDB.DB.prototype.redo = function(id, meta, onSuccess, onError) {
    var self = this;
    this._storage.acquireLock(false, function(unlock) {
        var stdOnErr = function(err) {
            setTimeout(unlock, 0);
            if(onError) return onError(err);
            else throw err;
        };
        self._storage.getLastDelta(id, function(id, lastDelta) {
            if(!lastDelta) return stdOnErr(new Error('unable to redo (no deltas)!'));
            if(lastDelta.redoSeq === null) return stdOnErr(new Error('unable to redo (already at end)!'));
            var newSeq = lastDelta.seq + 1;
            var newUndoSeq = -newSeq;
            self._storage.getDelta(id, -lastDelta.redoSeq, function(id, preRedoDelta) {
                var redoSteps = JDelta.reverse(preRedoDelta);
                var postRedoSeq = (-lastDelta.redoSeq) - 1;
                self._storage.getDelta(id, postRedoSeq, function(id, postRedoDelta) {
                    var postRedoRedoSeq = postRedoDelta.redoSeq;
                    var postRedoHash = postRedoDelta.curHash;
                    var newMeta = _.extend(JDelta._deepCopy(postRedoDelta.meta), {operation:'redo'}, meta);
                    var hashedDelta = { steps:redoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postRedoHash, seq:newSeq, undoSeq:newUndoSeq, redoSeq:postRedoRedoSeq };
                    self._addHashedDelta(id, hashedDelta, function() {
                        onSuccess && onSuccess();
                        return unlock();
                    }, stdOnErr, true); // true = alreadyLocked
                }, stdOnErr);
            }, stdOnErr);
        }, stdOnErr);
    });
};

/////////// If you need multi-state edits, YOU'RE DOING IT WRONG!!!  Multi-state edit is riddled with complexity and cornercase issues.  It is a bad way to do things.
////  JDeltaDB.DB.prototype.multiStateEdit = function(operations, onSuccess, onError) {
////      // "Transactions" across multiple states.  Undo/Redo becomes *really* complicated across multiple states (which could possibly be edited individually), so please just don't do it.  If you really want to undo/redo a multi-state operation, you'll have to do that yourself.  Maybe your particular situation will allow you to accomplish it easily.  But this is a very difficult problem to solve "in general".
////      // Multi-state operations are essential for keeping multiple things in sync.
////      // Also need to be able to create/delete states.  (Like adding a comment item, and also appending the commentID to a user's list.)  Need to be able to handle ID creation/concurrency/error handling here.
////      // ...but VIEWS are usually a better solution.
////      throw new Error('not implemented yet because Views will probably be way better.');
////  };

JDeltaDB.DB.prototype.getEditHistory = function(id, onSuccess, onError) {
    var self = this;
    this._storage.getDeltas(id, undefined, undefined, function(id, deltas) {
        var history = {},
            i, ii, steps, j, jj, totalPath;
        for(i=0, ii=deltas.length; i<ii; i++) {
            steps = deltas[i].steps;
            for(j=0, jj=steps.length; j<jj; j++) {
                totalPath = steps[j].path +'.'+ steps[j].key;
                if(steps[j].op === 'arrayInsert') {
                    var curKey = steps[j].key,
                        curValue = [deltas[i]],
                        nextKey, nextValue, curTotalPath, nextTotalPath;
                    while(true) {
                        nextKey = curKey + 1;
                        curTotalPath = steps[j].path +'.'+ curKey;
                        nextTotalPath = steps[j].path +'.'+ nextKey;
                        nextValue = history[nextTotalPath];
                        history[curTotalPath] = curValue;
                        if(!history.hasOwnProperty(nextTotalPath)) break;
                        curKey = nextKey;
                        curValue = nextValue;
                    }
                } else if(steps[j].op === 'arrayRemove') {
                    if(!history.hasOwnProperty(totalPath)) {
                        if(typeof console !== 'undefined') console.log('Delta for upcoming error:', deltas[i]);
                        var err = new Error('getEditHistory: Invalid arrayRemove');
                        if(onError) return onError(err);
                        else throw err;
                    }
                    var prevKey = steps[j].key,
                        curKey, prevTotalPath, curTotalPath;
                    while(true) {
                        curKey = prevKey + 1,
                        prevTotalPath = steps[j].path +'.'+ prevKey;
                        curTotalPath = steps[j].path +'.'+ curKey;
                        if(!history.hasOwnProperty(curTotalPath)) break;
                        history[prevTotalPath] = history[curTotalPath];
                        prevKey = curKey;
                    }
                    delete history[prevTotalPath];
                } else if(steps[j].after) {
                    if(history.hasOwnProperty(totalPath)) {
                        history[totalPath].push(deltas[i]);
                    } else {
                        history[totalPath] = [deltas[i]];
                    }
                } else {
                    if(!history.hasOwnProperty(totalPath)) {
                        if(typeof console !== 'undefined') console.log(deltas[i]);
                        var err = new Error('getEditHistory: Invalid delete');
                        if(onError) return onError(err);
                        else throw err;
                    }
                    delete history[totalPath]
                }
            }
        }
        return onSuccess(history);
    }, onError);
};












// Delta Structure:  { steps:[...], meta:{...}, parentHash:str, curHash:str, seq:int, undoSeq:int, redoSeq:int }
JDeltaDB.RamStorage = function(filepath) {
    // Guard against forgetting the 'new' operator:  "var db = JDeltaDB.RamStorage();"   instead of   "var db = new JDeltaDB.RamStorage();"
    if(!(this instanceof JDeltaDB.RamStorage))
        return new JDeltaDB.RamStorage(filepath);
    this.__data = {};
    this.__filepath = null;
    if(filepath)  this.__filepath = PATH.resolve(filepath);
    this.__loadSync();
    this.save = _.debounce(_.bind(this._rawSave, this), 1000);
};
JDeltaDB.RamStorage.prototype.acquireLock = function(alreadyLocked, callback) {
    //console.log('acquireLock...');
    if(alreadyLocked) {
        //console.log('Already own lock.  Calling...');
        return callback(function() {});
    }
    if(!this._lockQueue) this._lockQueue = []; /// I initialize this way so I can just inherit these two functions in subclasses and get this functionality, without requiring any setup in the constructor.

    this._lockQueue[this._lockQueue.length] = callback;

    if(!this.lockKey) {
        //console.log('No lock.  Running immediately.');
        return this._nextLockCB();
    }
    //console.log('Adding to lock queue.');
    //console.trace();
};
JDeltaDB.RamStorage.prototype._nextLockCB = function() {
    //console.log('nextLockCB...');
    var self = this;
    if(this.lockKey) throw new Error('NextLockCB called while previous lock exists!');
    if(!this._lockQueue.length) {
        //console.log('Empty lockQueue.');
        return; // Nothing left to do.
    }
    var lockKey = this.lockKey = {};  // Create a unique object.
    //console.log('Lock Acquired.');
    //console.trace();
    var unlock = function() {
        //console.log('Unlock Called.');
        return self._releaseLock(lockKey);
    };
    try {
        var callback = this._lockQueue.splice(0,1)[0];
        return callback(unlock);
    } catch(e) {
        if(typeof console !== 'undefined') {
            console.log('Exception during Storage Lock callback:',e);
            if(e.stack) console.log(e.stack);
        }
        setTimeout(function() {
            if(self.lockKey === lockKey) {
                //console.log('Auto un-locking...');
                unlock();
            }
        }, 0);
    }
};
JDeltaDB.RamStorage.prototype._releaseLock = function(key) {
    //console.log('releaseLock...');
    if(key !== this.lockKey) throw new Error('Incorrect LockKey!');
    this.lockKey = null;
    return this._nextLockCB(); // I was thinking of using setTimeout or postMessage to delay this (and allow the caller stack to run as expected), but it creates some corner cases (like double-calls of nextLockCB) and performance issues on IE6 (because setTimeout is always a minimum of 10ms ??? need to verify).  So i'll just chain the calls for now and change it if it's a problem.
};
JDeltaDB.RamStorage.prototype.__loadSync = function() {
    if(!this.__filepath) return;
    if(PATH.existsSync(this.__filepath)) {
        this.__data = JSON.parse(fs.readFileSync(this.__filepath));
    }
};
JDeltaDB.RamStorage.prototype._rawSave = function() {
    if(!this.__filepath) return;
    var newFilepath = this.__filepath + '.new';
    fs.writeFileSync(newFilepath, JDelta.stringify(this.__data, undefined, 2));
    fs.renameSync(newFilepath, this.__filepath);
};
JDeltaDB.RamStorage.prototype._exists = function(id, onSuccess, onError) {
    return onSuccess(this.__data.hasOwnProperty(id));
}
JDeltaDB.RamStorage.prototype._existsSync = function(id) {
    return this.__data.hasOwnProperty(id);
}
JDeltaDB.RamStorage.prototype._getRawDeltas = function(id, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    if(!this.__data.hasOwnProperty(id)) {
        var err = new Error("'id' not found: "+id);
        if(onError) return onError(err);
        else throw err;
    }
    return onSuccess(this.__data[id]);
};
JDeltaDB.RamStorage.prototype.listIDs = function(onSuccess, onError) {
    var ids = [],
        k;
    for(k in this.__data) if(this.__data.hasOwnProperty(k)) {
        ids[ids.length] = k;
    }
    ids.sort();
    return onSuccess(ids);
};
JDeltaDB.RamStorage.prototype.createStateSync = function(id) {
    if(this._existsSync(id))
        throw new Error('Already exists: '+id);
    this.__data[id] = [];
    this.save();
};
JDeltaDB.RamStorage.prototype.deleteState = function(id, onSuccess, onError) {  // function cannot be named 'delete' because that is a reserved keyword in IE.
    var self = this;
    this._exists(id, function(exists) {
        if(!exists) {
            var err = new Error('Does not exist: '+id);
            if(onError) return onError(err);
            else throw err;
        }
        delete self.__data[id];
        self.save();
        return onSuccess(id);
    }, onError);
};
JDeltaDB.RamStorage.prototype.getDelta = function(id, seq, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id, function(deltaList) {
        // There are much faster ways to search for the right delta... maybe a binary search, or maybe even some heuristics based on the sequence number and the array index.
        var i, ii, d;
        for(i=0, ii=deltaList.length; i<ii; i++) {
            d = deltaList[i];
            if(d.seq === seq) return onSuccess(id, JDelta._deepCopy(d));
        }
        var err = new Error('Not Found: '+id+', '+seq);
        if(onError) return onError(err);
        else throw err;
    }, onError);
};
JDeltaDB.RamStorage.prototype.getDeltas = function(id, startSeq, endSeq, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id, function(deltaList) {
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
        return onSuccess(id, JDelta._deepCopy(out));
    }, onError);
};
JDeltaDB.RamStorage.prototype.getLastDelta = function(id, onSuccess, onError) {
    if(!onSuccess) throw new Error('You need to provide a callback.');
    this._getRawDeltas(id, function(deltaList) {
        var lastDelta = deltaList[deltaList.length-1];
        if(!lastDelta) {
            // There are no deltas.  Fake one:
            lastDelta = JDeltaDB._PSEUDO_DELTA_0;
        }
        return onSuccess(id, JDelta._deepCopy(lastDelta));
    }, onError);
};
JDeltaDB.RamStorage.prototype.addDelta = function(id, delta, onSuccess, onError) {
    var self = this;
    this._getRawDeltas(id, function(deltaList) {
        deltaList[deltaList.length] = delta;
        self.save();
        if(onSuccess) return onSuccess();
    }, onError);
};







JDeltaDB.DirStorage = function(dirpath) {
    if(!(this instanceof JDeltaDB.DirStorage)) return new JDeltaDB.DirStorage(dirpath);
    if(!PATH.existsSync(dirpath)) throw new Error('Dir does not exist: '+dirpath);
    this.__dirpath = PATH.resolve(dirpath);
    this.__hashPieceLen = 4;
    this.__statesCurrentlyInRam = {};
    this.__statesToSave = {};
    this.__stateAccessTimes = {};
    this.__stateIdleTime = 6000;//60000;
    this.save = _.debounce(_.bind(this._rawSave, this), 1000);
    this.removeStatesInterval = setInterval(_.bind(this.__removeInactiveStatesFromRam, this), 10000);
};
JDeltaDB.DirStorage.prototype.acquireLock = JDeltaDB.RamStorage.prototype.acquireLock;
JDeltaDB.DirStorage.prototype._nextLockCB = JDeltaDB.RamStorage.prototype._nextLockCB;
JDeltaDB.DirStorage.prototype._releaseLock = JDeltaDB.RamStorage.prototype._releaseLock;
JDeltaDB.DirStorage.prototype.__idToFilepath = function(id) {
    if(!_.isString(id)) throw new Error('Non-string id!');
    if(!id.length) throw new Error('Blank id!');
    var encodedID = encodeURIComponent(id);
    encodedID = encodedID.replace(/\./g, '%2E');  // Also encode '.' to avoid the '.' and '..' filenames.
    var hash = JDelta._dsHash(encodedID);
    if(hash.length !== 10) throw new Error('Unexpected hash length!' + hash);
    var hashPiece = hash.substring(10-this.__hashPieceLen,10);
    return this.__dirpath + '/' + hashPiece + '/' + encodedID;
};
JDeltaDB.DirStorage.prototype.__filepathToID = function(filepath) {
    if(filepath.lastIndexOf(this.__dirpath, 0) !== 0) throw new Error('filepath does not start with __dirpath!');
    if(filepath.charAt(this.__dirpath.length) !== '/') throw new Error("Expected '/'.");
    var hashPiece = filepath.substr(this.__dirpath.length+1, this.__hashPieceLen);
    if(filepath.charAt(this.__dirpath.length+1+this.__hashPieceLen) !== '/') throw new Error("Expected '/'.");
    var encodedID = filepath.substring(this.__dirpath.length+2+this.__hashPieceLen);
    var hash = JDelta._dsHash(encodedID);
    if(hash.substring(10-this.__hashPieceLen,10) !== hashPiece) throw new Error('hashPiece did not match!');
    return decodeURIComponent(encodedID);
};
JDeltaDB.DirStorage.prototype.__rawSaveState = function(id, onSuccess, onError) {
    if(!this.__statesCurrentlyInRam.hasOwnProperty(id)) {
        // If the item is not in RAM, then it means we need to delete it from disk.
        var filepath = this.__idToFilepath(id);
        fs.unlink(filepath, function(err) {
            if(err) return onError(err);
            onSuccess();
        });
        return;
    }
    var data = this.__statesCurrentlyInRam[id];
    var dataStr = JDelta.stringify(data, undefined, 2);
    var filepath = this.__idToFilepath(id);
    var newFilepath = filepath + '.WRITING';
    var dirpath = PATH.dirname(filepath);
    fs.mkdir(dirpath, parseInt('0755', 8), function(err) {  // I need to use parseInt because literal octals are forbidden in JS strict mode.
        if(err  &&  err.code !== 'EEXIST') return onError(err);
        fs.writeFile(newFilepath, dataStr, 'utf8', function(err) {
            if(err) return onError(err);
            fs.rename(newFilepath, filepath, function(err) {
                if(err) return onError(err);
                onSuccess();
            });
        });
    });
};
JDeltaDB.DirStorage.prototype._rawSave = function() {
    var self = this;
    var saveNextState = function() {
        var id = null;
        // Pick the first id we can get:
        for(id in self.__statesToSave) if(self.__statesToSave.hasOwnProperty(id)) {
            break;
        }
        if(id === null) return; // No more states to save.
        self.__rawSaveState(id, function() {
            delete self.__statesToSave[id];
            return saveNextState();
        }, function(err) {
            throw err;
        })
    };
    saveNextState();
};
JDeltaDB.DirStorage.prototype.__removeInactiveStatesFromRam = function() {
    var curTime = new Date().getTime(),
        stateTime;
    for(var id in this.__statesCurrentlyInRam) if(this.__statesCurrentlyInRam.hasOwnProperty(id)) {
        if(this.__statesToSave.hasOwnProperty(id)) {
            continue;  // Don't remove items that have not been saved.
        }
        stateTime = this.__stateAccessTimes[id] || 0;
        if(curTime - stateTime  >  this.__stateIdleTime) {
            console.log('Removing Inactive State from Ram:',id);
            delete this.__statesCurrentlyInRam[id];
        }
    }
};
JDeltaDB.DirStorage.prototype.__touch = function(id) {
    this.__stateAccessTimes[id] = new Date().getTime();
};
JDeltaDB.DirStorage.prototype._exists = function(id, onSuccess, onError) {
    this.__touch(id);
    if(this.__statesCurrentlyInRam.hasOwnProperty(id))
        return onSuccess(true);
    var filepath = this.__idToFilepath(id);
    PATH.exists(filepath, function(exists) {
        return onSuccess(exists);
    });
};
JDeltaDB.DirStorage.prototype._existsSync = function(id) {
    this.__touch(id);
    if(this.__statesCurrentlyInRam.hasOwnProperty(id))
        return true;
    var filepath = this.__idToFilepath(id);
    return PATH.existsSync(filepath);
};
JDeltaDB.DirStorage.prototype._getRawDeltas = function(id, onSuccess, onError) {
    var self = this;
    this.__touch(id);
    if(!this.__statesCurrentlyInRam.hasOwnProperty(id)) {
        var filepath = this.__idToFilepath(id);
        fs.readFile(filepath, 'utf8', function(err, data) {
            console.log('getRawDeltas: read done:',filepath);
            if(self.__statesCurrentlyInRam.hasOwnProperty(id)) {
                console.log('Already read by something else!  Re-using that.');
                return onSuccess(self.__statesCurrentlyInRam[id]);  // It got added by someone else while we were reading the file.
            }
            if(err) {
                if(onError) return onError(err);
                else throw err;
            }
            var state = self.__statesCurrentlyInRam[id] = JSON.parse(data);
            return onSuccess(state);
        });
    } else {
        return onSuccess(this.__statesCurrentlyInRam[id]);
    }
};
JDeltaDB.DirStorage.prototype.listIDs = function(onSuccess, onError) {
    var self = this;
    fs.readdir(this.__dirpath, function(err, files) {
        if(err) return onError(err);
        var hashDirs = [],
            i, ii;
        for(i=0, ii=files.length; i<ii; i++) {
            if(files[i].length === self.__hashPieceLen)
                hashDirs[hashDirs.length] = files[i];
        }
        var ids = [];
        var tracker = new JDeltaDB._AsyncTracker(function() {
            ids.sort();
            onSuccess(ids);
        });
        _.each(hashDirs, function(hashDir) {
            tracker.numOfPendingCallbacks++;
            fs.readdir(self.__dirpath+'/'+hashDir, function(err, files) {
                if(tracker.thereWasAnError) return;
                if(err) {
                    tracker.thereWasAnError = true;
                    return onError(err);
                }
                var ignoreSuffix = '.WRITING',
                    filename, j, jj;
                for(j=0, jj=files.length; j<jj; j++) {
                    filename = files[j];
                    // endswith:
                    if(!filename.indexOf(ignoreSuffix, filename.length - ignoreSuffix.length) !== -1) {
                        ids[ids.length] = decodeURIComponent(filename);
                    }
                }
                tracker.checkForEnd();
            });
        });
        tracker.checkForEnd();
    });
};
JDeltaDB.DirStorage.prototype.createStateSync = function(id) {
    this.__touch(id);
    if(this._existsSync(id))
        throw new Error('Already exists: '+id);
    this.__statesCurrentlyInRam[id] = [];
    this.__statesToSave[id] = true;
    this.save();
};
JDeltaDB.DirStorage.prototype.deleteState = function(id, onSuccess, onError) {
    var self = this;
    this.__touch(id);
    this._exists(id, function(exists) {
        if(!exists) {
            var err = new Error('Does no exist: '+id);
            if(onError) return onError(err);
            else throw err;
        }
        delete self.__statesCurrentlyInRam[id];
        self.__rawSaveState(id, onSuccess, onError);
    }, onError);
};
JDeltaDB.DirStorage.prototype.getDelta = JDeltaDB.RamStorage.prototype.getDelta;
JDeltaDB.DirStorage.prototype.getDeltas = JDeltaDB.RamStorage.prototype.getDeltas;
JDeltaDB.DirStorage.prototype.getLastDelta = JDeltaDB.RamStorage.prototype.getLastDelta;
JDeltaDB.DirStorage.prototype.addDelta = function(id, delta, onSuccess, onError) {
    var self = this;
    return JDeltaDB.RamStorage.prototype.addDelta.call(this, id, delta, function() {
        self.__statesToSave[id] = true;
        return onSuccess();
    }, onError);
};






















JDeltaDB._AsyncTracker = function(onSuccess) {  // Especially useful for tracking parallel async actions.
    if(!(this instanceof JDeltaDB._AsyncTracker)) 
        return new JDeltaDB._AsyncTracker(onSuccess);
    if(!onSuccess)
        throw new Error('You must provide an onSuccess function.');
    this.out = [];
    this.thereWasAnError = false;
    this.numOfPendingCallbacks = 1;  // You need to make an additional call to checkForEnd() after the iteration.
    this._onSuccess = onSuccess;
    this._onSuccessAlreadyCalled = false;
};
JDeltaDB._AsyncTracker.prototype.checkForEnd = function() {
    this.numOfPendingCallbacks--;
    if(this.thereWasAnError) return;
    if(this.numOfPendingCallbacks < 0) throw new Error('This should never happen');
    if(!this.numOfPendingCallbacks) {
        if(this._onSuccessAlreadyCalled) throw new Error('This should never happen');
        this._onSuccessAlreadyCalled = true;
        this._onSuccess(this.out);
    }
};
JDeltaDB._runAsyncChain = function(chain, onSuccess, onError) {
    var i=-1;
    if(!_.isArray(chain)) throw new Error("Expected 'chain' to be an Array.");
    onSuccess = onSuccess || function(){};
    onError = onError || function(err) { throw err };
    var next = function() {
        i += 1;
        if(i>chain.length) throw new Error('i>chain.length!'); // Should never happen.
        if(i==chain.length) {
            return onSuccess();
        }
        chain[i](next, onError);
    };
    return next();
};





})();
