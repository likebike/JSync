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

JSync.FileDB = function(path) {
    if(!(this instanceof JSync.FileDB)) return new JSync.FileDB(path);
    this._states = {};
    this._dispatcher = JSync.Dispatcher();
    this._waiter = JSync.Waiter();
    this._waiter.notReady('READY');
    this._path = PATH.resolve(path);
    this._save = _.debounce(_.bind(this._rawSave, this), 1000);
    this._load();
    var self = this;
    this._waiter.waitReady('FileDB._load', function() {
        self.on(function() { self._save(); });  // Register the saver after loading so the load events don't trigger another save.
        self._waiter.ready('READY')
    });
};
JSync.FileDB.prototype._importData = JSync.RamDB.prototype._importData;
JSync.FileDB.prototype._load = function() {
    var self = this;
    if(!this._path) throw new Error('Missing _path!');
    this._waiter.notReady('FileDB._load');
    var ready = function() { self._waiter.ready('FileDB._load') };
    fs.readFile(this._path, function(err, dataStr) {
        if(err) {
            if(err.code === 'ENOENT') {
                // The path doesn't exist.  This isn't a fatal error.
                console.log('FileDB path does not exist:',self._path);
                // Just exit, since there's no data to load:
                return ready();
            }
            ready();
            throw err;
        }
        var data = JSON.parse(dataStr);
        self._importData(data);
        self._waiter.waitReady('RamDB._importData', ready);
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
            console.log('FileDB Saved:',self._path);
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



JSync.DirDB = function(path) {
    if(!(this instanceof JSync.DirDB)) return new JSync.DirDB(path);
};





/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This second section implements a JSync.WebDB server.
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


JSync.WebDBServer = function(stateDB, metaDB, accessPolicy, options) {
    if(!(this instanceof JSync.WebDBServer)) return new JSync.WebDBServer(stateDB, metaDB, accessPolicy, options);
    
    this.longPollTimeoutMS = 100000;
    this.connectionStaleTime = 1000*60*5;
    this.disposableQueueSizeLimit = 200;

    this.options = options;
    this.accessPolicy = accessPolicy || JSync.AccessPolicy_WideOpen();
    this.setMetaDB(metaDB);
    this.setStateDB(stateDB);

    this.removeStaleConnectionsInterval = setInterval(_.bind(this._removeStaleConnections, this), 10000);
};
JSync.WebDBServer.prototype.setStateDB = function(stateDB) {
    if(!stateDB) throw new Error('Null stateDB');
    if(this.stateDB) throw new Error('stateDB replacement not implemented yet.');  // When replacing a stateDB, you would need to unregister callback, re-load currently-used states... etc.
    this.stateDB = stateDB;
    stateDB.on(this._stateDBEventCallback, this);
};
JSync.WebDBServer.prototype.setMetaDB = function(metaDB) {
    if(!metaDB) throw new Error('Null metaDB');
    if(this.metaDB) throw new Error('metaDB replacement not implemented yet.');
    this.metaDB = metaDB;
    metaDB.on(this._metaDBEventCallback, this);
    // Define some states that definitely need to be there:
    metaDB.getStateAutocreate('browsers');
    metaDB.getStateAutocreate('connections');
};
JSync.WebDBServer.prototype._stateDBEventCallback = function(a,b,c,d,e) {
    console.log('stateDBEventCallback:',a,b,c,d,e);
};
JSync.WebDBServer.prototype._metaDBEventCallback = function(id,state,op,data) {
    console.log('metaDBEventCallback:',id,state,op,data);
};
JSync.WebDBServer.prototype.browserInfo = function(browserID, callback) {  //////////  Right now, nothing uses this.  But I think it will be useful in the future, probably for user authentication from outside this framework.
    callback = callback || NOOP;
    var self = this;
    this.metaDB.getState('browsers', function(state) {
        if(!state.data.hasOwnProperty(browserID)) return callback(null);
        var info = JSync.deepCopy(state.data[browserID]);  // Prevent mutation of state object.
        info.browserID = browserID;
        info.connections = {};
        self.metaDB.getState('connections', function(state) {
            var connectionInfo, connectionID;
            for(connectionID in state.data) if(state.data.hasOwnProperty(connectionID)) {
                connectionInfo = state.data[connectionID];
                if(connectionInfo.browserID === browserID) {
                    info.connections[connectionID] = true;
                }
            }
            return callback(info);
        });
    });
};
JSync.WebDBServer.prototype.clientConnect = function(browserID, req, onSuccess, onError) {
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
JSync.WebDBServer.prototype.clientDisconnect = function(connectionID, req, onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || FAIL;
    var self = this;
    this.metaDB.getState('connections', function(connections) {
        if(!connections.data.hasOwnProperty(connectionID)) return onError(new Error('connectionID not found: '+connectionID));
        self._removeConnection(connections, connectionID);
        return onSuccess();
    });
};
JSync.WebDBServer.prototype._removeConnection = function(connectionsState, connectionID) {
                connectionsState.edit([{op:'delete', key:connectionID}]);

                ///////// I still might need to implement this old logic:
                // // Also remove from the activeConnections:
                // if(conn.req  &&  !conn.req.socket.destroyed) conn.req.destroy();
                // if(conn.sendToLongPoll) conn.sendToLongPoll();  // Allow the connection to clean up.
                // delete self._activeConnections[connectionID];
};
JSync.WebDBServer.prototype._removeStaleConnections = function() {
    var self = this;
    this.metaDB.getState('connections', function(connections) {
        var curTime = new Date().getTime(),
            connectionID;
        for(connectionID in connections.data) if(connections.data.hasOwnProperty(connectionID)) {
            if(curTime - connections.data[connectionID].atime > self.connectionStaleTime) {
                console.log('Removing Stale Connection:', connectionID);
                self._removeConnection(connections, connectionID);
            }
        }
    });
};











JSync.WebDBServer.prototype.installIntoSebwebRouter = function(router, baseURL) {
    if(!_.isString(baseURL)) throw new Error('Expected a baseURL');
    if(!baseURL.length) throw new Error('Empty baseURL!');
    if(baseURL.charAt(0) !== '/') throw new Error("baseURL should start with '/'.");
    if(baseURL.charAt(baseURL.length-1) === '/') throw new Error("baseURL should not end with '/'.");
    router.prependRoutes([
        {path:'^'+baseURL+'/connect$',    func:JSync.sebwebHandler_connect(this)},
        {path:'^'+baseURL+'/disconnect$', func:JSync.sebwebHandler_connect(this)},
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
                    syncServer.browserInfo(browserID, function(browserInfo) {
                        console.log('browserInfo:',browserInfo);
                        if(!browserInfo) return onError(new Error('Disconnect: browserID not found: '+browserID));  // This would be weird, since we *just* validated the browserID...
                        if(!(connectionID in browserInfo.connections)) return onError(new Error('Disconnect: Wrong browserID, or expired connection.'));
                        syncServer.clientDisconnect(connectionID, req, function() {
                            JSync._setJsonResponseHeaders(res);
                            res.end('{}');
                            onSuccess();
                        }, onError);
                    });
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
