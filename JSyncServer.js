"use strict";
(function() {

// First, install ourselves and import our dependencies:
var JSync,  // We re-use the JSync namespace.
    _,
    fs,
    PATH,
    NOOP = function(){},  // Surprisingly useful.
    FAIL = function(err){throw err},
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

JSync.FileDB = function(path, callback) {
    if(!(this instanceof JSync.FileDB)) return new JSync.FileDB(path, callback);
    callback = callback || NOOP;
    this._states = {};
    this._dispatcher = JSync.Dispatcher();
    this._path = PATH.resolve(path);

    this._save = _.debounce(_.bind(this._rawSave, this), 1000);

    var self = this;
    this._load(function() {
        self.on(function() { self._save(); });  // Register the saver after loading so the load events don't trigger another save.
        return callback();
    });
};
JSync.FileDB.prototype._importData = JSync.RamDB.prototype._importData;
JSync.FileDB.prototype._load = function(onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || FAIL;
    var self = this;
    if(!this._path) return onError(new Error('Missing _path!'));
    fs.readFile(this._path, function(err, dataStr) {
        if(err) {
            if(err.code === 'ENOENT') {
                // The path doesn't exist.  This isn't a fatal error.
                console.log('File does not exist:',self._path);
                // Just exit, since there's no data to load:
                return onSuccess();
            }
            return onError(err);
        }
        var data = JSON.parse(dataStr);
        self._importData(data, onSuccess);
    });
};
JSync.FileDB.prototype._exportData = JSync.RamDB.prototype._exportData;
JSync.FileDB.prototype._rawSave = function(onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || FAIL;
    if(!this._path) return onError(new Error('Missing _path!'));
    var self = this,
        newPath = this._path + '.new',
        data = this._exportData(),
        k;
    fs.writeFile(newPath, JSync.stringify(data, undefined, 2), function(err) {
        if(err) return onError(err);
        fs.rename(newPath, self._path, function(err) {
            if(err) return onError(err);
            console.log('Saved:',self._path);
            return onSuccess();
        });
    });
};
JSync.FileDB.prototype.on = JSync.RamDB.prototype.on;
JSync.FileDB.prototype.off = JSync.RamDB.prototype.off;
JSync.FileDB.prototype._stateCallback = JSync.RamDB.prototype._stateCallback;
JSync.FileDB.prototype.exists = JSync.RamDB.prototype.exists;
JSync.FileDB.prototype.listIDs = JSync.RamDB.prototype.listIDs;
JSync.FileDB.prototype.getState = JSync.RamDB.prototype.getState;
JSync.FileDB.prototype.getStateAutocreate = JSync.RamDB.prototype.getStateAutocreate;
JSync.FileDB.prototype.createState = JSync.RamDB.prototype.createState;
JSync.FileDB.prototype.deleteState = JSync.RamDB.prototype.deleteState;




///// I don't know if we need any locks in this implementation...
//JSync.FileDB.prototype.acquireLock = function(alreadyLocked, callback) {
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
//JSync.FileDB.prototype._nextLockCB = function() {
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
// This second section implements a JSync.HttpDB server.
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


JSync.HttpDBServer = function(stateDB, metaDB, accessPolicy, options) {
    if(!(this instanceof JSync.HttpDBServer)) return new JSync.HttpDBServer(stateDB, metaDB, accessPolicy, options);
    
    this.longPollTimeoutMS = 100000;
    this.connectionStaleTime = 1000*60*5;
    this.disposableQueueSizeLimit = 200;

    this.options = options;
    this.accessPolicy = accessPolicy || JSync.AccessPolicy_WideOpen();
    this.setMetaDB(metaDB);
    this.setStateDB(stateDB);

    this.removeStaleConnectionsInterval = setInterval(_.bind(this._removeStaleConnections, this), 10000);
};
JSync.HttpDBServer.prototype.setStateDB = function(stateDB) {
    if(!stateDB) throw new Error('Null stateDB');
    if(this.stateDB) throw new Error('stateDB replacement not implemented yet.');  // When replacing a stateDB, you would need to unregister callback, re-load currently-used states... etc.
    this.stateDB = stateDB;
    stateDB.on(this._stateDBEventCallback, this);
};
JSync.HttpDBServer.prototype.setMetaDB = function(metaDB) {
    if(!metaDB) throw new Error('Null metaDB');
    if(this.metaDB) throw new Error('metaDB replacement not implemented yet.');
    this.metaDB = metaDB;
    metaDB.on(this._metaDBEventCallback, this);
    // Define some states that definitely need to be there:
    metaDB.getStateAutocreate('browsers');
    metaDB.getStateAutocreate('connections');
};
JSync.HttpDBServer.prototype._stateDBEventCallback = function(a,b,c,d,e) {
    console.log('stateDBEventCallback:',a,b,c,d,e);
};
JSync.HttpDBServer.prototype._metaDBEventCallback = function(id,state,op,data) {
    console.log('metaDBEventCallback:',id,state,op,data);
};
JSync.HttpDBServer.prototype.browserInfo = function(browserID, callback) {
    callback = callback || NOOP;
    this.metaDB.getState('browsers', function(state) {
        if(!state.data.hasOwnProperty(browserID)) return callback(null);
        var info = JSync.deepCopy(state.data[browserID]);  // Prevent mutation of state object.
        info.browserID = browserID;
        info.connections = [];
        this.metaDB.getState('connections', function(state) {
            var connectionInfo, connectionID;
            for(connectionID in state.data) if(state.data.hasOwnProperty(connectionID)) {
                connectionInfo = state.data[connectionID];
                if(connectionInfo.browserID === browserID) {
                    info.connections[info.connections.length] = connectionID;
                }
            }
            return callback(info);
        });
    });
};










JSync.HttpDBServer.prototype._removeStaleConnections = function() {
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
JSync.HttpDBServer.prototype.clientConnect = function(browserID, req, onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || FAIL;
    var self = this;
    this.metaDB.getState('connections', function(connections) {
        var connectionID;
        while(true) {
            connectionID = JSync.generateID();
            if(!(connectionID in connections.data)) break;
        }
        console.log('New Connection: browserID='+browserID+' connectionID='+connectionID);
        connections.edit([{op:'create', key:connectionID, value:{browserID:browserID, atime:new Date().getTime()}}]);
        return onSuccess({browserID:browserID, connectionID:connectionID});
    });
};
JSync.HttpDBServer.prototype.clientDisconnect = function(connectionID, req, onSuccess, onError) {
    var connectionInfo = this.connectionInfo(connectionID);
    if(!connectionInfo) return onError(new Error('connectionID not found!'));
    this._removeConnection(connectionInfo.browserID, connectionID);
    return onSuccess();
};


JSync.HttpDBServer.prototype.installIntoSebwebRouter = function(router, baseURL) {
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
    return sebweb.BodyParser(sebweb.CookieStore(syncServer.options.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        JSync._setCorsHeaders(req, res, syncServer);
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
        syncServer.metaDB.getState('browsers', function(browsers) {
            var browserID = res.SWCS_get('JSync_BrowserID');
            if(browserID) {
                if(browserID in browsers.data) return afterWeHaveABrowserID(browserID);
                console.log('BrowserID was provided by client, but not recognized by server:',browserID);
                console.log(_.keys(browsers.data));
            } else {
                console.log('No BrowserID was provided.');
            }

            // Either no browserID was given, or we did not recognize the given browserID.  Generate a new one:
            while(true) {
                browserID = JSync.generateID();
                if(!(browserID in browsers.data)) break;  // check for collision
            }
            browsers.edit([{op:'create', key:browserID, value:{}}]);
            res.SWCS_set('JSync_BrowserID', browserID);
            return afterWeHaveABrowserID(browserID);
        });
    }, syncServer.options.sebweb_cookie_options));
};



})();
