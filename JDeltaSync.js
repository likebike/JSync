//  JDelta - Realtime Delta Distribution
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)

"use strict";

(function() {

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


JDeltaSync._generateID = function() {
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
    this._clientID = JDeltaSync._generateID();
    this._sendQueue = [];
    this._resetQueue = {};
    this._receivedFromServer = [];
    this._MATCH_ALL_REGEX = /.*/;
    this._MAX_SEND_BUNDLE_BYTES = 100*1024;
    this._dbEventCallback = _.bind(JDeltaSync.Client.prototype._addToSendQueue, this);
    this._setDB(db);
    this._sending = false;
    this._resetting = false;
    this._receiving = false;
    this._doSend = _.debounce(_.bind(JDeltaSync.Client.prototype._rawDoSend, this), 10);
    this._doReset = _.debounce(_.bind(JDeltaSync.Client.prototype._rawDoReset, this), 10);
    this.successLongPollReconnectMS = 10;
    var self = this;
    setTimeout(function() { self._rawDoReceive(); }, 1000);
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
JDeltaSync.Client.prototype._addToSendQueue = function(id, data) {
    if(this._resetQueue.hasOwnProperty(id)) return;  // Drop the item cuz we're going to reset anyway.

    // Check whether this item actually came from the server (in which case we don't want to send it back up to the server):
    if(this._receivedFromServer.length) {
        var dataStr = JDelta.stringify(data),
            item;
        for(var i=this._receivedFromServer.length-1; i>=0; i--) {
            item = this._receivedFromServer[i];
            if(item.id === id  &&  item.dataStr === dataStr) {
                this._receivedFromServer.splice(i, 1);
                return;
            }
        }
    }

    this._sendQueue[this._sendQueue.length] = {msgID:JDeltaSync._generateID(), id:id, data:data};
    this._triggerSend();
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
        data:{clientID:this._clientID,
              bundle:JSON.stringify(bundle)},
        dataType:'json',
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data))
                throw new Error('Expected array from server!');
            var needToReset = {};
            while(data.length) {
                if(data[0].msgID !== bundle[0].msgID) throw new Error('I have never seen this.');

                // It is possible for items to get removed from the send queue by resets, so be careful when removing the current data item:
                if(self._sendQueue.length  &&  self._sendQueue[0].msgID === bundle[0].msgID)
                    self._sendQueue.splice(0, 1);

                switch(data[0].result) {

                    case 'ok':
                        bundle.splice(0, 1);
                        data.splice(0, 1);
                        break;

                    case 'fail':
                        needToReset[bundle[0].id] = true;
                        bundle.splice(0, 1);
                        data.splice(0, 1);
                        break;

                    default:
                        throw new Error('Unknown result: '+result);
                }
            }
            var id;
            for(id in needToReset) if(needToReset.hasOwnProperty(id)) {
                self.reset(id);
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
JDeltaSync.Client.prototype.reset = function(id) {
    this._resetQueue[id] = true;
    // Clear from send queue:
    for(var i=this._sendQueue.length-1; i>=0; i--) {
        if(this._sendQueue[i].id === id)
            this._sendQueue.splice(i, 1);
    }
    // Also clear from the server items to ignore.
    for(var i=this._receivedFromServer.length-1; i>=0; i--) {
        if(this._receivedFromServer[i].id === id)
            this._receivedFromServer.splice(i, 1);
    }
    this._triggerReset();
};
JDeltaSync.Client.prototype._triggerReset = function() {
    if(!this._resetting)
        this._doReset();
};
JDeltaSync.Client.prototype._rawDoReset = function() {
    var self = this;
    var idsToReset = [],
        id;
    for(id in this._resetQueue) if(this._resetQueue.hasOwnProperty(id)) {
        idsToReset[idsToReset.length] = {id:id};
    }
    if(!idsToReset.length) return; // Nothing to reset.
    if(this._resetting) return;    // Already resetting.
    this._resetting = true;
    this.fetchDeltas(idsToReset, function(data) {
        var idsIRequested = {},
            idsIReceived = {},
            i, ii, id;
        for(i=0, ii=idsToReset.length; i<ii; i++) {
            idsIRequested[idsToReset[i].id] = true;
        }
        for(i=0, ii=data.length; i<ii; i++) {
            idsIReceived[data[i].id] = true;
        }
        // Delete items that went away:
        for(id in idsIRequested) if(idsIRequested.hasOwnProperty(id)) {
            if(!idsIReceived.hasOwnProperty(id)) {
                if(self._db._states.hasOwnProperty(id))
                    self._db.deleteState(id);
            }
        }
        // Create new items:
        for(id in idsIReceived) if(idsIReceived.hasOwnProperty(id)) {
            if(!self._db._states.hasOwnProperty(id))
                self._db.createState(id);
        }
        // Reset items I got data for:
        var tracker = JDeltaDB._AsyncTracker(function(out) {
            var id2;
            for(id2 in idsIReceived) if(idsIReceived.hasOwnProperty(id2)) {
                self._db._storage.createStateSync(id2);
            }
            var tracker2 = JDeltaDB._AsyncTracker(function(out2) {
                var id3;
                for(id3 in idsIReceived) if(idsIReceived.hasOwnProperty(id3)) {
                    self._db.rollback(id3);
                    delete self._resetQueue[id3];
                }
                var i, ii;
                for(i=0, ii=idsToReset; i<ii; i++) {
                    delete self._resetQueue[idsToReset[i]];
                }
                self._resetting = false;
                setTimeout(_.bind(JDeltaSync.Client.prototype._rawDoReset, self), 1);
            });
            var i, ii;
            for(i=0, ii=data.length; i<ii; i++) {
                tracker2.numOfPendingCallbacks++;
                self._db._storage.addDelta(data[i].id, data[i].delta, function() {
                    tracker2.checkForEnd();
                },
                function(err) {
                    if(typeof console !== 'undefined') console.log('RESET-ERROR2:', err);
                    tracker2.checkForEnd();
                });
            }
            tracker2.checkForEnd();
        });
        for(id in idsIReceived) if(idsIReceived.hasOwnProperty(id)) {
            tracker.numOfPendingCallbacks++;
            self._db._storage.deleteState(id, function(id) {
                tracker.checkForEnd();
            },
            (function(id) {
                return function(err) {
                    if(typeof console !== 'undefined') console.log('RESET-ERROR:', id, err);
                    tracker.checkForEnd();
                };
             })(id));
        }
        tracker.checkForEnd();
    });
};
JDeltaSync.Client.prototype._rawDoReceive = function() {
    var self = this;
    if(this._receiving) return;
    this._receiving = true;
    var requestStartTime = new Date().getTime();  // I do things this way because the ajax 'timeout' option does not work in Chrome.
    jQuery.ajax({
        url:this._url+'/clientReceive?clientID='+this._clientID,
        type:'GET',
        //timeout:this.longPollTimeoutMS,  // Timeout does NOT WORK in Chrome!
        dataType:'json',
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data)) {
                throw new Error('Expected array from server!');
            }
            var chain = [],
                i, ii;
            for(i=0, ii=data.length; i<ii; i++) {
                chain[chain.length] = (function(item) {
                    return function(next, onError) {
                        switch(item.data.op) {

                            case 'createState':
                                if(self._db._states.hasOwnProperty(item.id)) {
                                    self.reset(item.id);
                                } else {
                                    self._receivedFromServer[self._receivedFromServer.length] = {id:item.id, dataStr:JDelta.stringify({op:'createState'})};
                                    self._db.createState(item.id);
                                }
                                next();
                                break;

                            case 'deltaApplied':
                                try {
                                    self._receivedFromServer[self._receivedFromServer.length] = {id:item.id, dataStr:JDelta.stringify({op:'deltaApplied', delta:item.data.delta})};
                                    self._db._addHashedDelta(item.id, item.data.delta, function() {
                                        console.log('SUCCESS:', item.msgID);
                                        next();
                                    }, function(err) {
                                        console.log('Error Applying Delta.  Resetting: ', item.id, err);
                                        self.reset(item.id);
                                        next();
                                    });
                                } catch(e) {
                                    console.log('IN CATCH '+e);
                                    self.reset(item.id);
                                    next();
                                }
                                break;
                                
                            case 'deleteState':
                                self._receivedFromServer[self._receivedFromServer.length] = {id:item.id, dataStr:JDelta.stringify({op:'deleteState'})};
                                self._db.deleteState(item.id, next, function(err) {
                                    self.reset(item.id);
                                    next();
                                });
                                break;

                            default:
                                console.log('Unknown clientReceive op:',item.data.op);
                                next();
                        }
                    };
                })(data[i]);
            }
            JDeltaDB._runAsyncChain(chain, function() {
                self._receiving = false;
                setTimeout(_.bind(JDeltaSync.Client.prototype._rawDoReceive, self), self.successLongPollReconnectMS);
            });
        },
        error:function(jqXHR, retCodeStr, exceptionObj) {
            self._receiving = false;
            var reconnectMS = self.successLongPollReconnectMS;
            var timeSinceStart = new Date().getTime() - requestStartTime;
            if(timeSinceStart < 5000) reconnectMS = 5000;
            setTimeout(_.bind(JDeltaSync.Client.prototype._rawDoReceive, self), reconnectMS);
            throw exceptionObj;  // Occurs when there is a problem connection to the server.
        }
    });
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
        url:this._url+'/query?cmd=listStates&ids='+encodeURIComponent(JSON.stringify(ids)),
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
        url:this._url+'/query?cmd=listStatesRegex&idRegex='+encodeURIComponent(regexStr),
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
        url:this._url+'/query?cmd=fetchDeltas&items='+encodeURIComponent(JSON.stringify(items)),
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



JDeltaSync.sebwebHandler_clientReceive = function(syncServer) {
    return function(req, res, onSuccess, onError) {
        var url = URL.parse(req.url, true);
        var clientID = url.query.clientID;
        if(!_.isString(clientID))
            return onError(new Error('clientID is not a string'));
        if(clientID.length !== 10)  // 0x12345678
            return onError(new Error('Wrong clientID length'));
        if(clientID.lastIndexOf('0x', 0) !== 0)
            return onError(new Error('clientID does not start with 0x'));
        syncServer.clientReceive(clientID, req, function(result) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.end(JSON.stringify(result));
            onSuccess();
        }, onError);
    };
};
JDeltaSync.sebwebHandler_clientSend = function(syncServer) {
    var sebweb = require('sebweb');
    return sebweb.BodyParser(function(req, res, onSuccess, onError) {
        var clientIDArray = req.formidable_form.fields.clientID;
        if(!_.isArray(clientIDArray)) {
            var err = new Error('No clientID!');
            if(onError) return onError(err);
            else throw err;
        }
        if(clientIDArray.length !== 1) {
            var err = new Error('Wrong number of clientIDs');
            if(onError) return onError(err);
            else throw err;
        }
        var clientID = clientIDArray[0];
        if(!_.isString(clientID)) {
            var err = new Error('clientID is not a string');
            if(onError) return onError(err);
            else throw err;
        }
        if(clientID.length !== 10) {   // 0x12345678
            var err = new Error('wrong clientID length');
            if(onError) return onError(err);
            else throw err;
        }
        if(clientID.lastIndexOf('0x', 0) !== 0) {
            var err = new Error('clientID does not start with 0x');
            if(onError) return onError(err);
            else throw err;
        }
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
        var bundle = JSON.parse(bundleStr);
        var result = syncServer.clientSend(clientID, bundle, function(result) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.end(JSON.stringify(result));
            onSuccess();
        }, onError);
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
                    return onError(new Error('Illegal ids'));
                if(!idsStr.length)
                    return onError(new Error('Blank ids'));
                if(idsStr.charAt(0)!=='['  ||  idsStr.charAt(idsStr.length-1)!==']')
                    return onError(new Error('ids missing [] chars: '+idsStr));
                var ids = JSON.parse(idsStr);
                syncServer.listStates(ids, standardOnSuccess, onError);
                break;

            case 'listStatesRegex':
                var idRegexStr = url.query.idRegex;
                if(!_.isString(idRegexStr))
                    return onError(new Error('Illegal idRegex'));
                if(!idRegexStr.length)
                    return onError(new Error('Blank idRegex'));
                if(idRegexStr.charAt(0)!=='/'  ||  idRegexStr.charAt(1)!=='^'  ||  idRegexStr.charAt(idRegexStr.length-2)!=='$'  ||  idRegexStr.charAt(idRegexStr.length-1)!=='/')
                    return onError(new Error('idRegex missing /^...$/ chars: '+idRegexStr));
                idRegexStr = idRegexStr.substring(1, idRegexStr.length-1); // Chop off the surrounding '/' chars.
                var idRegex = RegExp(idRegexStr);
                syncServer.listStatesRegex(idRegex, standardOnSuccess, onError);
                break;

            case 'fetchDeltas':
                var itemsStr = url.query.items;
                if(!_.isString(itemsStr))
                    return onError(new Error('Illegal items'));
                if(!itemsStr.length)
                    return onError(new Error('Blank items'));
                if(itemsStr.charAt(0)!=='['  ||  itemsStr.charAt(itemsStr.length-1)!==']')
                    return onError(new Error('items missing [] chars: '+itemsStr));
                var items = JSON.parse(itemsStr);
                syncServer.fetchDeltas(items, standardOnSuccess, onError);
                break;

            default:
                onError(new Error('Illegal command'));
        }
    };
};






JDeltaSync.Server = function(db) {
    // Guard against forgetting the 'new' operator:
    if(!(this instanceof JDeltaSync.Server))
        return new JDeltaSync.Server(db);
    if(!db)
        throw new Error("Expected a 'db' arg.");
    this._db = db;
    this._clientConnections = {};
    this.clientReceiveThrottleMS = 100;
    this.longPollTimeoutMS = 100000;
};
JDeltaSync.Server.prototype.installIntoSebwebRouter = function(router, baseURL) {
    if(!_.isString(baseURL)) throw new Error('Expected a baseURL');
    if(!baseURL.length) throw new Error('Empty baseURL!');
    if(baseURL.charAt(0) !== '/') throw new Error("baseURL should start with '/'.");
    if(baseURL.charAt(baseURL.length-1) === '/') throw new Error("baseURL should not end with '/'.");
    router.prependRoutes([
        {path:'^'+baseURL+'/query$',         func:JDeltaSync.sebwebHandler_query(this)},
        {path:'^'+baseURL+'/clientSend$',    func:JDeltaSync.sebwebHandler_clientSend(this)},
        {path:'^'+baseURL+'/clientReceive$', func:JDeltaSync.sebwebHandler_clientReceive(this)},
    ]);
};
JDeltaSync.Server.prototype._broadcast = function(item, excludes) {
    for(var id in this._clientConnections) if(this._clientConnections.hasOwnProperty(id)) {
        if(excludes.hasOwnProperty(id)) continue;
        var clientConn = this._clientConnections[id];
        var q = clientConn.queue;
        q[q.length] = item;
        if(clientConn.sendToLongPoll) clientConn.sendToLongPoll();
    }
};
JDeltaSync.Server.prototype.clientReceive = function(clientID, req, onSuccess, onError) {
    var self = this;
    var clientConn = this._clientConnections[clientID];
    if(!clientConn) {
        this._clientConnections[clientID] = clientConn = {remoteAddress:'MAYBE_DO_LATER', queue:[]};
        clientConn.send = _.throttle(function() {
            clientConn.lastActivityTime = new Date().getTime();
            var result = clientConn.queue.splice(0, clientConn.queue.length);
            onSuccess(result);
            clientConn.lastActivityTime = new Date().getTime();
        }, this.clientReceiveThrottleMS);
    }

    clientConn.lastActivityTime = new Date().getTime();

    // Check whether there is an old long-poll function waiting to be called:
    if(clientConn.sendToLongPoll) {
        // The connection should be dead:
        if(!clientConn.req.socket.destroyed) {
            console.log('DESTROYING OLD REQEST.');  // This does not usually occur.  The only normal way I have found this to occur is in Chrome.  For some reason, Chrome does not seem to close its sockets after a timeout.  Instead, it collects a bunch of zombie sockets and the closes them all at once... Still trying to find a solution to that...
            clientConn.req.destroy();
        }
        clientConn.sendToLongPoll();  // Allow the preview handler to clean up the old stuff.
    }

    if(clientConn.queue.length) {
        var result = clientConn.queue.splice(0, clientConn.queue.length);
        onSuccess(result);
        clientConn.lastActivityTime = new Date().getTime();
    } else {
        // long poll.
        clientConn.req = req;
        clientConn.sendToLongPoll = function() {
            // Make sure this is only called once:
            clientConn.sendToLongPoll = null;
            clientConn.req = null;
            // Make sure the connection is still alive:
            if(req.socket.destroyed) {
                req.statusCode = 408;  // Request Timeout
                return onError();
            }
            var result = clientConn.queue.splice(0, clientConn.queue.length);
            onSuccess(result);
            clientConn.lastActivityTime = new Date().getTime();
        };
        var sendToLongPoll = clientConn.sendToLongPoll;
        setTimeout(function() {  // Force the long-poll to execute before the server or filewalls close our connection.  The reason we need to do this from the server is becasue Chrome does not support the ajax 'timeout' option.
            if(clientConn.sendToLongPoll === sendToLongPoll)
                sendToLongPoll();
        }, self.longPollTimeoutMS);
    }
};
JDeltaSync.Server.prototype.clientSend = function(clientID, bundle, onSuccess, onError) {
    var self = this,
        chain = [],
        result = [],
        i, ii;
    for(i=0, ii=bundle.length; i<ii; i++) {
        chain[chain.length] = (function(bundleItem) {
            return function(next, onError) {
                var excludes = {};
                excludes[clientID] = true;  // I need to use this two-step process because javascript does not work right if I just say {clientID:true} because it uses 'clientID' as the key.
                switch(bundleItem.data.op) {

                    case 'createState':
                        if(self._db._states.hasOwnProperty(bundleItem.id)) {
                            console.log('State already exists: '+bundleItem.id);
                            result[result.length] = {msgID:bundleItem.msgID, result:'fail'};
                        } else {
                            self._db.createState(bundleItem.id);
                            result[result.length] = {msgID:bundleItem.msgID, result:'ok'};
                            self._broadcast(bundleItem, excludes);
                        }
                        next();
                        break;

                    case 'deltaApplied':
                        try {
                            self._db._addHashedDelta(bundleItem.id, bundleItem.data.delta, function() {
                                result[result.length] = {msgID:bundleItem.msgID, result:'ok'};
                                self._broadcast(bundleItem, excludes);
                                next();
                            }, function(err) {
                                result[result.length] = {msgID:bundleItem.msgID, result:'fail'};
                                next();
                            });
                        } catch(e) {
                            result[result.length] = {msgID:bundleItem.msgID, result:'fail'};
                            next();
                        }
                        break;

                    case 'deleteState':
                        self._db.deleteState(bundleItem.id, function() {
                            result[result.length] = {msgID:bundleItem.msgID, result:'ok'};
                            self._broadcast(bundleItem, excludes);
                            next();
                        }, function(err) {
                            result[result.length] = {msgID:bundleItem.msgID, result:'fail'};
                            next();
                        });
                        break;

                    default:
                        console.log('Unknown clientSend op: '+bundleItem.data.op);
                        result[result.length] = {msgID:bundleItem.msgID, result:'fail'};
                        next();
                }
            };
        })(bundle[i]);
    }
    JDeltaDB._runAsyncChain(chain, function() {
        onSuccess(result);
    }, onError);
};
JDeltaSync.Server.prototype.listStates = function(ids, onSuccess, onError) {
    if(!_.isArray(ids)) {
        var err = new Error('ids should be an Array!');
        if(onError) return onError(err);
        else throw err;
    }
    var tracker = JDeltaDB._AsyncTracker(onSuccess);
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
    var tracker = JDeltaDB._AsyncTracker(onSuccess);
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
    var tracker = JDeltaDB._AsyncTracker(onSuccess);
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
