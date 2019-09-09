//  JDelta - Delta-Sequence Database
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)

"use strict";

// Many ideas inspired by CouchDB and GIT.


(function(global) {

// First, install ourselves and import our dependencies:
var JDeltaDB = {};
JDeltaDB._gotServerTime = false;
JDeltaDB.serverTimeOffset = 0;
JDeltaDB.getServerTimeOffset = function() {
    jQuery.ajax({
        url:'/jdelta_gettime',
        type:'GET',
        complete:function(jqXHR, retCodeStr) {
            // 'complete' is always called, whether the ajax is successful or not.
            var serverDate = new Date(jqXHR.getResponseHeader('Date'));
            JDeltaDB.serverTimeOffset = serverDate.getTime() - new Date().getTime();
            JDeltaDB._gotServerTime = true;
        }
    });
};
JDeltaDB.waitForServerTime = function(callback) {
    var doCheck = function() {
        if(JDeltaDB._gotServerTime) return callback(JDeltaDB.serverTimeOffset);
        else return setTimeout(doCheck, 100);
    }
    doCheck();
};


var JDelta,
    _,
    fs,
    PATH,
    undefined;   //  So undefined really will be undefined.
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.JDeltaDB = JDeltaDB;
    JDelta = require('./JDelta.js').JDelta;
    _ = require('underscore');
    fs = require('fs');
    PATH = require('path');

    // Bring the Node 0.6 API up to the 0.8 API for path.sep:
    if(!PATH.sep) {
        PATH.sep = global.process.platform === 'win32' ? '\\' : '/';
    }

    // Assume that we are the time authority.
    JDeltaDB._gotServerTime = true;
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.JDeltaDB = JDeltaDB;
    JDelta = window.JDelta;
    _ = window._;
    fs = null;
    PATH = null;
    jQuery = window.jQuery  ||  window.$;
    // So slide's async-map can run efficiently on Node, but also function in the browser:
    if(!global.process) global.process = {nextTick:function(fn){setTimeout(fn,0)}};    // Notice that we do not use "var process" because that would prevent Node from accessing the process global.
    JDeltaDB.getServerTimeOffset();
} else throw new Error('This environment is not yet supported.');




// You can sort of think of JDeltaDB like a "Delta Integral"; It maintains the total "sums" of the deltas.
JDeltaDB.DB = function(storage, onSuccess, onError) {
    // Guard against forgetting the 'new' operator:  "var db = JDeltaDB.DB();"   instead of   "var db = new JDeltaDB.DB();"
    if(!(this instanceof JDeltaDB.DB))
        return new JDeltaDB.DB(storage, onSuccess, onError);
    this._states = {}; // State Structure: { state:json, dispatcher:obj }
    this._requireMetaFrom = true;
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
        JDeltaDB._asyncMap(ids,
                           function(id, next) {
                               if(!self._states.hasOwnProperty(id)) self.createState(id, true);
                               self.rollback(id, undefined, function(id) {
                                   next();
                               }, function(err) {
                                   if(!err) err = new Error();
                                   next(err);
                                   setTimeout(notifyLoadListeners, 0);  // Keep going, even though we are going to throw an exception.
                                   throw err;
                                   tracker.checkForEnd();
                               });
                           }, function(err, _junk) {
                               if(err) {
                                   // Throw an exception to let us know that something went wrong, but also keep going.
                                   setTimeout(notifyLoadListeners, 0);
                                   throw err;
                               }
                               return notifyLoadListeners();
                           });
    }, function(err) {
        setTimeout(notifyLoadListeners, 0);
        throw err;
    });
};
JDeltaDB.DB.prototype.waitForData = function(id, callback) {
    // Convenience function for when you are requesting data from the server (usually with 'reset'), and you want to run a function when the data arrives.
    // Mostly used for testing and hoaky stuff.  If you find yourself using this a lot in your code, you probably need to re-structure your design to use normal 'on'.
    if(!_.isString(id)) throw new Error('non-string id: '+id);
    if(!callback) throw new Error('!callback');
    var self = this;
    var afterData = function() { return callback(id, self); };
    if(this.contains(id)) return afterData();
    else {
        var idRegex = RegExp('^'+JDelta._regexEscape(id)+'$');
        var event = 'all';
        var cb = function(_path, _id, _data) {
            if(_path===null  &&  _data.op==='createState') return;  // There will be no data at this point.
            if(_path===null  &&  _data.op==='reset') {     // Don't log this cuz we know that it is a valid data signal.
            } else console.log('waitForData: received:',_path, _id, _data);  // Comment out this line when we are out of "super-alpha" phase for this function.
            self.off(idRegex, event, cb);
            // We delay the callback to make the internals of these events more transparent to our user.  If we call directly, the user needs to be aware that if they issue any 'edit' command, and we happen to have received a 'reset' event, their 'edit' commands will be dropped because at this point the ID is still in the reset queue.  By delaying the callback, we avoid this intricacy.
            return setTimeout(function(){callback(id, self);}, 0);
        };
        this.on(idRegex, event, cb);
    }
};
JDeltaDB.DB.prototype.on = function(id, event, callback) {
    if(!id) throw new Error('Invalid id!');
    if(event === undefined) throw new Error('Invalid event!');
    if(!callback) throw new Error('Invalid callback!');
    if(_.isRegExp(id)) return this._onRegex(id, event, callback);
    var state = this._getRawState(id);
    var d = state.dispatcher;
    if(!d) d = state.dispatcher = JDelta.Dispatcher();
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
    if(!this._states.hasOwnProperty(id)) throw new Error('No such state: "'+id+'"');
    return this._states[id];
};
JDeltaDB.DB.prototype.getState = function(id) {
    return this._getRawState(id).state;
};
JDeltaDB.DB.prototype.createState = function(id, doNotCreateInStorage, doNotFireEvent) {
    if(this._states.hasOwnProperty(id))
        throw new Error('State already exists: '+id);
    this._states[id] = {state:{}, dispatcher:null};   /// 2012-10-27: moved this line up by 1 line (before the storage create instead of after.  Because i added the 'autoCreate' option for getState, and i was getting 'alreadyExists' errors.
    if(!doNotCreateInStorage) this._storage.createStateSync(id);  // 'doNotCreateInStorage' is useful when loading a storage database and re-creating the equivalent states in the DB.  In this case, the data is already in the storage, so no need to add it again (plus, it would cause an error).
    var i, ii, l;
    for(i=0, ii=this._regexListeners.length; i<ii; i++) {
        l = this._regexListeners[i];
        if(l.idRegex.test(id)) {
            this.on(id, l.event, l.callback);
        }
    }
    // The doNotFireEvent flag is useful from the 'setDeltas' function because we need
    // to be able to create states but not propagate the event to the server.  If I
    // find that I need this event locally I will need to switch to an alternate solution:
    if(!doNotFireEvent) this._trigger(null, id, {op:'createState'});
};
JDeltaDB.DB.prototype.deleteState = function(id, onSuccess, onError) {
    if(!this._states.hasOwnProperty(id)) {
        var err = new Error('State does not exist: '+id);
        if(onError) return onError(err);
        else throw err;
    }
    var self = this;
    this._storage.deleteState(id, function(id) {
        self._trigger(null, id, {op:'deleteState'});  // Must trigger before delete so state is still accessible in handlers.
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
                            self._trigger(null, id, {op:'reset', fromRollback:true});
                            onSuccess && onSuccess(id);
                            return unlock();
                        },
                        function(err){
                            setTimeout(function(){unlock(true)}, 0);
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
    if(this._requireMetaFrom  &&  (!delta.meta  ||  !delta.meta.from)) {
        var err = new Error('You must define meta.from={userID:..., browserID:..., connectionID:...}');
        if(onError) return onError(err);
        throw err;
    }
    this._storage.acquireLock(_alreadyLocked, function(unlock) {
        //console.log('_addHashedDelta: ACQUIRED LOCK:',id);
        var stdOnErr = function(err) {
            setTimeout(function(){unlock(true)}, 0);
            if(onError) return onError(err);
            else throw err;
        };
        self._storage.getLastDelta(id, function(id, lastDelta) {
            var state = self._getRawState(id),
                parentSeq = lastDelta.seq,
                parentHash = lastDelta.curHash;
            if(delta.seq !== parentSeq + 1) return stdOnErr(new Error('invalid sequence! '+delta.seq+' != '+(parentSeq+1)));
            if(delta.parentHash !== parentHash) {
                // NOTE:  Here is how to compare the in-memory data (that the server crashed with) against the on-disk data:
                //     # (Get the tampered state path from the error message (c11f/%2F in this case).)
                //     cd ~/whiteboard_site
                //     node
                //         var JDelta = require('JDelta/JDelta.js').JDelta;
                //         var fs = require('fs');
                //         var str = JDelta.stringify(JDelta.render(null, JSON.parse(fs.readFileSync('/home/whiteboard322/whiteboard_site/db/joins/c11f/%2F'))));
                //         str;   // Copy-paste the result into VIM and compare to the error message data.
                //         JDelta._dsHash(str);
                //         
                // This is occuring rarely, and intermittetently.  Occurred on 2012-08-14 during an edit of the joinDB (which should never have errors because only the server edits it).
                // I have a theory that the state is getting modified/tampered somehow.  I verified that 'parentHash' (derived from lastDelta) is valid, while the 'delta.parentHash' seems invalid.  Hence, my theory about tampered state.
                // 2012-08-15.  This occurred again.  I was able to determine that the join subscription mode was not matching as expected.   On top of that, the subscription mode of one of the items was Silent, but the state was not the global state.  AS far as I know, the Silent state should only really occur in the global state.
                // 2012-08-15.  Occurred when I opened more tabs to the same whiteboard, then closed them, and did a refresh on the final (original) one.  This time, the file had an extra state that the memory did not have.  The delta that triggered the problem was adding a new (different) join connection for the browser that we refreshed.
                // 2012-08-16.  A connection in Memory had a subscription of "sJ+rS" while the disk was "".  Error occurred while creating a different connection.
                // 2012-08-16.  Same as above, except the error occurred while DELETING a different connection.
                // 2012-08-16.  Same as above.
                // 2012-08-17.  Same as above.  (Disk: "", Mem: "sJ+rS", Deleting different connection)
                // ---  Here, I adjusted the logic so that blank subscriptions no longer get placed into non-root join states.
                // 2012-08-21.  The Mem object had an entry that the disk did not.  The operation that triggered this was unrelated.
                // 2012-10-18.  There is a Silent Join in memory that is not on disk, state=join-/.  I have added some logging messages to let me see when files are read and written... to see if the old file is being re-read before new data is written.  ALSO, I moved the location of the 'statesToSave' delete point.  I found a race condition in the save code that could have been causing all this (search for 2012-10-18).  Ya, i think i solved this bug... finally!  :P
                console.log('Tampered state???  (You can compare to the file data of %s)',id);
                console.log(JDelta.stringify(state.state));
                console.log(JDelta._dsHash(JDelta.stringify(state.state)));
                console.log(delta);
                return stdOnErr(new Error('invalid parentHash: '+delta.parentHash+' != '+parentHash));
            }

            JDeltaDB.waitForServerTime(function(serverTimeOffset) {
                if(!delta.meta.hasOwnProperty('date'))
                    delta.meta.date = new Date().getTime() + serverTimeOffset;
                try {
                    JDelta.patch(id, state.state, delta, state.dispatcher);
                    if(JDelta._dsHash(JDelta.stringify(state.state)) !== delta.curHash)
                        throw new Error('invalid curHash!');  // Rollback in the catch.
                } catch(e) {
                    var delayedUnlock = function() { setTimeout(function(){unlock(true)}, 0); };
                    self.rollback(id, parentSeq, delayedUnlock, delayedUnlock, true);  // true = alreadyLocked.
                    if(onError) return onError(e);
                    else throw e;
                }
                self._storage.addDelta(id, delta, function() {
                    self._trigger(null, id, {op:'deltaApplied', delta:delta});
                    onSuccess && onSuccess({id:id, delta:delta, applied:true});
                    //console.log('_addHashedDelta: RELEASING LOCK:',id);
                    return unlock();
                }, stdOnErr);
            });
        }, stdOnErr);
    });
};
JDeltaDB.DB.prototype._addDelta = function(id, delta, onSuccess, onError, _alreadyLocked) {
    var self = this;
    if(this._requireMetaFrom  &&  (!delta.meta  ||  !delta.meta.from)) {
        var err = new Error('You must define meta.from={userID:..., browserID:..., connectionID:...}');
        if(onError) return onError(err);
        throw err;
    }
    this._storage.acquireLock(_alreadyLocked, function(unlock) {
        var stdOnErr = function(err) {
            setTimeout(function() {unlock(true)}, 0);
            if(onError) return onError(err);
            else throw err;
        };

        var state = self._getRawState(id);
        var oldHash = JDelta._dsHash(JDelta.stringify(state.state));
        var newStateCopy = JDelta.patch(id, JDelta._deepCopy(state.state), delta);
        var newHash = JDelta._dsHash(JDelta.stringify(newStateCopy));
        //// 2013-10-28: moved this logic below to make the onSuccess parameters the same in all situations:
        // if(newHash === oldHash) {
        //     // No change.  Let's just pretend this never happend...
        //     onSuccess && onSuccess({id:id, ...});
        //     return unlock();
        // }

        self._storage.getLastDelta(id, function(id, lastDelta) {
            var newSeq = lastDelta.seq + 1;
            var hashedDelta = { steps:delta.steps, meta:delta.meta || {}, parentHash:oldHash, curHash:newHash, seq:newSeq, undoSeq:-newSeq, redoSeq:null };
            var finish = function(result) {
                onSuccess && onSuccess(result);
                return unlock();
            };
            if(newHash === oldHash) return finish({id:id, delta:hashedDelta, applied:false}); // No change.  Let's just pretend this never happend...
            self._addHashedDelta(id, hashedDelta, finish, stdOnErr, true);  // true = alreadyLocked.
        }, stdOnErr);
    });
};
JDeltaDB.DB.prototype.edit = function(id, operations, meta, onSuccess, onError) {
    // Called by the end user with an 'operations' arg like JDelta.create.
    // Can also include an optional 'meta' object to include info about the change, such as date, user, etc.
    var self = this;
    if(this._requireMetaFrom  &&  (!meta  ||  !meta.from)) {
        var err = new Error('You must define meta.from={userID:..., browserID:..., connectionID:...}');
        if(onError) return onError(err);
        throw err;
    }
    this._storage.acquireLock(false, function(unlock) {
        var state = self._getRawState(id);
        var delta = JDelta.create(state.state, operations);
        delta.meta = meta;
        self._addDelta(id, delta, function(result) {
            onSuccess && onSuccess(result);
            return unlock();
        }, function(err) {
            setTimeout(function() {unlock(true)}, 0);
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
            setTimeout(function() {unlock(true)}, 0);
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
                    var newMeta = _.extend(JDelta._deepCopy(postUndoDelta.meta), meta, {operation:'undo', realDate:new Date().getTime() + JDeltaDB.serverTimeOffset});  // 2012-10-23:  I reversed the order of 'meta' and the new data object... I think the user should not normally override those values.
                    var hashedDelta = { steps:undoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postUndoHash, seq:newSeq, undoSeq:postUndoUndoSeq, redoSeq:newRedoSeq };
                    self._addHashedDelta(id, hashedDelta, function(result) {
                        onSuccess && onSuccess(result);
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
            setTimeout(function() {unlock(true)}, 0);
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
                    var newMeta = _.extend(JDelta._deepCopy(postRedoDelta.meta), meta, {operation:'redo', realDate:new Date().getTime() + JDeltaDB.serverTimeOffset});  // 2012-10-23:  I reversed the order of 'meta' and the new data object... I think the user should not normally override those values.
                    var hashedDelta = { steps:redoSteps.steps, meta:newMeta, parentHash:lastDelta.curHash, curHash:postRedoHash, seq:newSeq, undoSeq:newUndoSeq, redoSeq:postRedoRedoSeq };
                    self._addHashedDelta(id, hashedDelta, function(result) {
                        onSuccess && onSuccess(result);
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
JDeltaDB.DB.prototype.getDeltas = function(id, startSeq, endSeq, onSuccess, onError) {
    return this._storage.getDeltas(id, startSeq, endSeq, onSuccess, onError);
};
JDeltaDB.DB.prototype.setDeltas = function(id, deltas, onSuccess, onError) {
    // Added 2012-11-21 to enable server-side prepopulation of items.
    // (We already had StateDBD's setState(), but that didn't help for items
    // that would require editing.
    var self = this,
        i, ii;
    // Create new states:
    if(!this.contains(id)) { this.createState(id, undefined, true); }
    // Delete old deltas so we can start fresh:
    this._storage.deleteState(id, function() {
        // Re-create the storage state:
        self._storage.createStateSync(id);
        // Now add the deltas:
        JDeltaDB._asyncMap(deltas,
                           function(delta, next) {
                               if(delta.seq === 0) return next();  // Skip the pseudo-delta.
                               self._storage.addDelta(id, delta, function() {
                                                          return next();
                                                      }, function(err) {
                                                          if(typeof console !== 'undefined') console.log('setDeltas addDelta Error:', id, err);
                                                          return next(); // Just keep going.
                                                      });
                           }, function(err, _junk) {
                               if(err) throw new Error('This should never happen.');
                               // At this point, we have added all the deltas.  Now trigger rollbacks:
                               self.rollback(id);  // This will trigger the 'reset' event.
                           });
    });
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
    var unlock = function(possibleDoubleUnlock) {
        if(possibleDoubleUnlock) {
            // Double-unlocks can occur in siutaions where we have encountered an error, so we are going to schedule an unlock, and then throw and exception.  In this case, the exception handler may auto-unlock... and then when the delayed unlock gets run, it causes a double-unlock.  This 'possibleDoubleUnlock' parameter allows us to gracefully handle this situation by using it when we schedule the delayed unlock.
            if(self.lockKey !== lockKey) return;
        }
        return self._releaseLock(lockKey);
    };
    try {
        var callback = this._lockQueue.splice(0,1)[0];
        return callback(unlock);
    } catch(e) {
        if(typeof console !== 'undefined') {
            console.log('Exception during Storage Lock callback:', e);
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
    if(key !== this.lockKey) throw new Error('Incorrect LockKey! '+key+' != '+this.lockKey);
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
        var err = new Error("id not found in storage: "+id);
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



JDeltaDB._mkdir_p = function(path, mode, callback) {
    // Recursively create directories, like mkdir -p.
    // The Node Standard Library does not contain this ability, as of 2012-10-27.
    var args = Array.prototype.slice.call(arguments);
    var path = args.shift();
    var callback = args.pop();
    if(!callback) callback = function(){};
    var mode = args.shift();
    var pathPieces = path.split(PATH.sep);
    var totalPath = '';
    var pieceI = 0;
    var next = function(err) {
        //if(err) return callback(err);  // Ignore the errors because we obviously won't be able to create parent directories that exist but we don't have access to.
        if(!pathPieces.length) return callback();
        if(pieceI++) totalPath += PATH.sep;
        totalPath += pathPieces.shift();
        if(totalPath === '') return next();  // If the input path begins with '/', this will occur for the first piece.
        var mkdirArgs = [totalPath];
        if(mode !== undefined) mkdirArgs = mkdirArgs.concat([mode]);
        mkdirArgs = mkdirArgs.concat([next]);
        fs.mkdir.apply(fs, mkdirArgs);
    };
    return next();
};
JDeltaDB._walk = function(path, visit, finish, options) {
    // Walk a directory tree.  Implementation inspired by Python's os.walk and os.path.walk.
    // The 'visit' callback can modify the list of files and directories to control traversal.  (Only makes sense in top-down traversal.)
    options = options || {};
    var bottomUp = options.bottomUp;
    var followLinks = options.followLinks;
    var onError = options.onError || function(operation, err) {};
    var statFunc = followLinks ? fs.stat : fs.lstat;
    var itemSort = function(a,b) {
        if(a.item > b.item) return 1;
        if(a.item < b.item) return -1;
        return 0;
    };
    var next = function(path, finish) {
        fs.readdir(path, function(err, list) {
            if(err) {
                err = onError(err);
                if(err) return finish(err);  // onError told us to abort.
                return finish();   // Keep going.
            }
            var dirs = [];
            var files = [];
            var links = [];  //  Items will only be put here if !options.followLinks.
            var errs = [];
            JDeltaDB._asyncMap(list,
                               function(item, next) {
                                   statFunc(path+PATH.sep+item, function(err, stats) {
                                       if(err) errs[errs.length] = {item:item, stats:stats, err:err};  // Don't halt the whole process just because of one error.
                                       else if(stats.isDirectory()) dirs[dirs.length] = {item:item, stats:stats};
                                       else if(!followLinks  &&  stats.isSymbolicLink()) links[links.length] = {item:item, stats:stats};
                                       else files[files.length] = {item:item, stats:stats};  // Consider devices, fifos, sockets, etc as files.
                                       return next();
                                   });
                               }, function(err, _junk) {
                                   if(err) {
                                       err = onError(err);
                                       if(err) return finish(err);
                                   }
                                   dirs.sort(itemSort);
                                   files.sort(itemSort);
                                   links.sort(itemSort);
                                   errs.sort(itemSort);
                                   var dirChain = function(finish) {
                                           var chain = [],
                                               i, ii;
                                           for(i=0, ii=dirs.length; i<ii; i++) {
                                               if(!dirs[i]) continue;      // The 'visit' func removed this item.
                                               if(!dirs[i].item) continue; // ^^^
                                               chain[chain.length] = [ next, path+PATH.sep+dirs[i].item ];
                                           }
                                           JDeltaDB._chain(chain, function(err, _junk) {
                                               if(err) {
                                                   err = onError(err);
                                                   if(err) return finish(err);  // The onError handler told us to abort.
                                               }
                                               return finish();  // Keep going.
                                           });
                                   };
                                   if(!bottomUp) {
                                       // Use top-down traversal.
                                       var afterVisit = function(err) {
                                           if(err) return finish(err);
                                           return dirChain(function(err, _junk) { return finish(err); });
                                       };
                                       return visit(afterVisit, path, files, dirs, links, errs, options);
                                   } else {
                                       // Use bottom-up traversal.
                                       return dirChain(function(err, _junk) {
                                           if(err) return finish(err);
                                           visit(finish, path, files, dirs, links, errs, options);
                                       });
                                   }
                               });
        });
    };
    return next(path, finish || function(){});
};

JDeltaDB._DirStorage_Constructor = function(dirpath) {
    if(!PATH.existsSync(dirpath)) throw new Error('Dir does not exist: '+dirpath);
    this.__dirpath = PATH.resolve(dirpath);
    this.creationMode = '0750';   // Must use a string because literal ocals are forbidden in JS strict mode.
    this.__statesCurrentlyInRam = {};
    this.__statesToSave = {};
    this.__stateAccessTimes = {};
    this.__stateIdleTime = 600000;
    this.save = _.debounce(_.bind(this._rawSave, this), 1000);
    this.removeStatesInterval = setInterval(_.bind(this.__removeInactiveStatesFromRam, this), 10000);
};
JDeltaDB.DirStorage = function(dirpath) {
    if(!(this instanceof JDeltaDB.DirStorage)) return new JDeltaDB.DirStorage(dirpath);
    JDeltaDB._DirStorage_Constructor.call(this, dirpath);
};
JDeltaDB.DirStorage.prototype.acquireLock = JDeltaDB.RamStorage.prototype.acquireLock;
JDeltaDB.DirStorage.prototype._nextLockCB = JDeltaDB.RamStorage.prototype._nextLockCB;
JDeltaDB.DirStorage.prototype._releaseLock = JDeltaDB.RamStorage.prototype._releaseLock;
JDeltaDB.DirStorage.prototype.__idToFilepath = function(id) {
    if(id === '/') {
        // Special handling for /.
        return this.__dirpath + PATH.sep + encodeURIComponent('/') + '.json';  //  "/" --> "%2F"
    }
    if(!_.isString(id)) throw new Error('Non-string id!');
    if(!id.length) throw new Error('Blank id!');
    if(id.charAt(0) !== '/') throw new Error('id must begin with /');
    if(id.charAt(id.length-1) === '/') throw new Error('id may not end with /');
    if(id.indexOf('//') !== -1) throw new Error('Found //');
    var encodedPieces = _.map(id.split('/'), function(piece) {
        return encodeURIComponent(piece).replace(/\./g, '%2E');    // Also encode '.' to avoid the '.' and '..' filenames.
    });
    var encodedPath = encodedPieces.join(PATH.sep);
    if(encodedPath.charAt(0) !== PATH.sep) throw new Error('This should not happen.');
    return this.__dirpath + encodedPath + '.json';
};
JDeltaDB.DirStorage.prototype.__filepathToID = function(filepath) {
    if(filepath === this.__dirpath + PATH.sep + encodeURIComponent('/') + '.json') {
        // Special handling for /.
        return '/';
    }
    if(filepath.lastIndexOf(this.__dirpath, 0) !== 0) throw new Error('filepath does not start with __dirpath!');
    if(filepath.charAt(this.__dirpath.length) !== PATH.sep) throw new Error("Expected path separator.");
    if(filepath.indexOf('.json', filepath.length-5) === -1) throw new Error('Expected .json extension.');
    filepath = filepath.substring(0, filepath.length-5);  // Chop off the .json
    var encodedPath = filepath.substr(this.__dirpath.length);
    var decodedPieces = _.map(encodedPath.split(PATH.sep), function(piece) {
        return decodeURIComponent(piece);
    });
    var id = decodedPieces.join('/');
    if(id.charAt(0) !== '/') throw new Error('Expected /');
    if(id.charAt(id.length-1) === '/') throw new Error('Illegal /');
    return id;
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
    JDeltaDB._mkdir_p(dirpath, parseInt(this.creationMode, 8), function(err) {  // I need to use parseInt because literal octals are forbidden in JS strict mode.
        if(err  &&  err.code !== 'EEXIST') return onError(err);
        fs.writeFile(newFilepath, dataStr, 'utf8', function(err) {
            if(err) return onError(err);
            fs.rename(newFilepath, filepath, function(err) {
                if(err) return onError(err);
                console.log('Wrote:', filepath);
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
        console.log('Scheduled Save and Removal of:',id);
        delete self.__statesToSave[id];  // 2012-10-18:  moved here so that if any edits are made during the save, they will get an additional save.
        self.__rawSaveState(id, function() {
            // delete self.__statesToSave[id];  // 2012-10-18: commented this out and moved it up above.  My theory is that this is the cause of the tamper-data race condition.
            return saveNextState();
        }, function(err) {
            self.__statesToSave[id] = true;  // Re-schedule.
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
    var self = this,
        ids = [];
    JDeltaDB._walk(this.__dirpath, function(next, path, files, dires, links, errs, options) {
        var i, ii, f;
        for(i=0, ii=files.length; i<ii; i++) {
            f = files[i].item;
            if(f.indexOf('.json', f.length-5) === -1) continue;
            ids[ids.length] = self.__filepathToID(path+PATH.sep+f);
        }
        next();
    }, function(err) {
        if(err) {
            if(onError) return onError();
            throw err;
        }
        ids.sort();
        return onSuccess(ids);
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




JDeltaDB.HashedDirStorage = function(dirpath) {
    if(!(this instanceof JDeltaDB.HashedDirStorage)) return new JDeltaDB.HashedDirStorage(dirpath);
    this.__hashPieceLen = 4;
    JDeltaDB._DirStorage_Constructor.call(this, dirpath);
};
_.extend(JDeltaDB.HashedDirStorage.prototype, JDeltaDB.DirStorage.prototype);
JDeltaDB.HashedDirStorage.prototype.__idToFilepath = function(id) {
    if(!_.isString(id)) throw new Error('Non-string id!');
    if(!id.length) throw new Error('Blank id!');
    var encodedID = encodeURIComponent(id);
    encodedID = encodedID.replace(/\./g, '%2E');  // Also encode '.' to avoid the '.' and '..' filenames.
    var hash = JDelta._dsHash(encodedID);
    if(hash.length !== 10) throw new Error('Unexpected hash length!' + hash);
    var hashPiece = hash.substring(10-this.__hashPieceLen,10);
    return this.__dirpath + PATH.sep + hashPiece + PATH.sep + encodedID + '.json';
};
JDeltaDB.HashedDirStorage.prototype.__filepathToID = function(filepath) {
    if(filepath.lastIndexOf(this.__dirpath, 0) !== 0) throw new Error('filepath does not start with __dirpath!');
    if(filepath.charAt(this.__dirpath.length) !== PATH.sep) throw new Error("Expected path separator.");
    if(filepath.indexOf('.json', filepath.length-5) === -1) throw new Error('Expected .json extension.');
    filepath = filepath.substring(0, filepath.length-5);  // Chop off the .json
    var hashPiece = filepath.substr(this.__dirpath.length+1, this.__hashPieceLen);
    if(filepath.charAt(this.__dirpath.length+1+this.__hashPieceLen) !== PATH.sep) throw new Error("Expected path separator.");
    var encodedID = filepath.substring(this.__dirpath.length+2+this.__hashPieceLen);
    var hash = JDelta._dsHash(encodedID);
    if(hash.substring(10-this.__hashPieceLen,10) !== hashPiece) throw new Error('hashPiece did not match!');
    return decodeURIComponent(encodedID);
};
JDeltaDB.HashedDirStorage.prototype.listIDs = function(onSuccess, onError) {
    // Our hash-based dir names and 2-layer dir structure allows us to use an optimized listing algorithm:
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
        JDeltaDB._asyncMap(hashDirs,
                           function(hashDir, next) {
                               fs.readdir(self.__dirpath+PATH.sep+hashDir, function(err, files) {
                                   if(err) return next(err);
                                   var f, j, jj;
                                   for(j=0, jj=files.length; j<jj; j++) {
                                       f = files[j];
                                       if(f.indexOf('.json', f.length-5) === -1) continue;
                                       ids[ids.length] = self.__filepathToID(self.__dirpath+PATH.sep+hashDir+PATH.sep+f);
                                   }
                                   return next();
                               });
                           },
                           function(err, _junk) {
                               if(err) {
                                   if(onError) return onError(err);
                                   throw err;
                               }
                               ids.sort();
                               return onSuccess(ids);
                           });
    });
};










// Like a "Stunt Double", but for database states:
// Useful for pre-loading server-rendered data for super-fast page loads.
// In other words, allows you to pre-load rendered states without the overhead of their deltas.
// The deltas can then be fetched when they are really needed (for edit/delta operations) ... all transparently to your app code.
var MATCH_ALL_REGEX = /.*/;
var ALL = 'all';
JDeltaDB.DBDouble = function(db, syncClient) {
    if(!(this instanceof JDeltaDB.DBDouble)) return new JDeltaDB.DBDouble(db, syncClient);
    this._states = {};
    this._regexListeners = [];
    this._boundEventHandler = _.bind(this._eventHandler, this);
    this.setDB(db);
    this._syncClient = syncClient;  // The syncClient is only necessary for auto-fetch operations.
};
var FROM_DB = {};
JDeltaDB.DBDouble.prototype._eventHandler = function(path, id, data) {
    if(path===null  && data.op==='createState') {
        if(this._states.hasOwnProperty(id)) {
            this.setState(id, FROM_DB, true);   // Don't fire the event to prevent flicker, since a reset is likely to come right after this, and we already had data.
        } else {
            this.setState(id, FROM_DB, true);
            this._trigger(path, id, data);  // There was no previous data, so fire away.
        }
    } else if(path===null  &&  data.op==='deleteState') {
        this._trigger(path, id, data);  // Must trigger before delete!  (Otherwise getRawState will auto-create it again during the trigger.)
        this.deleteState(id, true);
    } else if(path===null  &&  data.op==='reset') {
        this.setState(id, FROM_DB, true);
        this._trigger(path, id, data);
    } else if(_.isArray(path)) {
        this.setState(id, FROM_DB, true);
        this._trigger(path, id, data);
    } else if(path===null  &&  data.op==='deltaApplied') {
        this.setState(id, FROM_DB, true);
        this._trigger(path, id, data);
    } else {
        console.log('Unknown DBDouble Event:',path, id, data, this._db._states[id], this);
    }
};
JDeltaDB.DBDouble.prototype.setDB = function(db) {
    if(this._db) {
        this._db.off(MATCH_ALL_REGEX, ALL, this._boundEventHandler);
    }
    this._db = db;
    this._db.on(MATCH_ALL_REGEX, ALL, this._boundEventHandler);
};
JDeltaDB.DBDouble.prototype.setState = function(id, data, silent) {
    if(!id) throw new Error('!id');
    if(!data) throw new Error('!data');
    var isCreate = true,
        isReset = true;
    if(data === FROM_DB) {
        data = this._db.getState(id);
    } else if(this._db.contains(id)) {
        if(this._db.getState(id) !== data) throw new Error('Different item already exists in DB:', id);
        isReset = false;
    }
    if(this._states.hasOwnProperty(id)) {
        isCreate = false;
        this._states[id].state = data;
    } else {
        this._states[id] = {state:data, dispatcher:null};
        var i, ii, l;
        for(i=0, ii=this._regexListeners.length; i<ii; i++) {
            l = this._regexListeners[i];
            if(l.idRegex.test(id)) {
                this.on(id, l.event, l.callback);
            }
        }
    }
    if(!silent) {
        if(isCreate) this._trigger(null, id, {op:'createState'});
        if(isReset) this._trigger(null, id, {op:'reset'});
    }
};
JDeltaDB.DBDouble.prototype.deleteState = function(id, silent) {
    // 2013-10-24: I implemented this function after being away from JDelta for about a year, so there might be some problems with my logic.
    if(!id) throw new Error('!id');
    if(!this._states.hasOwnProperty(id)) throw new Error('Trying to delete non-existent DBDouble state:', id);
    if(!silent) {
        this._trigger(null, id, {op:'deleteState'});
    }
    // Need to delete the state AFTER triggering the event to be consisten with the DB behavior.
    // Do I need to un-register listeners?  How can I even know which listeners to un-register?  (Regex matches are an unreliable test.)
    delete this._states[id];
};
JDeltaDB.DBDouble.prototype._getRawState = function(id) {
    if(!this._states.hasOwnProperty(id)) {
        if(this._db.contains(id)) {
            this.setState(id, FROM_DB, true);
        } else {
            throw new Error('No such state: '+id);
        }
    }
    var s = this._states[id];
    if(!s) throw new Error('This should never happen.');
    return s;
};
JDeltaDB.DBDouble.prototype.getState = JDeltaDB.DB.prototype.getState;
JDeltaDB.DBDouble.prototype.on = JDeltaDB.DB.prototype.on;
JDeltaDB.DBDouble.prototype.off = JDeltaDB.DB.prototype.off;
JDeltaDB.DBDouble.prototype._onRegex = JDeltaDB.DB.prototype._onRegex;
JDeltaDB.DBDouble.prototype._offRegex = JDeltaDB.DB.prototype._offRegex;
JDeltaDB.DBDouble.prototype._trigger = JDeltaDB.DB.prototype._trigger;
JDeltaDB.DBDouble.prototype.listStates = function() {
    var states = this._db.listStates();
    var statesMap = {},
        i, ii, id;
    for(i=0, ii=states.length; i<ii; i++) statesMap[states[i]] = true;
    for(id in this._states) if(this._states.hasOwnProperty(id)) {
        if(!statesMap.hasOwnProperty(id)) {
            states[states.length] = id;
        }
    }
    states.sort();
    return states;
};
JDeltaDB.DBDouble.prototype.iterStates = JDeltaDB.DB.prototype.iterStates;
JDeltaDB.DBDouble.prototype.contains = function(id) {
    return this._db.contains(id)  ||  this._states.hasOwnProperty(id);
};
JDeltaDB.DBDouble.prototype.getDeltas = function(id, startSeq, endSeq, onSuccess, onError) {
    var self = this;
    var afterData = function() {
        return self._db.getDeltas(id, startSeq, endSeq, onSuccess, onError);
    };
    if(this._db.contains(id)) return afterData();
    var dbType = null;
    if(this._db === this._syncClient.stateDB) dbType = 'state';
    else if(this._db === this._syncClient.joinDB) dbType = 'join';
    else throw new Error('Could not find dbType.');
    //if(typeof console !== 'undefined') console.log('Auto-Fetching:', id);
    this._syncClient.reset(dbType, id);
    this._db.waitForData(id, afterData);
};



















///// 2012-10-23:  I decided to transition over to the SLIDE Async Flow Control lib:
// 
// JDeltaDB._AsyncTracker = function(onSuccess) {  // Especially useful for tracking parallel async actions.
//     if(!(this instanceof JDeltaDB._AsyncTracker)) return new JDeltaDB._AsyncTracker(onSuccess);
//     if(!onSuccess) throw new Error('You must provide an onSuccess function.');
//     this.thereWasAnError = false;
//     this.numOfPendingCallbacks = 1;  // You need to make an additional call to checkForEnd() after the iteration.
//     this._onSuccess = onSuccess;
//     this._onSuccessAlreadyCalled = false;
// };
// JDeltaDB._AsyncTracker.prototype.checkForEnd = function() {
//     this.numOfPendingCallbacks--;
//     if(this.thereWasAnError) return;
//     if(this.numOfPendingCallbacks < 0) throw new Error('This should never happen');
//     if(!this.numOfPendingCallbacks) {
//         if(this._onSuccessAlreadyCalled) throw new Error('This should never happen');
//         this._onSuccessAlreadyCalled = true;
//         this._onSuccess();
//     }
// };
// JDeltaDB._runAsyncChain = function(chain, onSuccess, onError) {
//     var i=-1;
//     if(!_.isArray(chain)) throw new Error("Expected 'chain' to be an Array.");
//     onSuccess = onSuccess || function(){};
//     onError = onError || function(err) { throw err };
//     var next = function() {
//         i += 1;
//         if(i>chain.length) throw new Error('i>chain.length!'); // Should never happen.
//         if(i==chain.length) {
//             return onSuccess();
//         }
//         chain[i](next, onError);
//     };
//     return next();
// };



////////////////////////////////////////////////////
/////////////////             //////////////////////
/////////////////  S L I D E  //////////////////////
/////////////////             //////////////////////
///                                              ///
/// https://github.com/isaacs/slide-flow-control ///
///                                              ///
/// Modified to run in web browsers back to IE6. ///
///                                              ///
////////////////////////////////////////////////////

// Used from chain and asyncMap like this:
// var log = _.bind(console.log, console);
// var add = function(a,b,next) {next(null, a+b)};
// var obj = {add:add};
// JDeltaDB._bindActor(add,1,2)(log);       //  null, 3
// JDeltaDB._bindActor(obj,'add',1,2)(log); //  null, 3
JDeltaDB._bindActor = function() {
  var args = Array.prototype.slice.call(arguments) // jswtf.
    , obj = null
    , fn;
  if(typeof args[0] === "object") {
    obj = args.shift();
    fn = args.shift();
    if (typeof fn === "string") fn = obj[ fn ];
  } else fn = args.shift();
  return function (cb) { fn.apply(obj, args.concat(cb)); };
};

// Able to run async functions in series:
// var mul = function(a,b,next) {next(null, a*b)};
// var first = JDeltaDB._first;
// var last = JDeltaDB._last;
// JDeltaDB._chain( [ [mul, 2, 3],
//                    [obj, 'add', 1, last],
//                    [obj, 'add', first, last]
//                  ], log);                     //  null [6, 7, 13]
JDeltaDB._first = {};
JDeltaDB._first0 = {};
JDeltaDB._last = {};
JDeltaDB._last0 = {};
JDeltaDB._chain = function(things, cb) {
  cb = cb || function(){};                              ////////   Added by Christopher Sebastian.
  var res = [];
  (function LOOP(i, len) {
    if(i >= len) return cb(null,res);
    if(_.isArray(things[i])) things[i] = JDeltaDB._bindActor.apply(null, _.map(things[i], function(i){
                                                                                          return (i===JDeltaDB._first)  ? res[0] :
                                                                                                 (i===JDeltaDB._first0) ? res[0][0] :
                                                                                                 (i===JDeltaDB._last)   ? res[res.length - 1] :
                                                                                                 (i===JDeltaDB._last0)  ? res[res.length - 1][0] :
                                                                                                 i; }));
    if(!things[i]) return LOOP(i + 1, len);
    things[i](function (er, data) {
      if(er) return cb(er, res);
      //if(data !== undefined) res = res.concat(data);   /////////  Commented by Christopher Sebastian.  I disagree with the use of 'concat' to collect results.  I think it should be an append instead.
      if(data !== undefined) res[res.length] = data;     /////////  Added by Christopher Sebastian.
      LOOP(i + 1, len);
    });
  })(0, things.length);
};

// Runs tasks in parallel:
// JDeltaDB._asyncMap(['/', '/ComingSoon'],
//                    function(url,cb) {jQuery.ajax({url:url, success:function(data){cb(null,data)}})}, 
//                    log);      //  null [...datas from the 2 pages (in whatever order they were received)...]
//
// JDeltaDB._asyncMap([1,2,3],
//                    function(x, next) {next(null, x*3,x*2,x*1)},
//                    function(err, res1, res2, res3) {console.log(err, res1, res2, res3)});  //   null [3, 6, 9] [2, 4, 6] [1, 2, 3]
//
JDeltaDB._asyncMap = function() {
  var steps = Array.prototype.slice.call(arguments)
    , list = steps.shift() || []
    , cb_ = steps.pop();
  if(typeof cb_ !== "function") throw new Error("No callback provided to asyncMap");
  if(!list) return cb_(null, []);
  if(!_.isArray(list)) list = [list];
  var n = steps.length
    , data = [] // 2d array
    , errState = null
    , l = list.length
    , a = l * n;
  if(!a) return cb_(null, []);
  function cb(er) {
    if(errState) return;
    var argLen = arguments.length;
    for(var i=1; i<argLen; i++) if(arguments[i] !== undefined) {
      data[i-1] = (data[i-1] || []).concat(arguments[i]);
    }
    // see if any new things have been added.
    if(list.length > l) {
      var newList = list.slice(l);
      a += (list.length - l) * n;
      l = list.length;
      process.nextTick(function() {
        _.each(newList, function(ar) {
          _.each(steps, function(fn) { fn(ar,cb); });
        });
      });
    }
    if(er || --a === 0) {
      errState = er;
      cb_.apply(null, [errState].concat(data));
    }
  };
  // expect the supplied cb function to be called
  // "n" times for each thing in the array.
  _.each(list, function(ar) {
    _.each(steps, function(fn) { fn(ar,cb); });
  });
};




// Cache results so future requests can be de-duplicated.
// var dedup = JDeltaDB._asyncMemoize(add, function(a,b){return ''+a+':'+b});
// dedup(1, 2, log);  // First time, add gets called.
// dedup(1, 2, log);  // Result comes from cache.
JDeltaDB._asyncMemoize = function(func, hashFunc, hasOnError) {
    hashFunc = hashFunc || function(x) { return x; };
    var seen = {};
    return function() {
        var args = Array.prototype.slice.call(arguments);
        var hash = hashFunc.apply(null, args);
        var onSuccess, onError;
        if(hasOnError) {
            onError = args.pop();
            onSuccess = args.pop();
        } else onSuccess = args.pop();
        var results = seen[hash];
        if(results) {
            //console.log('MEMOED!', hash);
            return onSuccess.apply(null, results);
        }
        var totalArgs = args.concat([function() {
            results = Array.prototype.slice.call(arguments);
            seen[hash] = results;
            //console.log('CALLED.', hash);
            return onSuccess.apply(null, results);
        }]);
        if(hasOnError) totalArgs = totalArgs.concat([onError]);
        func.apply(null, totalArgs);
    };
};

// Only allow one call to occur at a time.  Additional calls will be discarded.
// Useful for expensive functions that you don't want to "stack" if called rapidly.
// var single = JDeltaDB._asyncOneAtATime(function(a,b,next){ setTimeout(function(){next(a,b)}, 3000) });
// single(1,2,log);  single(3,4,log);   // Only "1 2" will be printed.
JDeltaDB._asyncOneAtATime = function(func, hasOnError) {
    var running = false;
    return function() {
        var args = Array.prototype.slice.call(arguments);
        if(running) {
            //console.log('already running.');
            return;
        }
        //console.log('RUNNING.');
        running = true;
        var onSuccess, onError;
        if(hasOnError) {
            onError = args.pop();
            onSuccess = args.pop();
        } else onSuccess = args.pop();
        var totalArgs = args.concat([function() {
            var results = Array.prototype.slice.call(arguments);
            running = false;
            onSuccess && onSuccess.apply(null, results);
        }]);
        if(hasOnError) totalArgs = totalArgs.concat([function() {
            var results = Array.prototype.slice.call(arguments);
            running = false;
            onError && onError.apply(null, results);
        }]);
        func.apply(null, totalArgs);
    };
};








//// 2013-10-14: I find that I need these in all my webapps:
var jdID_to_htmlID = function(jdID) { return jdID.replace(/\//g, "_"); };
var htmlID_to_jdID = function(htmlID) { return htmlID.replace(/_/g, '/'); };

JDeltaDB.id_split = function(jdID) {
    // '/a/b/c' --> ['a', 'b', 'c']
    if(jdID.charAt(0) !== '/') throw new Error('Expected absolute path!');
    return jdID.split('/').slice(1);  // the first element will be "".
};
JDeltaDB.id_join = function(pieces) {
    // ['a', 'b', 'c'] ==> '/a/b/c'
    return [''].concat(pieces).join('/');
}
JDeltaDB.id_basename = function(jdID) {
    // Just a convenience function to help me remember how to do this.
    // '/a/b/c' --> 'c'
    return _.last(JDeltaDB.id_split(jdID));
};






})( (typeof window !== 'undefined') ? window : global );
