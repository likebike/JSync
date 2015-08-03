"use strict";
(function() {

// First, install ourselves and import our dependencies:
var JSync,  // We re-use the JSync namespace.
    _,
    fs,
    PATH,
    undefined;  // So 'undefined' really is undefined.
if(typeof exports !== 'undefined') {
    // We are in Node.
    JSync = require('./JSync.js').JSync;
    _ = require('underscore');
    fs = require('fs');
    PATH = require('path');

    // Between NodeJS v0.10 and v0.12, path.exists/Sync moved to fs.exists/Sync .
    // Apply a compatibility monkey patch:
    fs.exists = fs.exists || PATH.exists;
    fs.existsSync = fs.existsSync || PATH.existsSync;

    // Bring the Node 0.6 API up to the 0.8 API for path.sep:
    if(!PATH.sep) {
        PATH.sep = global.process.platform === 'win32' ? '\\' : '/';
    }

} else throw new Error('This environment is not yet supported.');


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This first section deals with storage and retreival of JSync States.
//

JSync.RamDB = function(path) {
    if(!(this instanceof JSync.RamDB)) return new JSync.RamDB(path);
    this._states = {};
    this._path = path;
    if(this._path) this._path = PATH.resolve(this._path);
    this._loadSync();
    this.save = _.debounce(_.bind(this._rawSaveSync, this), 1000);
};
JSync.RamDB.prototype._loadSync = function() {  // Synchronous loading is OK because we usually only do this at server startup.
    if(!this._path) return;
    if(fs.existsSync(this._path)) {
        var data = JSON.parse(fs.readFileSync(this._path)),
            k;
        for(k in data) if(data.hasOwnProperty(k)) {
            this._states[k] = JSync.State(data[k]);
        }
    }
};
JSync.RamDB.prototype._rawSaveSync = function() {
    if(!this._path) return;
    var newPath = this._path + '.new',
        outObj = {},
        k;
    for(k in this._states) if(this._states.hasOwnProperty(k)) {
        outObj[k] = this._states[k].data;
    }
    fs.writeFileSync(newPath, JSync.stringify(outObj, undefined, 2));
    fs.renameSync(newPath, this._path);
};
JSync.RamDB.prototype.existsSync = function(id) {
    return this._states.hasOwnProperty(id);
};
JSync.RamDB.prototype.exists = function(id, callback) {
    return callback(this.existsSync(id));
};
JSync.RamDB.prototype.listIDs = function(callback) {
    var ids = [],
        k;
    for(k in this._states) if(this._states.hasOwnProperty(k)) {
        ids[ids.length] = k;
    }
    ids.sort();
    return callback(ids);
};
JSync.RamDB.prototype.createStateSync = function(id, state) {
    if(this.existsSync(id)) throw new Error('Already exists: '+id);
    this._states[id] = state || JSync.State();
};
JSync.RamDB.prototype.deleteState = function(id, onSuccess, onError) {
    var self = this;
    this.exists(id, function(exists) {
        if(!exists) {
            var err = new Error('Does not exists: '+id);
            if(onError) return onError(err);
            throw err;
        }
        var state = self._states[id];
        state.off(JSync.ALL);
        delete self._states[id];
        self.save();
        return onSuccess();
    });
};




///// I don't know if we need any locks in this implementation...
//JSync.RamDB.prototype.acquireLock = function(alreadyLocked, callback) {
//    console.log('acquireLock...');
//    if(alreadyLocked) {
//        console.log('Already own lock.  Calling...');
//        return callback(function() {});
//    }
//    if(!this._lockQueue) this._lockQueue = [];  // I initialize this way so I can just inherit these three functions in subclasses and get this functionality, without requiring any setup in the constructor.
//
//    this._lockQueue[this.lockQueue.length] = callback;
//
//    if(!this.lockKey) {
//        console.log('No lock.  Running immediately.');
//        return this._nextLockCB();
//    }
//    console.log('Adding to lock queue.');
//    //console.trace();
//};
//JSync.RamDB.prototype._nextLockCB = function() {
//    console.log('nextLockCB...');
//    var self = this;
//    if(this.lockKey) throw new Error('NextLockCB called while previous lock exists!');
//     //////////// I stoppped here.  More to do, if I need this.
//     /// I was thinking that maybe the locks could be implemented as a slide.chain...
//};


JSync.DirDB = function(path) {
    if(!(this instanceof JSync.DirDB)) return new JSync.DirDB(path);
};





/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This second section implements a JSync network server.
//



JSync._setCorsHeaders = function(req, res, syncServer) {
    // I do this same thing in several places, so I am turning it into a function.
    res.setHeader('Access-Control-Allow-Origin', syncServer.options.accessControlAllowOrigin || req.headers.origin || req.headers.referer);  // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).   ///// NOTE 2015-08-01: Client requests do not contain the 'Origin' header because they are not cross-domain requests.  I am adding 'Referer' as another option.
    res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.  ...otherwise, javascript can't access the response body.
};
JSync._setJsonResponseHeaders = function(res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
};



var AP_TRUE = function(syncServer, req, connectionID, browserID, stateID) { return true; },
    AP_FALSE = function(syncServer, req, connectionID, browserID, stateID) { return false; };

JSync.AccessPolicy_WideOpen = function() {
    if(!(this instanceof JSync.AccessPolicy_WideOpen)) return new JSync.AccessPolicy_WideOpen();
};
JSync.AccessPolicy_WideOpen.prototype.canCreate = AP_TRUE;
JSync.AccessPolicy_WideOpen.prototype.canDelete = AP_TRUE;
JSync.AccessPolicy_WideOpen.prototype.canRead   = AP_TRUE;
JSync.AccessPolicy_WideOpen.prototype.canUpdate = AP_TRUE;

JSync.AccessPolicy_NoClientEdits = function() {
    if(!(this instanceof JSync.AccessPolicy_NoClientEdits)) return new JSync.AccessPolicy_NoClientEdits();
};
JSync.AccessPolicy_NoClientEdits.prototype.canCreate = AP_FALSE;
JSync.AccessPolicy_NoClientEdits.prototype.canDelete = AP_FALSE;
JSync.AccessPolicy_NoClientEdits.prototype.canRead   = AP_TRUE;
JSync.AccessPolicy_NoClientEdits.prototype.canUpdate = AP_FALSE;


JSync.Server = function(stateDB, accessPolicy, options) {
    if(!(this instanceof JSync.Server)) return new JSync.Server(stateDB, accessPolicy, options);
    if(!stateDB) throw new Error('Expected a stateDB arg.');
    
    this.longPollTimeoutMS = 100000;
    this.connectionStaleTime = 1000*60*5;
    this.disposableQueueSizeLimit = 200;

    this.accessPolicy = accessPolicy || JSync.AccessPolicy_WideOpen();
    this.options = options;

    this._activeConnections = {};
    this.setStateDB(stateDB);

    this.removeStaleConnectionsInterval = setInterval(_.bind(this._removeStaleConnections, this), 10000);
};
JSync.Server.prototype.setStateDB = function(stateDB) {
    if(!stateDB) throw new Error('Null stateDB');
    if(this.stateDB) throw new Error('Not implemented yet.');  // When replacing a stateDB, you would need to unregister callback, re-load currently-used states... etc.
    this.stateDB = stateDB;
    // We assume that stateDB is loaded/created synchronously.  Therefore, we don't need to make use of a waitForLoad() function to get accurate data.
    // Initialize our activeConnections so there is no loss of data while our clients reconnect after a server restart:
    console.log('Need to implement activeConnection reloading...');
    stateDB.on(this._stateDBEventCallback, this);
};
JSync.Server._removeStaleConnections = function() {
    var curTime = new Date().getTime(),
        conn, connTime, connectionID;
    for(connectionID in this._activeConnections) if(this._activeConnections.hasOwnProperty(connectionID)) {
        conn = this._activeConnections[connectionID];
        connTime = conn.lastActivityTime || 0;
        if(curTime - connTime > this.connectionStaleTime) {
            console.log('Removing Stale Connection:', connectionID);

            // Remove the connection from the __CONNECTIONS__ state:
            console.log('TODO: remove connection from __CONNECTIONS__');

            // Also remove from the activeConnections:
            if(conn.req  &&  !conn.req.socket.destroyed) conn.req.destroy();
            if(conn.sendToLongPoll) conn.sendToLongPoll();  // Allow the connection to clean up.
            delete this._activeConnections[connectionID];
        }
    }
};
JSync.Server.clientConnect = function(browserID, req, onSuccess, onError) {
    var connectionID;
    while(true) {
        connectionID = JSync.generateID();
        if(!this.connectionInfo(connectionID)) break;
    }
    console.log('New Connection: browserID='+browserID+' connectionID='+connectionID);
    this._addConnection(browserID, connectionID);
    return onSuccess({browserID:browserID, connectionID:connectionID});
};
JSync.Server.clientDisconnect = function(connectionID, req, onSuccess, onError) {
    var connectionInfo = this.connectionInfo(connectionID);
    if(!connectionInfo) return onError(new Error('connectionID not found!'));
    this._removeConnection(connectionInfo.browserID, connectionID);
    return onSuccess();
};


JSync.Server.prototype.installIntoSebwebRouter = function(router, baseURL) {
    if(!_.isString(baseURL)) throw new Error('Expected a baseURL');
    if(!baseURL.length) throw new Error('Empty baseURL!');
    if(baseURL.charAt(0) !== '/') throw new Error("baseURL should start with '/'.");
    if(baseURL.charAt(baseURL.length-1) === '/') throw new Error("baseURL should not end with '/'.");
    router.prependRoutes([
        {path:'^'+baseURL+'/connect$',  func:JSync.sebwebHandler_connect(this)}
    ]);
};
JSync.sebwebHandler_connect = function(syncServer) {
    var sebweb = require('sebweb');
    if(!syncServer.options.sebweb_cookie_secret) throw new Error('You must define syncServer.options.sebweb_cookie_secret!');
    return sebweb.BodyParser(sebweb.CookieStore(syncServer.optioons.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        sebCorsHeaders(req, res, syncServer);
        var afterWeHaveABrowserID = function(browserID) {
            var opArray = req.formidable.fields.op;
            if(!_.isArray(opArray)) return onError(new Error('no op!'));
            if(opArray.length !== 1) return onError(new Error('Wrong number of ops!'));
            var op = opArray[0];
            if(!_.isString(op)) return onError(new Error('non-string op!'));
            switch(op) {
                case 'connect':
                    console.log('Connecting:',browserID);
                    syncServer.clientConnect(browserID, req, function(connectionID) {
                        JSync._setJsonResponseHeaders(res);
                        res.end(JSON.stringify(connectionID));
                        onSuccess();
                    }, onError);    
                    break;

                case 'disconnect':
                    console.log('Disconnecting:',browserID);
                    var connectionIdArray = req.formidable.fields.connectionID;
                    if(!_.isArray(connectionIdArray)) return onError(new Error('no connectionID!'));
                    if(connectionIdArray.length !== 1) return onError(new Error('Wrong number of connectionIDs!'));
                    var connectionID = connectionIdArray[0];
                    if(!_.isString(connectionID)) return onError(new Error('non-string connectionID!'));
                    var connectionInfo = syncServer.connectionInfo(connectionID);
                    if(!connectionInfo) return onError(new Error('Disconnect: connectionID not found: '+connectionID));
                    if(browserID !== connectionInfo.browserID) return onError(new Error('Disconnect: Wrong browserID!'));
                    syncServer.disconnect(connectionID, req, function() {
                        JSync._setJsonResponseHeaders(res);
                        res.end('{}');
                        onSuccess();
                    }, onError);
                    break;

                default: return onError(new Error('Invalid op!'));
            }
        };
        var browserID = res.SWCS_get('JSync_BrowserID');
        if(browserID) {
            if(syncServer.browserInfo(browserID)) return afterWeHaveABrowserID(browserID);
            console.log('BrowserID was provided by client, but not recognized by server:',browserID);
        } else {
            console.log('No BrowserID was provided.');
        }

        // Either no browserID was given, or we did not recognize the given browserID.  Generate a new one:
        while(true) {
            browserID = JSync.generateID();
            if(!syncServer.browserInfo(browserID)) break;  // check for collision
        }
        return syncServer._addBrowser(browserID, function() {
            res.SWCS_set('JSync_BrowserID', browserID);
            return afterWeHaveABrowserID(browserID);
        });
    }, syncServer.options.sebweb_cookie_options));
};



})();
