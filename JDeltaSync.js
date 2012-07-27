//  JDelta - Realtime Delta Distribution
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


(function() {
"use strict";

// First, install ourselves and import our dependencies:
var JDeltaSync = {},
    JDeltaDB,
    JDelta,
    jQuery,  // Browser only.
    URL,     // Server only.
    _;
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.JDeltaSync = JDeltaSync;
    JDeltaDB = require('./JDeltaDB.js').JDeltaDB;
    JDelta = require('./JDelta.js').JDelta;
    _ = require('underscore');
    URL = require('url');
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.JDeltaSync = JDeltaSync;
    JDeltaDB = window.JDeltaDB;
    JDelta = window.JDelta;
    _ = window._;
    jQuery = window.jQuery  ||  window.$;
} else throw new Error('This environment is not yet supported.');

JDeltaSync.VERSION = '0.1.0a';


JDeltaSync._generateMsgID = function() {
    var hexStr = Math.floor(Math.random()*0xffffffff).toString(16);
    while(hexStr.length < 8) hexStr = '0'+hexStr;
    return '0x' + hexStr;
};
JDeltaSync.Client = function(db, url) {
    // Guard against forgetting the 'new' operator:
    if(!(this instanceof JDeltaSync.Client))
        return new JDeltaSync.Client(db, url);
    if(!url)
        throw new Error('You must provide a base url.');
    this._url = url;
    this._sendQueue = [];
    this._resetQueue = {};
    this._MATCH_ALL_REGEX = /.*/;
    this._MAX_SEND_BUNDLE_BYTES = 100*1024;
    this._dbEventCallback = _.bind(JDeltaSync.Client.prototype._addToSendQueue, this);
    this._setDB(db);
    this._sending = false;
    this._doSend = _.debounce(_.bind(JDeltaSync.Client.prototype._rawDoSend, this), 10);
};
JDeltaSync.Client.prototype._setDB = function(db) {
    if(this._db) {
        this._db.off(this._MATCH_ALL_REGEX, '!', this._dbEventCallback);
        // Do i need to clear the send/reset queues?
        throw new Error('unregistration of old DB is not fully implemented yet.');
    }
    this._db = db;
    db.on(this._MATCH_ALL_REGEX, '!', this._dbEventCallback);
};
JDeltaSync.Client.prototype._triggerSend = function() {
    if(!this._sending)
        this._doSend();
};
JDeltaSync.Client.prototype._rawDoSend = function() {
    var self = this;
    if(!this._sendQueue.length) return;  // Nothing to send.
    if(this._sending) return;            // Already sending.
    this._sending = true;
    var bundle = [],
        bundleBytes = 0,
        i, ii;
    for(i=0, ii=this._sendQueue.length; i<ii; i++) {
        bundle[bundle.length] = this._sendQueue[i];
        bundleBytes += JSON.stringify(this._sendQueue[i]).length;  // Not really bytes... but, whatever.
        if(bundleBytes > this._MAX_SEND_BUNDLE_BYTES) break;
    }
    jQuery.ajax({
        url:this._url+'/clientSend',
        type:'POST',
        data:{bundle:JSON.stringify(bundle)},
        dataType:'json',
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data))
                throw new Error('Expected array from server!');
            var needToReset = {};
            while(data.length) {
                if(data[0].msgID !== self._sendQueue[0].msgID)
                    throw new Error('msgID did not match!');
                switch(data[0].result) {

                    case 'ok':
                        self._sendQueue.splice(0, 1);
                        data.splice(0, 1);
                        break;

                    case 'fail':
                        needToReset[self._sendQueue[0].id] = true;
                        self._sendQueue.splice(0, 1);
                        data.splice(0, 1);
                        break;

                    default:
                        throw new Error('Unknown result: '+result);
                }
            }
            var id;
            for(id in needToReset) if(needToReset.hasOwnProperty(id)) {
                self._addToResetQueue(id);
            }
        },
        error:function(jqXHR, retCodeStr, exceptionObj) {
            // Receiving exceptionObj = 'Service Unavailable'.
            throw exceptionObj;
        },
        complete:function(jqXHR, retCodeStr) {
            self._sending = false;
            if(self._sendQueue.length) {
                setTimeout(_.bind(JDeltaSync.Client.prototype._rawDoSend, self), 1);
            }
        }
    });
};
JDeltaSync.Client.prototype._startResetQueueWorker = function() {
};
JDeltaSync.Client.prototype._startReceiveWorker = function() {
};
JDeltaSync.Client.prototype._addToResetQueue = function(id) {
    this._resetQueue[id] = true;
    // Clear from send queue:
    for(var i=this._sendQueue.length-1; i>=0; i--) {
        if(this._sendQueue[i].id === id)
            this._sendQueue.splice(i, 1);
    }
};
JDeltaSync.Client.prototype._addToSendQueue = function(id, data) {
    if(this._resetQueue.hasOwnProperty(id)) return;  // Drop the item cuz we're going to reset anyway.
    this._sendQueue[this._sendQueue.length] = {msgID:JDeltaSync._generateMsgID(), id:id, data:data};
    this._triggerSend();
};
JDeltaSync.Client.prototype.listStates = function(ids, onSuccess, onError) {
    // Fetches state infos from server.  Does *not* use/affect the queue.
    if(_.isRegExp(ids))
        return this._listStatesRegex(ids, onSuccess, onError);
    if(!_.isArray(ids)) {
        var err = new Error("'ids' should be an array of strings or a regex.");
        if(onError) return onError(err);
        else throw err;
    }
    if(!ids.length)
        return onSuccess([]);
    jQuery.ajax({
        url:this._url+'/query?cmd=listStates&ids='+JSON.stringify(ids),
        type:'GET',
        dataType:'json',
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data)) {
                var err = new Error('Expected array from server!');
                if(onError) return onError(err);
                else throw err;
            }
            onSuccess(data);
        },
        error:function(jqXHR, retCodeStr, exceptionObj) {
            if(onError) return onError(exceptionObj);
            else throw exceptionObj;
        }


        //success:function(data, retCodeStr, jqXHR) {
        //    console.log('SUCCESS:', data, retCodeStr, jqXHR);
        //},
        //error:function(jqXHR, retCodeStr, exceptionObj) {
        //    console.log('ERROR:', jqXHR, errType, exceptionObj);
        //},
        //complete:function(jqXHR, retCodeStr) {
        //    console.log('COMPLETE:', jqXHR, retCodeStr);
        //}
    });
};
JDeltaSync.Client.prototype._listStatesRegex = function(idRegex, onSuccess, onError) {
    var regexStr = idRegex.toString();
    jQuery.ajax({
        url:this._url+'/query?cmd=listStatesRegex&ids='+regexStr,
        type:'GET',
        dataType:'json',
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data)) {
                var err = new Error('Expected array from server!');
                if(onError) return onError(err);
                else throw err;
            }
            onSuccess(data);
        },
        error:function(jqXHR, retCodeStr, exceptionObj) {
            if(onError) return onError(exceptionObj);
            else throw exceptionObj;
        }
    });
};
JDeltaSync.Client.prototype.fetchDeltas = function(items, onSuccess, onError) {
    // Fetches state deltas from server.  Does *not* use/affect the queue.
    // items = [{id:'a', startSeq:3, endSeq:5},  // Using a query structure like this allows us to minimize # of SQL queries that we need to perform.
    //          {id:'b', seq:9}];                //
    if(!_.isArray(items)) {
        var err = new Error("'items' should be an array of DeltaRange objects.");
        if(onError) return onError(err);
        else throw err;
    }
    if(!items.length)
        return onSucceess([]);
    jQuery.ajax({
        url:this._url+'/query?cmd=fetchDeltas&items='+JSON.stringify(items),
        type:'GET',
        dataType:'json',
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data)) {
                var err = new Error('Expected array from server!');
                if(onError) return onError(err);
                else throw err;
            }
            onSuccess(data);
        },
        error:function(jqXHR, retCodeStr, exceptionObj) {
            if(onError) return onError(exceptionObj);
            else throw exceptionObj;
        }
    });

    //onSuccess([{id:'a', delta:{seq:3, curHash:'A', steps:[]}},
    //           {id:'a', delta:{seq:4, curHash:'B', steps:[]}},
    //           {id:'a', delta:{seq:5, curHash:'C', steps:[]}},
    //           {id:'b', delta:{seq:9, curHash:'X', steps:[]}}]);
};



JDeltaSync.sebwebHandler_clientSend = function(syncServer) {
    var sebweb = require('sebweb');
    return sebweb.PostParser(function(req, res, onSuccess, onError) {
        var bundleArray = req.formidable_form.fields.bundle;
        if(!_.isArray(bundleArray)) {
            var err = new Error('No Bundle!');
            if(onError) return onError(err);
            else throw err;
        }
        if(bundleArray.length !== 1) {
            var err = new Error('Wrong Bundle Length!');
            if(onError) return onError(err);
            else throw err;
        }
        var bundleStr = bundleArray[0];
        if(!bundleStr) {
            var err = new Error('Blank Bundle!');
            if(onError) return onError(err);
            else throw err;
        }
        if(bundleStr.charAt(0) !== '['  ||  bundleStr.charAt(bundleStr.length-1) !== ']') {
            var err = new Error('Bundle missing [] chars!');
            if(onError) return onError(err);
            else throw err;
        }
        var bundle = JSON.parse(bundleStr),
            result = [],
            i, ii;
        for(i=0, ii=bundle.length; i<ii; i++) {
            result[result.length] = {msgID:bundle[i].msgID, result:'ok'};
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.end(JSON.stringify(result));
        onSuccess();
    });
};
JDeltaSync.sebwebHandler_query = function(syncServer) {
    return function(req, res, onSuccess, onError) {
        var standardOnSuccess = function(result) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.end(JSON.stringify(result));
            onSuccess();
        };
        var url = URL.parse(req.url, true);
        switch(url.query.cmd) {

            case 'listStates':
                var idsStr = url.query.ids;
                if(!_.isString(idsStr))
                    return onError('Illegal ids');
                if(!idsStr.length)
                    return onError('Blank ids');
                if(idsStr.charAt(0)!=='['  ||  idsStr.charAt(idsStr.length-1)!==']')
                    return onError('ids missing [] chars: '+idsStr);
                var ids = JSON.parse(idsStr);
                syncServer.listStates(ids, standardOnSuccess, onError);
                break;

            case 'listStatesRegex':
                var idRegexStr = url.query.idRegex;
                if(!_.isString(idRegexStr))
                    return onError('Illegal idRegex');
                if(!idRegexStr.length)
                    return onError('Blank idRegex');
                if(idRegexStr.charAt(0)!=='/'  ||  idRegexStr.charAt(1)!=='^'  ||  idRegexStr.charAt(idRegexStr.length-2)!=='$'  ||  idRegexStr.charAt(idRegexStr.length-1)!=='/')
                    return onError('idRegex missing /^...$/ chars: '+idRegexStr);
                idRegexStr = idRegexStr.substring(1, idRegexStr.length-1); // Chop off the surrounding '/' chars.
                var idRegex = RegExp(idRegexStr);
                syncServer.listStatesRegex(idRegex, standardOnSuccess, onError);
                break;

            case 'fetchDeltas':
                var itemsStr = url.query.items;
                if(!_.isString(itemsStr))
                    return onError('Illegal items');
                if(!itemsStr.length)
                    return onError('Blank items');
                if(itemsStr.charAt(0)!=='['  ||  itemsStr.charAt(itemsStr.length-1)!==']')
                    return onError('items missing [] chars: '+itemsStr);
                var items = JSON.parse(itemsStr);
                syncServer.fetchDeltas(items, standardOnSuccess, onError);
                break;

            default:
                onError(new Error('Illegal command'));
        }
    };
};


JDeltaSync._AsyncTracker = function(onSuccess) {
    if(!(this instanceof JDeltaSync._AsyncTracker)) 
        return new JDeltaSync._AsyncTracker(onSuccess);
    if(!onSuccess)
        throw new Error('You must provide an onSuccess function.');
    this.out = [];
    this.thereWasAnError = false;
    this.numOfPendingCallbacks = 1;  // You need to make an additional call to checkForEnd() after the iteration.
    this._onSuccess = onSuccess;
    this._onSuccessAlreadyCalled = false;
};
JDeltaSync._AsyncTracker.prototype.checkForEnd = function() {
    this.numOfPendingCallbacks--;
    if(this.thereWasAnError) return;
    if(this.numOfPendingCallbacks < 0) throw new Error('This should never happen');
    if(!this.numOfPendingCallbacks) {
        if(this._onSuccessAlreadyCalled) throw new Error('This should never happen');
        this._onSuccessAlreadyCalled = true;
        this._onSuccess(this.out);
    }
};


JDeltaSync.Server = function(db) {
    // Guard against forgetting the 'new' operator:
    if(!(this instanceof JDeltaSync.Server))
        return new JDeltaSync.Server(db);
    if(!db)
        throw new Error("Expected a 'db' arg.");
    this._db = db;
    this._clientConnections = {};
};
JDeltaSync.Server.prototype.listStates = function(ids, onSuccess, onError) {
    if(!_.isArray(ids)) {
        var err = new Error('ids should be an Array!');
        if(onError) return onError(err);
        else throw err;
    }
    var tracker = JDeltaSync._AsyncTracker(onSuccess);
    var i, ii;
    for(i=0, ii=ids.length; i<ii; i++) {
        if(tracker.thereWasAnError) break;
        if(!this._db._states.hasOwnProperty(ids[i])) continue;
        tracker.numOfPendingCallbacks++;
        this._db._storage.getLastDelta(ids[i], function(id, delta) {
            tracker.out[tracker.out.length] = {id:id, lastDeltaSeq:delta.seq, lastDeltaHash:delta.curHash};
            tracker.checkForEnd();
        }, function(err) {
            tracker.thereWasAnError = true;
            if(onError) return onError(err);
            else throw err;
            tracker.checkForEnd();
        });
    }
    tracker.checkForEnd();
};
JDeltaSync.Server.prototype.listStatesRegex = function(idRegex, onSuccess, onError) {
    if(!_.isRegExp(idRegex)) {
        var err = new Error('idRegex should be a RegExp!');
        if(onError) return onError(err);
        else throw err;
    }
    var self = this;
    var tracker = JDeltaSync._AsyncTracker(onSuccess);
    this._db.iterStates(idRegex, function(id, state) {
        if(tracker.thereWasAnError) return;
        tracker.numOfPendingCallbacks++;
        self._db._storage.getLastDelta(id, function(id, delta) {
            tracker.out[tracker.out.length] = {id:id, lastDeltaSeq:delta.seq, lastDeltaHash:delta.curHash};
            tracker.checkForEnd();
        }, function(err) {
            tracker.thereWasAnError = true;
            if(onError) return onError(err);
            else throw err;
            tracker.checkForEnd();
        });
    });
    tracker.checkForEnd();
};
JDeltaSync.Server.prototype.fetchDeltas = function(items, onSuccess, onError) {
    // 'items' is something like this:
    // [{id:'a', startSeq:3, endSeq:5},  // Using a query structure like this allows us to minimize # of SQL queries that we need to perform.
    //  {id:'b', seq:9}];                //
    if(!_.isArray(items)) {
        var err = new Error('items should be an Array!');
        if(onError) return onError(err);
        else throw err;
    }
    var tracker = JDeltaSync._AsyncTracker(onSuccess);
    var i, ii, item, id, seq;
    for(i=0, ii=items.length; i<ii; i++) {
        if(tracker.thereWasAnError) break;
        id = items[i].id;
        if(!_.isString(id)) {
            tracker.thereWasAnError = true;
            var err = new Error('non-string id');
            if(onError) return onError(err);
            else throw err;
        }
        if(!this._db._states.hasOwnProperty(id)) continue;
        tracker.numOfPendingCallbacks++;
        seq = items[i].seq;
        if(seq) {
            this._db._storage.getDelta(id, seq, function(id, delta) {
                tracker.out[tracker.out.length] = {id:id, delta:delta};
                tracker.checkForEnd();
            }, function(err) {
                tracker.thereWasAnError = true;
                if(onError) return onError(err);
                else throw err;
                tracker.checkForEnd();
            });
        } else {
            this._db._storage.getDeltas(id, items[i].startSeq, items[i].endSeq, function(id, deltas) {
                var j, jj;
                for(j=0, jj=deltas.length; j<jj; j++)
                    tracker.out[tracker.out.length] = {id:id, delta:deltas[j]};
                tracker.checkForEnd();
            }, function(err) {
                tracker.thereWasAnError = true;
                if(onError) return onError(err);
                else throw err;
                tracker.checkForEnd();
            });
        }
    }
    tracker.checkForEnd();
};




})();








//     // For example, imagine we are making YouTube v 2.0:
//     // PROBLEMS:  operations across multiple states... no transaction support yet.
//     //            You get into *really* messy situations when you want to undo/redo a multi-state transaction if other activity has occurred in one of the affected states.  For example, what if bob adds a video -- an entry goes into his /users/bob/videos, and also into /videos/.  Then billy creates a video.  Then bob performs an undo.  What should happen to billy's video, especially if they both get stored in the same state somewhere...
//     '/users/chris_sebastian';         // User info.
//     '/users/chris_sebastian/videos';  // --VIEW.  List of user's video ids.  Listens to /videos/*.  But, hm, i don't want to instantiate a separate VIEW per user...  Needs to be one view.
//     '/users/chris_sebastian/comments';// --VIEW.  List of user's comment ids.  (Makes it easy to remove spam accounts and all their comments.)
//     '/videos/1';                      // Video #1's info and data.
//     '/videos/1/comments';             // --VIEW.  List of comments on this video.
//     '/comments/1';                    // Comment #1
//     '/comments/2';                    // Comment #2
//     '/comments/3';                    // Comment #3
// 
//     /////////
// 
//     '/users/chris_sebastian'
//     '/users/chris_sebastian/videos/1'
//     '/users/chris_sebastian/videos/1/comments/1'
//     '/users/chris_sebastian/videos/1/comments/2'
//     '/users/chris_sebastian/videos/1/comments/3'
// 
//     /////////
// 
//     // VIEWS: listens for changes on specific state id patterns, like /videos/*/comments, and be able to produce all the comments for a specific user (for example).  Updates cheaply whenever there is a change event on any video.
// 
// 
//     '/userVideos';                    // VIEW.  input = /videos/*.    output = hash linking userID to videoIDs.
//     '/userComments';                  // VIEW.  input = /comments/*.  output = hash linking userID to commentIDs.
//     '/videoComments';                 // VIEW.  input = /comments/*.  output = hash linking videoID to commentIDs.
//     '/users/chris_sebastian';         // User info.
//     '/videos/1';                      // Video #1's info and data.
//     '/comments/1';                    // Comment #1
//     '/comments/2';                    // Comment #2
//     '/comments/3';                    // Comment #3
// 
// 
// 
// 
//     '/whiteboards/1'  // Contains list of shapeIDs and their properties.
//     '/shapes/1'
//     '/plan/1'         // Generated from a whiteboard.  Specific seq
// 
