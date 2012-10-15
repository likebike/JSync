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
    _,
    undefined;   // So undefined really will be undefined.
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

JDeltaSync.VERSION = '0.2.0';


JDeltaSync.extraAjaxOptions = { xhrFields: {withCredentials:true} };    // Enable CORS cookies.
if(jQuery  &&  !jQuery.support.cors) JDeltaSync.extraAjaxOptions = {};  // If you try to use the 'withCredentials' field on IE6, you get an exception.




JDeltaSync.allConnectionInfos = function(joinState, stateType, minDepth) {
    // Join State Structure:
    //    v---------------------------- userIDs
    //    v      v--------------------- browserIDs
    //    v      v     v--------------- connectionIDs
    //    v      v     v   v----------- subscriptionModes
    // { user1:{asdf:{qaz:'',
    //                wsx:'sJ',
    //                edc:'rS'},
    //          qwer:{rfv:'sJ+rS',
    //                tgb:'sJ+sS'}},
    //   user2:{uiop:{yhn:'sJ'}},
    //   ...
    // }
    stateType = stateType || '';  // '' always matches.
    minDepth = minDepth || '';    //
    var connectionIDs = [],
        userID, browserIDs, browserID, cIDs, cID, cSub;
    for(userID in joinState) if(joinState.hasOwnProperty(userID)) {
        browserIDs = joinState[userID];
        for(browserID in browserIDs) if(browserIDs.hasOwnProperty(browserID)) {
            cIDs = browserIDs[browserID];
            for(cID in cIDs) if(cIDs.hasOwnProperty(cID)) {
                cSub = cIDs[cID];
                if(cSub.indexOf(stateType) === -1) continue;
                if(minDepth === 'r'  &&  cSub.indexOf('r'+stateType) === -1) continue;
                connectionIDs[connectionIDs.length] = {userID:userID, browserID:browserID, connectionID:cID};
            }
        }
    }
    return connectionIDs;
};
JDeltaSync.allConnections = function(joinState, stateType, minDepth) {
    var cInfos = JDeltaSync.allConnectionInfos(joinState, stateType, minDepth);
    var connections = [],
        i, ii;
    for(i=0, ii=cInfos.length; i<ii; i++) {
        connections[connections.length] = cInfos[i].connectionID;
    }
    return connections;
};
JDeltaSync.connectionInfo = function(joinState, connectionID) {
    var userID, user, browserIDs, browserID, browser;
    for(userID in joinState) if(joinState.hasOwnProperty(userID)) {
        browserIDs = joinState[userID];
        for(browserID in browserIDs) if(browserIDs.hasOwnProperty(browserID)) {
            if(browserIDs[browserID].hasOwnProperty(connectionID))
                return {userID:userID, browserID:browserID, connectionID:connectionID};
        }
    }
    return null;
};
JDeltaSync.browserInfo = function(joinState, browserID) {
    var userID, user, browserIDs;
    for(userID in joinState) if(joinState.hasOwnProperty(userID)) {
        browserIDs = joinState[userID];
        if(browserIDs.hasOwnProperty(browserID)) {
            var connectionIDs = [],
                cIDs = browserIDs[browserID],
                cID;
            for(cID in cIDs) if(cIDs.hasOwnProperty(cID)) {
                connectionIDs[connectionIDs.lenth] = cID;
            }
            return {userID:userID, browserID:browserID, connectionIDs:connectionIDs};
        }
    }
    return null;
};
JDeltaSync.userInfo = function(joinState, userID) {
    var browserIDs = [],
        connectionIDs = [],
        bIDs, bID, cIDs, cID;
    if(joinState.hasOwnProperty(userID)) {
        bIDs = joinState[userID];
        for(bID in bIDs) if(bIDs.hasOwnProperty(bID)) {
            browserIDs[browserIDs.length] = bID;
            cIDs = bIDs[bID];
            for(cID in cIDs) if(cIDs.hasOwnProperty(cID)) {
                connectionIDs[connectionIDs.length] = cID;
            }
        }
        return {userID:userID, browserIDs:browserIDs, connectionIDs:connectionIDs};
    }
    return null;
};



JDeltaSync.MATCH_ALL_REGEX = /.*/;
JDeltaSync.Client = function(url, stateDB, joinDB) {
    // Guard against forgetting the 'new' operator:
    if(!(this instanceof JDeltaSync.Client)) return new JDeltaSync.Client(url, stateDB, joinDB);
    var self = this;

    this.maxSendBundleBytes = 100*1024;
    this.successReceiveReconnectMS = 10;
    this.errorResetReconnectMS = 10000;

    if(!_.isString(url)) throw new Error('You must provide a base url.');
    this._url = url;
    this.connectionID = null;
    this._sendQueue = [];
    this._sendQueueCallbacks = {};
    this._resetQueue = {};
    this._receivedFromServer = [];
    this._messageListeners = [];
    this._sending = false;
    this._resetting = false;
    this._receiving = false;
    this._joins = {};
    this._activeAJAX = [];

    this._boundStateDbEventCallback = _.bind(this._stateDbEventCallback, this);

    this._setStateDB(stateDB);
    this._setJoinDB(joinDB);

    this._doSend = _.debounce(_.bind(this._rawDoSend, this), 10);
    this._doReset = _.debounce(_.bind(this._rawDoReset, this), 10);
    setTimeout(function() { self._rawDoReceive(); }, 1000);
    this.login();
};
JDeltaSync.Client.prototype.getConnectionInfo = function() {
    // A convenience function for a frequently-needed piece of functionality.
    for(var jID in this._joins) if(this._joins.hasOwnProperty(jID)) {
        // Just take the first one we can get.
        return JDeltaSync.connectionInfo(this.joinDB.getState(jID), this.connectionID);
    }
    return null;
};
JDeltaSync.Client.prototype.login = function(callback) {
    var self = this;
    var errRetryMS = 1000;
    var DOIT = function() {
        jQuery.ajax(_.extend({
            url:self._url+'/clientLogin',
            type:'POST',
            data:{op:'login'},
            dataType:'json',
            cache:false,
            success:function(data, retCodeStr, jqXHR) {
                if(!_.isObject(data)) throw new Error('Expected object from server!');
                self.connectionID = data.connectionID;
                if(callback) return callback(self);
            },
            error:function(jqXHR, retCodeStr, exceptionObj) {
                setTimeout(DOIT, errRetryMS);
                errRetryMS *= 1.62; if(errRetryMS > 30000) errRetryMS = 30000;
                throw exceptionObj;
            }
        }, JDeltaSync.extraAjaxOptions));
    };
    DOIT();
};
JDeltaSync.Client.prototype.logout = function(callback) {
    if(!this.connectionID) {
        if(callback) return callback(this);     // Already logged out.
        else return;
    }
    var self = this;
    var doLogout = function() {
        jQuery.ajax(_.extend({
            url:self._url+'/clientLogin',
            type:'POST',
            data:{op:'logout',
                  connectionID:self.connectionID},
            dataType:'json',
            cache:false,
            success:function(data, retCodeStr, jqXHR) {
                if(!_.isObject(data)) throw new Error('Expected object from server!');
                self.connectionID = null;
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    try { self._activeAJAX[i].abort();  // This actually *runs* the error handlers and thrown exceptions will pop thru our stack if we don't try...catch this.
                    } catch(e) {}
                    self._activeAJAX.splice(i, 1);
                }
                if(callback) return callback(self);
            },
            error:function(jqXHR, retCodeStr, exceptionObj) {
                console.log('Error logging out:', exceptionObj);
                if(callback) return callback(self);
            }
        }, JDeltaSync.extraAjaxOptions));
    };
    doLogout();
};
JDeltaSync.Client.prototype.relogin = function() {
    var self = this;
    this.logout(function() {
        self.login(function() {
            for(var stateID in self._joins) if(self._joins.hasOwnProperty(stateID)) {
                self.join(stateID, self._joins[stateID]);
            }
        });
    });
};


JDeltaSync.Client.prototype._stateDbEventCallback = function(id, data) {
    data['id'] = id;
    data['type'] = 'state';
    this._addToSendQueue(data);
};
JDeltaSync.Client.prototype._setStateDB = function(stateDB) {
    if(this.stateDB) {
        this.stateDB.off(JDeltaSync.MATCH_ALL_REGEX, '!', this._boundStateDbEventCallback);
        // Do i need to clear the send/reset queues?
        throw new Error('Unregistration of old stateDB is not implemented yet.');
    }
    this.stateDB = stateDB || new JDeltaDB.DB();
    this.stateDB.on(JDeltaSync.MATCH_ALL_REGEX, '!', this._boundStateDbEventCallback);
};
JDeltaSync.Client.prototype._setJoinDB = function(joinDB) {
    if(this.joinDB) {
        // I don't understand this situation yet...
        throw new Error('Unregistration of old joinDB is not implemented yet.');
    }
    this.joinDB = joinDB || new JDeltaDB.DB();
};
JDeltaSync.Client.prototype._getDB = function(type) {
    switch(type) {
        case 'state': return this.stateDB;
        case 'join':  return this.joinDB;
        default: throw new Error('Invalid DB type: '+type);
    }
};

JDeltaSync.Silent = '';                        
JDeltaSync.SingleJoin = 'sJ';                  
JDeltaSync.RecursiveJoin = 'rJ';                    // << RecursiveJoins are implemented for completeness,
JDeltaSync.SingleState = 'sS';                         // although I can't really think of a good use for them.
JDeltaSync.RecursiveState = 'rS';                      //
JDeltaSync.SingleJoin_SingleState = 'sJ+sS';           //
JDeltaSync.SingleJoin_RecursiveState = 'sJ+rS';        //
JDeltaSync.RecursiveJoin_SingleState = 'rJ+sS';     // <<
JDeltaSync.RecursiveJoin_RecursiveState = 'rJ+rS';  // <<
JDeltaSync.Client.prototype.join = function(stateID, subscribeMode) {
    var self = this;
    // If you want to receive notification when the full reset is done, you can register a listener to the 'reset' event on the stateID in the joinDB.
    if(!subscribeMode) subscribeMode = JDeltaSync.SingleJoin_RecursiveState;

    // We keep track of our joins so that we can easily re-create them if we relogin:
    this._joins[stateID] = subscribeMode;
    
    // In order to avoid an Delta Application Error from being displayed to the console, we need to reset the Join state before we join!
    if(!this.joinDB.contains(stateID)) {
        this.reset('join', stateID);  // For now, we just assume that the reset will go thru first since we call it first.  If this proves inadequate, we will need to add a callback to the reset() function somehow.
    }
    return this._addToSendQueue({op:'join', id:stateID, subscribeMode:subscribeMode});
};
JDeltaSync.Client.prototype.leave = function(stateID) {
    // If you want to receive notification when the full leave is done, you can register a listener to the '!'/'deleteState' event on the stateID in the joinDB.
    var self = this;

    delete this._joins[stateID];

    return this._addToSendQueue({op:'leave', id:stateID}, function(result) {
        if(result === 'ok') {
            // It is OK to use the joinDB.deleteState because we don't track the '!' event, and therefore we never try to sync local modifications to the server.
            self.joinDB.deleteState(stateID);  // Does not delete recursive states that got auto-pulled.  You can do that manually with joinDB.iterStates() and joinDB.deleteState().
        } else {
            if(typeof console !== 'undefined') console.log('Unexpected result while trying to leave:', result);
        }
    });
};
JDeltaSync.Client.prototype._callSendQueueCallback = function(msgID, callback, result, details) {
    if(!callback) {
        if(!this._sendQueueCallbacks.hasOwnProperty(msgID)) return;
        callback = this._sendQueueCallbacks[msgID];
    }
    try {
        callback(result, details);
    } catch(e) {
        if(typeof console !== 'undefined') console.log('sendQueueCallback error:', e, e.stack);
    }
    if(msgID) delete this._sendQueueCallbacks[msgID];
};
JDeltaSync.Client.prototype._addToSendQueue = function(data, callback) {
    if(data.type === 'state') {  // Right now, I only expect this section to apply to State operations.  Not Joins or Messages.  This 'if' is here as an optimization, not really a rule.
        if(data.type  &&  data.id) {
            if(this._resetQueue.hasOwnProperty(data.type+'::'+data.id)) {
                this._callSendQueueCallback(null, callback, 'dropped:reset');
                return;  // Drop the item cuz we're going to reset anyway.
            }

            // Check whether this item actually came from the server (in which case we don't want to send it back up to the server):
            if(this._receivedFromServer.length) {
                var dataStr = JDelta.stringify(data),
                    item;
                for(var i=this._receivedFromServer.length-1; i>=0; i--) {
                    item = this._receivedFromServer[i];
                    if(item.type === data.type  &&  item.id === data.id  &&  item.dataStr === dataStr) {
                        this._receivedFromServer.splice(i, 1);
                        this._callSendQueueCallback(null, callback, 'dropped:fromServer');
                        return;
                    }
                }
            }
        }
    }

    var msgID = JDelta._generateID();
    this._sendQueue[this._sendQueue.length] = {msgID:msgID, data:data};
    if(callback) this._sendQueueCallbacks[msgID] = callback;
    this._triggerSend();
    return msgID;
};
JDeltaSync.Client.prototype._triggerSend = function() {
    if(!this._sending)
        this._doSend();
};
JDeltaSync.Client.prototype._handleAjaxErrorCodes = function(jqXHR) {
    // If jqXHR.status is 0, it means there is a problem with cross-domain communication, and Javascript has been dis-allowed access to the XHR object.
    if(jqXHR.status === 401) {
        // Our connectionID has been deleted because it was idle.
        // We need to login again.
        if(typeof console !== 'undefined') console.log('connectionID Lost.  Reconnecting...');
        this.login();
        return true;
    } else if(jqXHR.status === 403) {
        // Our IP has changed, and our cookie has been changed.
        // We need to login and re-join again.
        if(typeof console !== 'undefined') console.log('browserID Lost.  Reconnecting...');
        this.relogin();
        return true;
    }
    return false;
};
JDeltaSync.Client.prototype._rawDoSend = function() {
    var self = this;
    if(!this.connectionID) return setTimeout(_.bind(this._rawDoSend, this), 1000);  /// Not logged in!
    var errRetryMS = 1000;
    var DOIT = function() {
        if(!self._sendQueue.length) return;  // Nothing to send.
        if(self._sending) return;            // Already sending.
        self._sending = true;
        var bundle = [],
            bundleBytes = 0,
            i, ii;
        for(i=0, ii=self._sendQueue.length; i<ii; i++) {
            bundle[bundle.length] = self._sendQueue[i];
            bundleBytes += JSON.stringify(self._sendQueue[i]).length;  // Not really bytes (unicode)... but, whatever.
            if(bundleBytes > self.maxSendBundleBytes) break;
        }
        var myRequest = self._activeAJAX[self._activeAJAX.length] = jQuery.ajax(_.extend({
            url:self._url+'/clientSend',
            type:'POST',
            data:{connectionID:self.connectionID,
                  bundle:JSON.stringify(bundle)},
            dataType:'json',
            cache:false,
            success:function(data, retCodeStr, jqXHR) {
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                if(!_.isArray(data))
                    throw new Error('Expected array from server!');
                var needToReset = {},
                    item;
                while(data.length) {
                    if(data[0].msgID !== bundle[0].msgID) throw new Error('I have never seen this.');

                    // It is possible for items to get removed from the send queue by resets, so be careful when removing the current data item:
                    if(self._sendQueue.length  &&  self._sendQueue[0].msgID === bundle[0].msgID)
                        self._sendQueue.splice(0, 1);
                    
                    self._callSendQueueCallback(data[0].msgID, null, data[0].result, data[0].details);
                    
                    switch(data[0].result) {

                        case 'ok':
                            bundle.splice(0, 1);
                            data.splice(0, 1);
                            break;

                        case 'fail':
                            item = bundle[0];
                            if(item.data.type)
                                needToReset[item.data.type+'::'+item.data.id] = {type:item.data.type, id:item.data.id};
                            bundle.splice(0, 1);
                            data.splice(0, 1);
                            break;

                        default: throw new Error('Unknown result: '+result);
                    }
                }
                var itemStr, item;
                for(itemStr in needToReset) if(needToReset.hasOwnProperty(itemStr)) {
                    item = needToReset[itemStr];
                    self.reset(item.type, item.id);
                }
            },
            error:function(jqXHR, retCodeStr, exceptionObj) {
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                self._sending = false;
                self._handleAjaxErrorCodes(jqXHR);

                setTimeout(DOIT, errRetryMS);
                errRetryMS *= 1.62; if(errRetryMS > 120000) errRetryMS = 120000;
                throw exceptionObj;
            },
            complete:function(jqXHR, retCodeStr) {
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                self._sending = false;
                if(self._sendQueue.length) {
                    setTimeout(_.bind(self._rawDoSend, self), 1);
                }
            }
        }, JDeltaSync.extraAjaxOptions));
    };
    DOIT();
};
JDeltaSync.Client.prototype.reset = function(type, id) {
    this._resetQueue[type+'::'+id] = {type:type, id:id};
    // Clear from send queue:
    var i, item;
    for(i=this._sendQueue.length-1; i>=0; i--) {
        item = this._sendQueue[i];
        if(item.data.type === type  &&  item.data.id === id) {
            this._callSendQueueCallback(item.msgID, null, 'cancelled:reset');
            this._sendQueue.splice(i, 1);
        }
    }
    // Also clear from the server items to ignore.
    for(i=this._receivedFromServer.length-1; i>=0; i--) {
        item = this._receivedFromServer[i];
        if(item.type === type  &&  type.id === id)
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
    var errRetryMS = 1000;
    var DOIT = function() {
        var itemsToReset = [],
            itemStr;
        for(itemStr in self._resetQueue) if(self._resetQueue.hasOwnProperty(itemStr)) {
            itemsToReset[itemsToReset.length] = self._resetQueue[itemStr];
        }
        if(!itemsToReset.length) return; // Nothing to reset.
        if(self._resetting) return;    // Already resetting.
        self._resetting = true;
        self.fetchDeltas(itemsToReset, function(data) {
            var itemsIRequested = {},
                itemsIReceived = {},
                i, ii, item, itemStr;
            for(i=0, ii=itemsToReset.length; i<ii; i++) {
                item = itemsToReset[i];
                itemsIRequested[item.type+'::'+item.id] = item;
            }
            for(i=0, ii=data.length; i<ii; i++) {
                item = data[i];
                itemsIReceived[item.type+'::'+item.id] = item;
            }
            // Delete items that went away:
            var db;
            for(itemStr in itemsIRequested) if(itemsIRequested.hasOwnProperty(itemStr)) {
                if(!itemsIReceived.hasOwnProperty(itemStr)) {
                    item = itemsIRequested[itemStr];
                    db = self._getDB(item.type);
                    if(db.contains(item.id)) db.deleteState(item.id);
                }
            }
            // Create new items:
            for(itemStr in itemsIReceived) if(itemsIReceived.hasOwnProperty(itemStr)) {
                item = itemsIReceived[itemStr];
                db = self._getDB(item.type);
                if(!db.contains(item.id)) db.createState(item.id);
            }
            // Reset items I got data for:
            var tracker = JDeltaDB._AsyncTracker(function(out) {
                // At this point, we have deleted all the Storage states that we are going to reset.
                // First, re-create the storage states:
                var itemStr2, item2, db2;
                for(itemStr2 in itemsIReceived) if(itemsIReceived.hasOwnProperty(itemStr2)) {
                    item2 = itemsIReceived[itemStr2];
                    db2 = self._getDB(item2.type);
                    db2._storage.createStateSync(item2.id);
                }
                var tracker2 = JDeltaDB._AsyncTracker(function(out2) {
                    // At this point, we have added all the deltas to the Storage.  Now trigger rollbacks:
                    var itemStr3, item3, db3;
                    for(itemStr3 in itemsIReceived) if(itemsIReceived.hasOwnProperty(itemStr3)) {
                        item3 = itemsIReceived[itemStr3];
                        db3 = self._getDB(item3.type);
                        db3.rollback(item3.id);
                        delete self._resetQueue[item3.type+'::'+item3.id];
                    }
                    // Finally, remove the item from the resetQueue:
                    var i, ii;
                    for(i=0, ii=itemsToReset.length; i<ii; i++) {
                        item3 = itemsToReset[i];
                        delete self._resetQueue[item3.type+'::'+item3.id];
                    }
                    self._resetting = false;
                    setTimeout(_.bind(self._rawDoReset, self), 1);
                });
                // Add the deltas we received to the Storage:
                var i, ii;
                for(i=0, ii=data.length; i<ii; i++) {
                    if(data[i].delta.seq === 0) {
                        // Skip the pseudo-delta:
                        continue;
                    }
                    tracker2.numOfPendingCallbacks++;
                    item2 = data[i];
                    db2 = self._getDB(item2.type);
                    db2._storage.addDelta(item2.id, item2.delta, function() {  // We make the assumption that Storage operations will be executed in the order they are submitted.
                        tracker2.checkForEnd();
                    },
                    function(err) {
                        if(typeof console !== 'undefined') console.log('RESET-ERROR2:', err);
                        tracker2.checkForEnd();
                    });
                }
                tracker2.checkForEnd();
            });
            // Delete Storage states so I can re-create them from scratch:
            for(itemStr in itemsIReceived) if(itemsIReceived.hasOwnProperty(itemStr)) {
                tracker.numOfPendingCallbacks++;
                item = itemsIReceived[itemStr];
                db = self._getDB(item.type);
                db._storage.deleteState(item.id, function(id) {
                    return tracker.checkForEnd();
                },
                (function(type, id) {
                    return function(err) {
                        if(typeof console !== 'undefined') console.log('RESET-ERROR:', type, id, err);
                        return tracker.checkForEnd();
                    };
                 })(item.type, item.id));
            }
            tracker.checkForEnd();
        }, function(err) {
            // For example, this occurs when we try to reset something, but the server is down.
            self._resetting = false;

            setTimeout(DOIT, errRetryMS);
            errRetryMS *= 1.62; if(errRetryMS > 120000) errRetryMS = 120000;
            throw err;
        });
    };
    DOIT();
};
JDeltaSync.Client.prototype._rawDoReceive = function() {
    var self = this;
    if(!this.connectionID) return setTimeout(_.bind(this._rawDoReceive, this), 1000);  /// Not logged in!
    var errRetryMS = 1000;
    var DOIT = function() {
        if(self._receiving) return;
        self._receiving = true;
        var myRequest = self._activeAJAX[self._activeAJAX.length] = jQuery.ajax(_.extend({
            url:self._url+'/clientReceive?connectionID='+self.connectionID,
            type:'GET', // Firefox v14 is CACHING GET responses, even though I have the "Cache-Control: no-cache, must-revalidate" header set.  That's why i'm sending an 'ignore' param.
            //timeout:self.ReceiveTimeoutMS,  // Timeout does NOT WORK in Chrome (v20)!
            dataType:'json',
            cache:false,
            success:function(data, retCodeStr, jqXHR) {
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                if(!_.isArray(data)) throw new Error('Expected array from server!');
                var chain = [],
                    i, ii, db;
                for(i=0, ii=data.length; i<ii; i++) {
                    chain[chain.length] = (function(item) {
                        return function(next, onError) {
                            switch(item.data.op) {

                                case 'createState':
                                    db = self._getDB(item.data.type);
                                    if(db.contains(item.data.id)) {
                                        self.reset(item.data.type, item.data.id);
                                    } else {
                                        if(item.data.type === 'state')  // Join state deltas do not get pushed to the server, so no need to track them in the receivedFromServer list.
                                            self._receivedFromServer[self._receivedFromServer.length] = {type:item.data.type, id:item.data.id, dataStr:JDelta.stringify({op:'createState', type:'state', id:item.data.id})};
                                        db.createState(item.data.id);
                                    }
                                    return next();
                                    break;

                                case 'deltaApplied':
                                    try {
                                        db = self._getDB(item.data.type);
                                        if(item.data.type === 'state') {
                                            self._receivedFromServer[self._receivedFromServer.length] = {type:item.data.type, id:item.data.id, dataStr:JDelta.stringify({op:'deltaApplied', delta:item.data.delta, type:'state', id:item.data.id})};
                                        }
                                        db._addHashedDelta(item.data.id, item.data.delta, next, function(err) {
                                            if(typeof console !== 'undefined') console.log('Error Applying Delta.  Resetting: ', item.data.type, item.data.id, err);
                                            self.reset(item.data.type, item.data.id);
                                            return next();
                                        });
                                    } catch(e) {
                                        self.reset(item.data.type, item.data.id);
                                        return next();
                                    }
                                    break;
                                    
                                case 'deleteState':
                                    db = self._getDB(item.data.type);
                                    if(item.data.type === 'state')
                                        self._receivedFromServer[self._receivedFromServer.length] = {type:item.data.type, id:item.data.id, dataStr:JDelta.stringify({op:'deleteState', type:'state', id:item.data.id})};
                                    db.deleteState(item.data.id, next, function(err) {
                                        self.reset(item.data.type, item.data.id);
                                        return next();
                                    });
                                    break;

                                case 'message':
                                    self._triggerMessage(item.data.id, item.data.data, item.data.from);
                                    if(item.importance === 'needConfirmation')
                                        self.sendMessage(item.data.id, {confirm:item.msgID}, {to:{connectionIDs:[item.data.from.connectionID]}});
                                    return next();
                                    break;

                                case 'logout':   // The server has forced us to log out.
                                    self.connectionID = null;
                                    return next();
                                    break;

                                default:
                                    if(typeof console !== 'undefined') console.log('Unknown clientReceive op:',item.data.op);
                                    return next();
                            }
                        };
                    })(data[i]);
                }
                JDeltaDB._runAsyncChain(chain, function() {
                    self._receiving = false;
                    setTimeout(_.bind(self._rawDoReceive, self), self.successReceiveReconnectMS);
                }, function(err) {
                    throw new Error('I have never seen this.');
                    self._receiving = false;
                    setTimeout(_.bind(self._rawDoReceive, self), self.successReceiveReconnectMS);
                    throw err;
                });
            },
            error:function(jqXHR, retCodeStr, exceptionObj) {
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                self._receiving = false;
                self._handleAjaxErrorCodes(jqXHR);

                setTimeout(DOIT, errRetryMS);
                errRetryMS *= 1.62; if(errRetryMS > 120000) errRetryMS = 120000;
                throw exceptionObj;  // Occurs when there is a problem connecting to the server.
            }
        }, JDeltaSync.extraAjaxOptions));
    };
    DOIT();
};
JDeltaSync.Client.prototype.listStates = function(type, ids, onSuccess, onError) {
    // Fetches state infos from server.  Does *not* use/affect the queue.
    if(_.isRegExp(ids))
        return this._listStatesRegex(type, ids, onSuccess, onError);
    if(!_.isArray(ids)) {
        var err = new Error("'ids' should be an array of strings or a regex.");
        if(onError) return onError(err);
        else throw err;
    }
    if(!ids.length) return onSuccess([]);
    jQuery.ajax(_.extend({
        url:this._url+'/query?cmd=listStates&type='+type+'&ids='+encodeURIComponent(JSON.stringify(ids)),
        type:'GET',
        dataType:'json',
        cache:false,
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
    }, JDeltaSync.extraAjaxOptions));
};
JDeltaSync.Client.prototype._listStatesRegex = function(type, idRegex, onSuccess, onError) {
    var regexStr = idRegex.toString();
    jQuery.ajax(_.extend({
        url:this._url+'/query?cmd=listStatesRegex&type='+type+'&idRegex='+encodeURIComponent(regexStr),
        type:'GET',
        dataType:'json',
        cache:false,
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
    }, JDeltaSync.extraAjaxOptions));
};
JDeltaSync.Client.prototype.fetchDeltas = function(items, onSuccess, onError) {
    // Fetches state deltas from server.  Does *not* use/affect the queue.
    // items = [{type:'state', id:'a', startSeq:3, endSeq:5},  // Using a query structure like this allows us to minimize # of SQL queries that we need to perform.
    //          {type:'state', id:'b', seq:9}];                //
    if(!_.isArray(items)) {
        var err = new Error("'items' should be an array of DeltaRange objects.");
        if(onError) return onError(err);
        else throw err;
    }
    if(!items.length) return onSucceess([]);
    jQuery.ajax(_.extend({
        url:this._url+'/query?cmd=fetchDeltas&items='+encodeURIComponent(JSON.stringify(items)),
        type:'GET',
        dataType:'json',
        cache:false,
        success:function(data, retCodeStr, jqXHR) {
            if(!_.isArray(data)) {
                var err = new Error('Expected array from server!');
                if(onError) return onError(err);
                else throw err;
            }
            return onSuccess(data);
        },
        error:function(jqXHR, retCodeStr, exceptionObj) {
            if(onError) return onError(exceptionObj);
            else throw exceptionObj;
        }
    }, JDeltaSync.extraAjaxOptions));
};
JDeltaSync.Client.prototype.sendMessage = function(id, data, options) {
    var importance = 'normal';
    if(options.importance) {
        if(options.importance !== 'normal'  &&
           options.importance !== 'disposable'  &&
           options.importance !== 'needConfirmation')
            throw new Error('Invalid options.importance: '+options.importance);
        importance = options.importance;
    }
    var shouldSendBackToUs = true;
    if(options.to) shouldSendBackToUs = false;  // Simple logic for now.  Not quite correct, but maybe good enough???  (if options.to IS to us, then we should get it, but why would that ever happen?)
    if(shouldSendBackToUs)
        this._triggerMessage(id, data, {connectionID:this.connectionID, browserID:this, userID:this}); // Send it back to us to match the behavior of JDeltaDB events.  Use this Client object for items we don't have data for so we can easily identify messages from ourselves.
    return this._addToSendQueue({op:'sendMessage', id:id, data:data, importance:importance, to:options.to || null}, options.callback);  // If 'to' is specified, delivery will ignore whether the targets are subscribed (delivery will be forced).  If 'to' is NOT specified, then this message will be sent to everyone who is 'joined' to a compatible id path.
};
JDeltaSync.Client.prototype.onMessage = function(id, callback) {
    if(!id) throw new Error('Invalid id');
    if(!callback) throw new Error('Invalid callback');
    this._messageListeners[this._messageListeners.length] = {id:id, callback:callback};
};
JDeltaSync.Client.prototype.offMessage = function(id, callback) {
    var i, l;
    for(i=this._messageListeners.length-1; i>=0; i--) {
        l = this._messageListeners[i];
        if(l.id === id  &&  l.callback === callback) {
            this._messageListeners.splice(i, 1);
        }
    }
};
JDeltaSync.Client.prototype._triggerMessage = function(id, data, from) {
    var i, ii, l, matches;
    for(i=0, ii=this._messageListeners.length; i<ii; i++) {
        l = this._messageListeners[i];
        matches = false;
        if(_.isRegExp(l.id)) matches = l.id.test(id);
        else if(l.id === id) matches = true;
        if(matches) {
            try {
                l.callback(id, data, from);
            } catch(e) {
                if(typeof console !== 'undefined') console.log('Error in message listener:',e);
            }
        }
    }
};


/////////////////////////////////////////////////////////////////////////////////////////////////


JDeltaSync.sebwebHandler_clientLogin = function(syncServer) {
    var sebweb = require('sebweb');
    if(!syncServer.options.sebweb_cookie_secret) throw new Error('You must define syncServer.options.sebweb_cookie_secret!');
    return sebweb.BodyParser(sebweb.CookieStore(syncServer.options.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        var afterWeHaveABrowserID = function(browserID) {
            var opArray = req.formidable_form.fields.op;
            if(!_.isArray(opArray)) return onError(new Error('no op!'));
            if(opArray.length !== 1) return onError(new Error('Wrong number of ops!'));
            var op = opArray[0];
            if(!_.isString(op)) return onError(new Error('non-string op!'));
            switch(op) {
                case 'login':
                    console.log('Logging IN:',browserID);
                    syncServer.clientLogin(browserID, req, function(result) {
                        res.setHeader('Content-Type', 'application/json');
                        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
                        res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.
                        res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
                        res.end(JSON.stringify(result));
                        onSuccess();
                    }, onError);
                    break;

                case 'logout':
                    console.log('Logging OUT:',browserID);
                    var connectionIdArray = req.formidable_form.fields.connectionID;
                    if(!_.isArray(connectionIdArray)) return onError(new Error('no connectionID!'));
                    if(connectionIdArray.length !== 1) return onError(new Error('Wrong number of connectionIDs!'));
                    var connectionID = connectionIdArray[0];
                    if(!_.isString(connectionID)) return onError(new Error('non-string connectionID!'));
                    var connectionInfo = JDeltaSync.connectionInfo(syncServer.joinDB.getState('/'), connectionID);
                    if(!connectionInfo) return onError(new Error('Logout: connectionID not found: '+connectionID));
                    if(browserID !== connectionInfo.browserID) return onError(new Error('Logout: Wrong browserID!'));
                    syncServer.clientLogout(connectionID, req, function() {
                        res.setHeader('Content-Type', 'application/json');
                        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
                        res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.
                        res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
                        res.end('{}');
                        onSuccess();
                    }, onError);
                    break;

                default: return onError(new Error('Invalid op!'));
            }



        };
        var browserID = res.SWCS_get('JDelta_BrowserID');

        if(browserID) {
            return afterWeHaveABrowserID(browserID);
        } else {
            while(true) {
                browserID = JDelta._generateID();
                if(!JDeltaSync.browserInfo(syncServer.joinDB.getState('/'), browserID)) break; // check for collision
            }
            return syncServer._join_addBrowser(browserID, function() {
                res.SWCS_set('JDelta_BrowserID', browserID);
                return afterWeHaveABrowserID(browserID);
            });
        }
    }));
};
JDeltaSync.sebwebHandler_clientReceive = function(syncServer) {
    var sebweb = require('sebweb');
    return sebweb.CookieStore(syncServer.options.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        var url = URL.parse(req.url, true);
        var connectionID = url.query.connectionID;
        if(!_.isString(connectionID))
            return onError(new Error('connectionID is not a string'));

        var alluserState = syncServer.joinDB.getState('/');
        var connectionInfo = JDeltaSync.connectionInfo(alluserState, connectionID);
        if(!connectionInfo) {
            // This occurs when a client goes to sleep for a long time and then wakes up again (after their stale connection has already been cleared).  It is safe to allow the user to login() again and resume where they left off.
            res.statusCode = 401;  // Unauthorized.
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            return onError(new Error('connectionID not found: '+connectionID));
        }
        var browserID = res.SWCS_get('JDelta_BrowserID');
        if(!browserID  ||  browserID!==connectionInfo.browserID) {
            // This occurs when a client IP address changes.  OR if a cookie gets hijacked.  The user should log back in and re-authenticate.
            res.statusCode = 403;  // Forbidden.
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            if(!browserID) return onError(new Error('No browserID: '+browserID));
            return onError(new Error('browserID did not match! '+browserID+' != '+connectionInfo.browserID));
        }
        
        syncServer.clientReceive(connectionID, req, function(result) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            res.end(JSON.stringify(result));
            onSuccess();
        }, onError);
    });
};
JDeltaSync.sebwebHandler_clientSend = function(syncServer) {
    var sebweb = require('sebweb');
    return sebweb.BodyParser(sebweb.CookieStore(syncServer.options.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        var connectionIDArray = req.formidable_form.fields.connectionID;
        if(!_.isArray(connectionIDArray)) {
            var err = new Error('No connectionID!');
            if(onError) return onError(err);
            else throw err;
        }
        if(connectionIDArray.length !== 1) {
            var err = new Error('Wrong number of connectionIDs');
            if(onError) return onError(err);
            else throw err;
        }
        var connectionID = connectionIDArray[0];
        if(!_.isString(connectionID)) {
            var err = new Error('connectionID is not a string');
            if(onError) return onError(err);
            else throw err;
        }

        var alluserState = syncServer.joinDB.getState('/');
        var connectionInfo = JDeltaSync.connectionInfo(alluserState, connectionID);
        if(!connectionInfo) {
            // This occurs when a client goes to sleep for a long time and then wakes up again (after their stale connection has already been cleared).  It is safe to allow the user to login() again and resume where they left off.
            res.statusCode = 401;  // Unauthorized.
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            return onError(new Error('connectionID not found! '+connectionID));
        }
        var browserID = res.SWCS_get('JDelta_BrowserID');
        if(!browserID  ||  browserID!==connectionInfo.browserID) {
            // This occurs when a client IP address changes.  OR if a cookie gets hijacked.  The user should log back in and re-authenticate.
            res.statusCode = 403;  // Forbidden.
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            if(!browserID) return onError(new Error('No browserID: '+browserID));
            return onError(new Error('browserID did not match: '+browserID+' != '+connectionInfo.browserID));
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
        var result = syncServer.clientSend(req, connectionID, bundle, function(result) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            res.end(JSON.stringify(result));
            onSuccess();
        }, onError);
    }));
};
JDeltaSync._parseRegexString = function(regexStr, expectCaretDollar) {
    if(!_.isString(regexStr))
        throw new Error('Illegal regexStr');
    if(!regexStr.length)
        throw new Error('Blank regexStr');
    if(regexStr.charAt(0)!=='/'  ||  regexStr.charAt(regexStr.length-1)!=='/')
        throw new Error('regexStr missing /^...$/ chars: '+regexStr);
    if(expectCaretDollar) {
        if(regexStr.charAt(1)!=='^'  ||  regexStr.charAt(regexStr.length-2)!=='$')
            throw new Error('regexStr missing ^...$ chars: '+regexStr);
    }
    regexStr = regexStr.substring(1, regexStr.length-1); // Chop off the surrounding '/' chars.
    return RegExp(regexStr);
};
JDeltaSync.sebwebHandler_query = function(syncServer) {
    return function(req, res, onSuccess, onError) {
        var standardOnSuccess = function(result) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin);  // Allow cross-domain requests.
            res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.
            res.end(JSON.stringify(result));
            onSuccess();
        };
        var url = URL.parse(req.url, true);
        switch(url.query.cmd) {

            case 'listStates':
                var type = url.query.type;
                if(!_.isString(type))
                    return onError(new Error('Illegal type'));
                var idsStr = url.query.ids;
                if(!_.isString(idsStr))
                    return onError(new Error('Illegal ids'));
                if(!idsStr.length)
                    return onError(new Error('Blank ids'));
                if(idsStr.charAt(0)!=='['  ||  idsStr.charAt(idsStr.length-1)!==']')
                    return onError(new Error('ids missing [] chars: '+idsStr));
                var ids = JSON.parse(idsStr);
                syncServer.listStates(type, ids, standardOnSuccess, onError);
                break;

            case 'listStatesRegex':
                var type = url.query.type;
                if(!_.isString(type))
                    return onError(new Error('Illegal type'));
                var idRegex
                try {
                    idRegex = JDeltaSync._parseRegexString(url.query.idRegex, true);
                } catch(e) {
                    console.log('Error parsing idRegex:',e);
                    return onError();
                }
                syncServer.listStatesRegex(type, idRegex, standardOnSuccess, onError);
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





JDeltaSync.AccessPolicy_WideOpen = function() {
    if(!(this instanceof JDeltaSync.AccessPolicy_WideOpen)) return new JDeltaSync.AccessPolicy_WideOpen();
};
JDeltaSync.AccessPolicy_WideOpen.prototype.canLogin   = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_WideOpen.prototype.canJoin    = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_WideOpen.prototype.canRead    = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_WideOpen.prototype.canCreate  = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_WideOpen.prototype.canUpdate  = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_WideOpen.prototype.canDelete  = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_WideOpen.prototype.canMessage = function(syncServer, req, connectionID, stateID) { return true; };


JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete = function() {
    if(!(this instanceof JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete)) return new JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete();
};
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canLogin   = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canJoin    = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canRead    = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canCreate  = function(syncServer, req, connectionID, stateID) {
    var connectionInfo = JDeltaSync.connectionInfo(syncServer.joinDB.getState('/'), connectionID);
    return !(connectionInfo.userID in {'__NOUSER__':1});
};
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canUpdate  = JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canCreate;
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canDelete  = JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canCreate;
JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canMessage = function(syncServer, req, connectionID, stateID) { return true; };


JDeltaSync.AccessPolicy_RequireUserIDToUpdate = function() {
    if(!(this instanceof JDeltaSync.AccessPolicy_RequireUserIDToUpdate)) return new JDeltaSync.AccessPolicy_RequireUserIDToUpdate();
};
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canLogin   = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canJoin    = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canRead    = function(syncServer, req, connectionID, stateID) { return true; };
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canCreate  = function(syncServer, req, connectionID, stateID) { return false; };
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canUpdate  = JDeltaSync.AccessPolicy_RequireUserIDToCreateUpdateDelete.prototype.canUpdate;
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canDelete  = function(syncServer, req, connectionID, stateID) { return false; };
JDeltaSync.AccessPolicy_RequireUserIDToUpdate.prototype.canMessage = function(syncServer, req, connectionID, stateID) { return true; };




JDeltaSync.Server = function(stateDB, joinDB, accessPolicy, options) {
    // Guard against forgetting the 'new' operator:
    if(!(this instanceof JDeltaSync.Server)) return new JDeltaSync.Server(stateDB, joinDB, accessPolicy, options);
    if(!stateDB) throw new Error("Expected a 'stateDB' arg.");
    if(!joinDB) throw new Error("Expected a 'joinDB' arg.");

    this.longPollTimeoutMS = 100000;
    this.clientConnectionIdleTime = 1000*60*5;
    this.disposableQueueSizeLimit = 200;
    this.disposableQueueCleanSize = 20;

    this._activeConnections = {};
    this._accessPolicy = accessPolicy || JDeltaSync.WideOpenAccessPolicy();
    this.options = options;

    this._boundJoinDbEventCallback = _.bind(this._joinDbEventCallback, this);

    this._setStateDB(stateDB);
    this._setJoinDB(joinDB);

    this.removeStaleConnectionsInterval = setInterval(_.bind(this._removeStaleConnections, this), 10000);
    //setTimeout(_.bind(this._removeStaleConnectionsFromJoins, this), this.clientConnectionIdleTime+30000);  // An extra 30 seconds padding so we don't conflict with the above interval.
};
JDeltaSync.Server.prototype._joinDbEventCallback = function(id, data) {
    data['id'] = id;
    data['type'] = 'join';
    this._broadcast({data:data});
};
JDeltaSync.Server.prototype._setStateDB = function(stateDB) {
    if(this.stateDB) throw new Error('Not implemented yet.');
    this.stateDB = stateDB || new JDeltaDB.DB();
};
JDeltaSync.Server.prototype._setJoinDB = function(joinDB) {
    var self = this;
    if(this.joinDB) throw new Error('Not implemented yet.');
    this.joinDB = joinDB || new JDeltaDB.DB();

    this.joinDB.waitForLoad(function(joinDB) {
        // Do some initialization of things that definitely need to be there:
        if(!joinDB.contains('/')) joinDB.createState('/');
        var alluserState = joinDB.getState('/');
        if(!alluserState.hasOwnProperty('__NOUSER__'))
            joinDB.edit('/', [{op:'create', key:'__NOUSER__', value:{}}]);

        // Also initialize our activeConnections so there is no loss of data while our clients reconnect:
        var connections = JDeltaSync.allConnections(alluserState),
            i, ii;
        for(i=0, ii=connections.length; i<ii; i++) {
            self._getActiveClientConnection(connections[i]);
        }
    });

    this.joinDB.on(JDeltaSync.MATCH_ALL_REGEX, '!', this._boundJoinDbEventCallback);
};
JDeltaSync.Server.prototype._getDB = JDeltaSync.Client.prototype._getDB;
JDeltaSync.Server.prototype._removeStaleConnections = function() {
    var curTime = new Date().getTime(),
        conn, connTime;
    for(var connectionID in this._activeConnections) if(this._activeConnections.hasOwnProperty(connectionID)) {
        conn = this._activeConnections[connectionID];
        connTime = conn.lastActivityTime  || 0;
        if(curTime - connTime  >  this.clientConnectionIdleTime) {
            if(typeof console !== 'undefined') console.log('Removing Stale Connection:',connectionID);

            // Remove the connection from the JoinDB:
            var connectionInfo = JDeltaSync.connectionInfo(this.joinDB.getState('/'), connectionID);
            if(connectionInfo)  // It's null when things get out of sync.
                this._join_removeConnection(connectionInfo.userID, connectionInfo.browserID, connectionID);

            // Also remove from the activeConnections:
            if(conn.req  &&  !conn.req.socket.destroyed) conn.req.destroy();
            if(conn.sendToLongPoll) conn.sendToLongPoll();  // Allow the connection to clean up.
            delete this._activeConnections[connectionID];
        }
    }
};
//JDeltaSync.Server.prototype._removeStaleConnectionsFromJoins = function() {
//    var alluserState = this.joinDB.getState('/');
//    var allConnections = JDeltaSync.allConnections(alluserState),
//        i, ii, cID, cInfo;
//    for(i=0, ii=allConnections.length; i<ii; i++) {
//        cID = allConnections[i];
//        if(!this._activeConnections.hasOwnProperty(cID)) {
//            if(typeof console !== 'undefined') console.log('Removing Stale Connection from Joins:',cID);
//            cInfo = JDeltaSync.connectionInfo(alluserState, cID);
//            this._join_removeConnection(cInfo.userID, cInfo.browserID, cID);
//        }
//    }
//};
JDeltaSync.Server.prototype.installIntoSebwebRouter = function(router, baseURL) {
    if(!_.isString(baseURL)) throw new Error('Expected a baseURL');
    if(!baseURL.length) throw new Error('Empty baseURL!');
    if(baseURL.charAt(0) !== '/') throw new Error("baseURL should start with '/'.");
    if(baseURL.charAt(baseURL.length-1) === '/') throw new Error("baseURL should not end with '/'.");
    router.prependRoutes([
        {path:'^'+baseURL+'/query$',         func:JDeltaSync.sebwebHandler_query(this)},
        {path:'^'+baseURL+'/clientLogin$',   func:JDeltaSync.sebwebHandler_clientLogin(this)},
        {path:'^'+baseURL+'/clientReceive$', func:JDeltaSync.sebwebHandler_clientReceive(this)},
        {path:'^'+baseURL+'/clientSend$',    func:JDeltaSync.sebwebHandler_clientSend(this)}
    ]);
};
JDeltaSync.Server.prototype._listApplicableJoinStates = function(id) {
    var joinNames = [],
        total = '/',
        i, ii;
    var idPieces = id.split('/');
    if(!idPieces.length) {
        console.log(new Error('No idPieces!'));
        return [];
    }
    if(idPieces[0] !== '') {
        console.log(new Error('id did not have a leading slash.'));
        return [];
    }
    idPieces.shift();
    
    // The initial '/' path is a bit of a special case... it doesn't fit into the following loop very well.  So handle it here.
    if(this.joinDB.getState(total)) joinNames[joinNames.length] = total;

    for(i=0, ii=idPieces.length; i<ii; i++) {
        if(i !== 0) total += '/';
        total += idPieces[i];
        if(this.joinDB.contains(total)) joinNames[joinNames.length] = total;
    }
    return joinNames;
};
JDeltaSync.Server.prototype._broadcast = function(item, to, excludes) {
    var targetConnections = {},
        i, ii;
    if(to) {
        var joinState, info, j, jj;
        if(to.connectionIDs) {
            for(i=0, ii=to.connectionIDs.length; i<ii; i++) {
                targetConnections[to.connectionIDs[i]] = true;
            }
        }
        if(to.browserIDs) {
            if(!joinState) joinState = this.joinDB.getState('/');
            for(i=0, ii=to.browserIDs.length; i<ii; i++) {
                info = JDeltaSync.browserInfo(joinState, to.browserIDs[i]);
                for(j=0, jj=info.connectionIDs.length; j<jj; j++) {
                    targetConnections[info.connectionIDs[j]] = true;
                }
            }
        }
        if(to.userIDs) {
            if(!joinState) joinState = this.joinDB.getState('/');
            for(i=0, ii=to.userIDs.length; i<ii; i++) {
                info = JDeltaSync.userInfo(joinState, to.userIDs[i]);
                for(j=0, jj=info.connectionIDs.length; j<jj; j++) {
                    targetConnections[info.connectionIDs[j]] = true;
                }
            }
        }
    } else {
        var type = item.data.type || 'state';  // Right now, the only type of item that will be broadcast and does not have a type are Messages.  Send them to state subscribers.
        var typeCode = {state:'S', join:'J'}[type];
        var joinNames = this._listApplicableJoinStates(item.data.id),
            minDepth, joinState, connectionIDs, j, jj;
        for(i=0, ii=joinNames.length; i<ii; i++) {
            if(joinNames[i] === item.data.id) minDepth = 's';
            else minDepth = 'r';
            joinState = this.joinDB.getState(joinNames[i]);
            connectionIDs = JDeltaSync.allConnections(joinState, typeCode, minDepth);
            for(j=0, jj=connectionIDs.length; j<jj; j++) {
                targetConnections[connectionIDs[j]] = true;
            }
        }
    }

    // Excludes take precedence:
    if(excludes) {
        for(var x in excludes) if(excludes.hasOwnProperty(x)) {
            delete targetConnections[x];
        }
    }

    // Do the broadcast:
    var clientConn, q;
    for(var cID in targetConnections) if(targetConnections.hasOwnProperty(cID)) {
        if(this._activeConnections.hasOwnProperty(cID)) {
            clientConn = this._activeConnections[cID];
            q = clientConn.queue;
            if(item.importance === 'disposable'  &&  q.length > this.disposableQueueSizeLimit) {
                var disposables = [];
                for(i=0, ii=q.length; i<ii; i++) {
                    if(q[i].importance === 'disposable') {
                        disposables[disposables.length] = i;
                        if(disposables.length >= this.disposableQueueCleanSize)
                            break;
                    }
                }
                for(i=disposables.length; i>=0; i--) {
                    q.splice(disposables[i], 1);
                }
                if(q.length > this.disposableQueuSizeLimit) return;
            }
            q[q.length] = item;
            if(clientConn.sendToLongPoll) clientConn.sendToLongPoll();
        }
    }
};
JDeltaSync.Server.prototype._getActiveClientConnection = function(connectionID) {
    var clientConn = this._activeConnections[connectionID];
    if(!clientConn) {
        // Any code that gets here already had to pass through a connectionInfo verification layer, so it is safe to auto-create activeConnections (usually absent due to server restarts).
        // Actually, this should no longer occur since I now auto-create all connnections at server startup.   Hmmm.. Maybe it might occur when a computer goes to sleep and wakes up.
        console.log('(Does this ever happen???) Auto-creating connection that was not in active connetions, but passed security:',connectionID);
        this._activeConnections[connectionID] = clientConn = {queue:[]};
    }
    clientConn.lastActivityTime = new Date().getTime();
    return clientConn;
};
JDeltaSync.Server.prototype._join_addConnection = function(userID, browserID, connectionID) {
    var alluserState = this.joinDB.getState('/');
    if(JDeltaSync.connectionInfo(alluserState, connectionID)) throw new Error('connectionID already exists!');
    var browserInfo = JDeltaSync.browserInfo(alluserState, browserID);
    if(!browserInfo) throw new Error('browserID does not exist!');
    if(browserInfo.userID !== userID) throw new Error('userID does not match!');
    this.joinDB.edit('/', [{op:'create', path:'$.'+userID+'.'+browserID, key:connectionID, value:JDeltaSync.Silent}]);

    //// 2012-08-17: I believe it was a mistake to add the connection to all states because the behavior is not consistent.  If i really want to do this, then I need to copy all connections whenever a user joins a state... otherwise you only end up with a partial list of connections.  So rather than partial, i'd prefer to have nothing.
    //var states = this.joinDB.listStates(),
    //    i, ii;
    //for(i=0, ii=states.length; i<ii; i++) {
    //    if(states[i] === '/') continue;  // Already done above.
    //    if(JDeltaSync.browserInfo(this.joinDB.getState(states[i]), browserID)) {
    //        // This state has info about the affected browserID.  Edit.
    //        this.joinDB.edit(states[i], [{op:'create', path:'$.'+userID+'.'+browserID, key:connectionID, value:JDeltaSync.Silent}]);
    //    }
    //}
};
JDeltaSync.Server.prototype._join_removeConnection = function(userID, browserID, connectionID) {
    var alluserState = this.joinDB.getState('/');
    var connectionInfo = JDeltaSync.connectionInfo(alluserState, connectionID);
    if(!connectionInfo) throw new Error('connectionID not found!');
    if(connectionInfo.browserID !== browserID) throw new Error('browserID does not match!');
    if(connectionInfo.userID !== userID) throw new Error('userID does not match!');
    this.joinDB.edit('/', [{op:'delete', path:'$.'+userID+'.'+browserID, key:connectionID}]);
    var states = this.joinDB.listStates(),
        state, i, ii;
    for(i=0, ii=states.length; i<ii; i++) {
        if(states[i] === '/') continue;  // Already done above.
        state = this.joinDB.getState(states[i]);
        connectionInfo = JDeltaSync.connectionInfo(state, connectionID);
        if(connectionInfo) {
            this.joinDB.edit(states[i], [{op:'delete', path:'$.'+userID+'.'+browserID, key:connectionID}]);
        }
    }
};
JDeltaSync.Server.prototype._join_addBrowser = function(browserID, onSuccess, onError) {
    var alluserState = this.joinDB.getState('/');
    if(JDeltaSync.browserInfo(alluserState, browserID)) throw new Error('browserID already exists!');
    this.joinDB.edit('/', [{op:'create', path:'$.__NOUSER__', key:browserID, value:{}}], null, onSuccess, onError);
};
JDeltaSync.Server.prototype._join_changeUserID = function(browserID, oldUserID, newUserID) {
    if(!_.isString(newUserID)) throw new Error('Invalid newUserID');
    if(!newUserID.length) throw new Error('Blank newUserID');
    var alluserState = this.joinDB.getState('/');
    var browserInfo = JDeltaSync.browserInfo(alluserState, browserID);
    if(oldUserID !== browserInfo.userID) throw new Error('Wrong oldUserID!');
    var browserEntry = alluserState[oldUserID][browserID];
    if(!browserEntry) throw new Error('No browserEntry!');  // Should never happen.
    var ops = [];
    if(!(newUserID in alluserState)) ops[ops.length] = {op:'create', key:newUserID, value:{}};
    ops[ops.length] = {op:'create', path:'$.'+newUserID, key:browserID, value:browserEntry};
    ops[ops.length] = {op:'delete', path:'$.'+oldUserID, key:browserID};
    this.joinDB.edit('/', ops);
    var states = this.joinDB.listStates(),
        state, i, ii;
    for(i=0, ii=states.length; i<ii; i++) {
        if(states[i] === '/') continue;  // Already done above.
        state = this.joinDB.getState(states[i]);
        browserInfo = JDeltaSync.browserInfo(state, browserID);
        if(browserInfo) {
            browserEntry = state[oldUserID][browserID];
            ops = [];
            if(!(newUserID in state)) ops[ops.length] = {op:'create', key:newUserID, value:{}};
            ops[ops.length] = {op:'create', path:'$.'+newUserID, key:browserID, value:browserEntry};
            ops[ops.length] = {op:'delete', path:'$.'+oldUserID, key:browserID};
            this.joinDB.edit(states[i], ops);
        }
    }
};
JDeltaSync.Server.prototype.clientLogin = function(browserID, req, onSuccess, onError) {
    var alluserState = this.joinDB.getState('/'),
        connectionID;
    while(true) {
        connectionID = JDelta._generateID();
        if(!JDeltaSync.connectionInfo(alluserState, connectionID)) break;
    }
    console.log('New Connection:', browserID, connectionID);
    var browserInfo = JDeltaSync.browserInfo(alluserState, browserID);
    this._join_addConnection(browserInfo.userID, browserID, connectionID);
    return onSuccess({connectionID:connectionID});
};
JDeltaSync.Server.prototype.clientLogout = function(connectionID, req, onSuccess, onError) {
    var alluserState = this.joinDB.getState('/');
    var connectionInfo = JDeltaSync.connectionInfo(alluserState, connectionID);
    if(!connectionInfo) return onError(new Error('connectionID not found!'));
    this._join_removeConnection(connectionInfo.userID, connectionInfo.browserID, connectionID);
    return onSuccess();
};
JDeltaSync.Server.prototype.clientReceive = function(connectionID, req, onSuccess, onError) {
    var self = this;
    var clientConn = this._getActiveClientConnection(connectionID);

    // Check whether there is an old long-poll function waiting to be called:
    if(clientConn.sendToLongPoll) {
        // The connection should be dead:
        if(!clientConn.req.socket.destroyed) {
            console.log('DESTROYING OLD REQEST.  (Should not typically occur.)');  // This does not usually occur.  The only normal way I have found this to occur is in Chrome.  For some reason, Chrome does not seem to close its sockets after a timeout.  Instead, it collects a bunch of zombie sockets and the closes them all at once... Still trying to find a solution to that...
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
            clientConn.lastActivityTime = new Date().getTime();
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
            if(clientConn.sendToLongPoll === sendToLongPoll) {
                if(clientConn.queue.length) {
                    console.log('During force-timeout, the queue was non-empty!  This should not happen.');
                }
                sendToLongPoll();
            }
        }, self.longPollTimeoutMS);
    }
};
JDeltaSync.Server.prototype.clientSend = function(req, connectionID, bundle, onSuccess, onError) {
    var self = this,
        chain = [],
        result = [],
        i, ii, db;
    this._getActiveClientConnection(connectionID);  // Trigger the lastActivityTime update that occurs in the _getActiveClientConnection function.
    for(i=0, ii=bundle.length; i<ii; i++) {
        chain[chain.length] = (function(bundleItem) {
            return function(next, onError) {
                var OK = function() {
                        result[result.length] = {msgID:bundleItem.msgID, result:'ok'};
                        return next();
                    },
                    FAIL = function(err) {
                        result[result.length] = {msgID:bundleItem.msgID, result:'fail', details:err};
                        console.log('clientSend FAIL:',result[result.length-1]);
                        return next();
                    },
                    excludes = {};
                excludes[connectionID] = true;  // I need to use this two-step process because javascript does not work right if I just say {connectionID:true} because it uses 'connectionID' as the key.
                switch(bundleItem.data.op) {

                    case 'createState':
                        if(bundleItem.data.type !== 'state') return FAIL('type!=state'); // Client modification of Join states not allowed.
                        if(!self._accessPolicy.canCreate(self, req, connectionID, bundleItem.data.id)) return FAIL('Access Denied');
                        db = self._getDB(bundleItem.data.type);
                        if(db.contains(bundleItem.data.id)) {
                            console.log('State already exists: '+bundleItem.data.id);
                            return FAIL('exists');
                        } else {
                            db.createState(bundleItem.data.id);
                            self._broadcast(bundleItem, null, excludes);
                            return OK();
                        }
                        break;

                    case 'deltaApplied':
                        if(bundleItem.data.type !== 'state') return FAIL('type!=state'); // Client modification of Join states not allowed.
                        if(!self._accessPolicy.canUpdate(self, req, connectionID, bundleItem.data.id)) return FAIL('Access Denied');

                        if(!bundleItem.data.delta) return FAIL("No 'delta'");
                        if(!bundleItem.data.delta.meta) return FAIL("No 'meta'");
                        var from = bundleItem.data.delta.meta.from;
                        if(!from) return FAIL("No 'from'");
                        if(!from.userID) return FAIL("No 'userID'");
                        if(!from.browserID) return FAIL("No 'browserID'");
                        if(!from.connectionID) return FAIL("No 'connectionID'");
                        var cInfo = JDeltaSync.connectionInfo(self.joinDB.getState('/'), connectionID);
                        if(!cInfo) return FAIL("connectionID not found!");
                        if(from.userID!==cInfo.userID  ||  from.browserID!==cInfo.browserID  ||  from.connectionID!==cInfo.connectionID)
                            return FAIL("'from' does not match!");

                        db = self._getDB(bundleItem.data.type);
                        try {
                            db._addHashedDelta(bundleItem.data.id, bundleItem.data.delta, function() {
                                self._broadcast(bundleItem, null, excludes);
                                return OK();
                            }, FAIL);
                        } catch(e) {
                            return FAIL(e);
                        }
                        break;

                    case 'deleteState':
                        if(bundleItem.data.type !== 'state') return FAIL('type!=state'); // Client modification of Join states not allowed.
                        if(!self._accessPolicy.canDelete(self, req, connectionID, bundleItem.data.id)) return FAIL('Access Denied');
                        db = self._getDB(bundleItem.data.type);
                        db.deleteState(bundleItem.data.id, function() {
                            self._broadcast(bundleItem, null, excludes);
                            return OK();
                        }, FAIL);
                        break;

                    case 'join':
                        if(!self._accessPolicy.canJoin(self, req, connectionID, bundleItem.data.id)) return FAIL('Access Denied');
                        self.clientJoin(connectionID, bundleItem.data.id, bundleItem.data.subscribeMode, OK, FAIL);
                        break;

                    case 'leave':
                        self.clientLeave(connectionID, bundleItem.data.id, OK, FAIL);
                        break;

                    case 'sendMessage':
                        if(!self._accessPolicy.canMessage(self, req, connectionID, bundleItem.data.id)) return FAIL('Access Denied');
                        var message = {msgID:bundleItem.msgID, importance:bundleItem.data.importance, data:{op:'message', id:bundleItem.data.id, data:bundleItem.data.data, from:JDeltaSync.connectionInfo(self.joinDB.getState('/'), connectionID)}};
                        self._broadcast(message, bundleItem.data.to, excludes);
                        return OK();
                        break;

                    default:
                        console.log('Unknown clientSend op: '+bundleItem.data.op);
                        return FAIL('Unknown op');
                }
            };
        })(bundle[i]);
    }
    JDeltaDB._runAsyncChain(chain, function() {
        onSuccess(result);
    }, onError);
};
JDeltaSync.Server.prototype.clientJoin = function(connectionID, stateID, subscribeMode, onSuccess, onError) {
    if(!this.joinDB.contains(stateID)) this.joinDB.createState(stateID);
    var state = this.joinDB.getState(stateID);
    var connectionInfo = JDeltaSync.connectionInfo(this.joinDB.getState('/'), connectionID);
    if(!connectionInfo) {
        var err = new Error('connectionID not found!');
        if(onError) return onError(err);
        else throw err;
    }
    var ops = [];
    if(!state.hasOwnProperty(connectionInfo.userID)) {
        var entry = {};
        entry[connectionInfo.browserID] = {};
        entry[connectionInfo.browserID][connectionID] = subscribeMode;
        ops[ops.length] = {op:'create', key:connectionInfo.userID, value:entry};
    } else if(!state[connectionInfo.userID].hasOwnProperty(connectionInfo.browserID)) {
        var entry = {};
        entry[connectionID] = subscribeMode;
        ops[ops.length] = {op:'create', path:'$.'+connectionInfo.userID, key:connectionInfo.browserID, value:entry};
    } else {
        ops[ops.length] = {op:'update!', path:'$.'+connectionInfo.userID+'.'+connectionInfo.browserID, key:connectionID, value:subscribeMode};
    }
    return this.joinDB.edit(stateID, ops, null, onSuccess, onError);
};
JDeltaSync.Server.prototype.clientLeave = function(connectionID, stateID, onSuccess, onError) {
    // Never leave the global state.  Just switch the subscription mode to silent:
    if(stateID === '/') return this.clientJoin(connectionID, stateID, JDeltaSync.Silent, onSuccess, onError);
    var state = this.joinDB.getState(stateID);
    var connectionInfo = JDeltaSync.connectionInfo(state, connectionID);
    if(!connectionInfo) {
        var err = new Error('not joined!');
        if(onError) return onError(err);
        else throw err;
    }
    this.joinDB.edit(stateID, [{op:'delete', path:'$.'+connectionInfo.userID+'.'+connectionInfo.browserID, key:connectionID}], null, onSuccess, onError);
};
JDeltaSync.Server.prototype.listStates = function(type, ids, onSuccess, onError) {
    if(!_.isArray(ids)) {
        var err = new Error('ids should be an Array!');
        if(onError) return onError(err);
        else throw err;
    }
    var tracker = JDeltaDB._AsyncTracker(onSuccess),
        db = this._getDB(type);
    var i, ii;
    for(i=0, ii=ids.length; i<ii; i++) {
        if(tracker.thereWasAnError) break;
        if(!db.contains(ids[i])) continue;
        tracker.numOfPendingCallbacks++;
        db._storage.getLastDelta(ids[i], function(id, delta) {
            tracker.out[tracker.out.length] = {type:type, id:id, lastDeltaSeq:delta.seq, lastDeltaHash:delta.curHash};
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
JDeltaSync.Server.prototype.listStatesRegex = function(type, idRegex, onSuccess, onError) {
    if(!_.isRegExp(idRegex)) {
        var err = new Error('idRegex should be a RegExp!');
        if(onError) return onError(err);
        else throw err;
    }
    var self = this;
    var tracker = JDeltaDB._AsyncTracker(onSuccess),
        db = this._getDB(type);
    db.iterStates(idRegex, function(id, state) {
        if(tracker.thereWasAnError) return;
        tracker.numOfPendingCallbacks++;
        db._storage.getLastDelta(id, function(id, delta) {
            tracker.out[tracker.out.length] = {type:type, id:id, lastDeltaSeq:delta.seq, lastDeltaHash:delta.curHash};
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
    // [{type:'state', id:'a', startSeq:3, endSeq:5},  // Using a query structure like this allows us to minimize # of SQL queries that we need to perform.
    //  {type:'state', id:'b', seq:9}];                //
    if(!_.isArray(items)) {
        var err = new Error('items should be an Array!');
        if(onError) return onError(err);
        else throw err;
    }
    var self = this,
        chain = [],
        results = [],
        i, ii;
    for(i=0, ii=items.length; i<ii; i++) {
        chain[chain.length] = (function(i) {
            return function(next, onError) {
                var type, db, id, seq;
                type = items[i].type;
                if(!_.isString(type)) return onError(new Error('non-string type'));
                db = self._getDB(type);
                id = items[i].id;
                if(!_.isString(id)) return onError(new Error('non-string id'));
                if(!db.contains(id)) return;
                seq = items[i].seq;
                if(seq) {
                    db._storage.getDelta(id, seq, function(id, delta) {
                        results[results.length] = {type:type, id:id, delta:delta};
                        return next();
                    }, onError);
                } else {
                    db._storage.getDeltas(id, items[i].startSeq, items[i].endSeq, function(id, deltas) {
                        if(!items[i].startSeq) {
                            // The startSeq is undefined or 0.  Include the pseudo-delta.  Allows the requestor to know about empty states:
                            results[results.length] = {type:type, id:id, delta:JDeltaDB._PSEUDO_DELTA_0};
                        }
                        var j, jj;
                        for(j=0, jj=deltas.length; j<jj; j++)
                            results[results.length] = {type:type, id:id, delta:deltas[j]};
                        return next();
                    }, onError);
                }
            };
        })(i);
    }
    JDeltaDB._runAsyncChain(chain, function() {
        return onSuccess(results);
    }, onError);
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
