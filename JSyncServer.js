"use strict";
(function() {

// First, install ourselves and import our dependencies:
var JSync,  // We re-use the JSync namespace.
    slide,
    _,
    fs,
    PATH,
    NOOP = function(){},  // Surprisingly useful.
    FAIL = function(err){throw err},
    LOG_ERR = function(err){console.error(err)},
    undefined;  // So 'undefined' really is undefined.
if(typeof exports !== 'undefined') {
    // We are in Node.
    JSync = require('./JSync.js').JSync;
    slide = require('./slide.js').slide;
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
    this.ready = JSync.Ready();
    this.ready.notReady('READY');
    this._path = PATH.resolve(path);
    this._load();
    var THIS = this;
    this.ready.waitReady('FileDB._load', function() {
        THIS.on(function() { THIS._save(); });  // Register the saver after loading so the load events don't trigger another save.
        THIS.ready.ready('READY')
    });
};
JSync.FileDB.prototype._importData = JSync.RamDB.prototype._importData;
JSync.FileDB.prototype._load = function() {
    var THIS = this;
    if(!this._path) throw new Error('Missing _path!');
    this.ready.notReady('FileDB._load');
    var ready = function() { THIS.ready.ready('FileDB._load') };
    fs.readFile(this._path, function(err, dataStr) {
        if(err) {
            if(err.code === 'ENOENT') {
                // The path doesn't exist.  This isn't a fatal error.
                console.log('FileDB path does not exist:',THIS._path);
                // Just exit, since there's no data to load:
                return ready();
            }
            ready();
            throw err;
        }
        var data = JSON.parse(dataStr);
        THIS._importData(data);
        THIS.ready.waitReady('RamDB._importData', ready);
    });
};
JSync.FileDB.prototype._exportData = JSync.RamDB.prototype._exportData;
JSync.FileDB.prototype._save = function() {
    var THIS = this;
    if(!this.__save_raw) this.__save_raw = _.debounce(function(onSuccess, onError) {  // Notice that right now, there is no way to pass in 'onSuccess' or 'onError' parameters.  I do this intentionally, due to the debounced design.  If I really want to support these callbacks, I need to design an 'asyncDebounce'.
        onSuccess = onSuccess || NOOP; onError = onError || LOG_ERR;
        if(!this._path) return onError(new Error('Missing _path!'));
        var THIS = this,
            newPath = this._path + '.new',
            data = this._exportData(),
            k;
        fs.writeFile(newPath, JSync.stringify(data, undefined, 2), function(err) {
            if(err) return onError(err);
            fs.rename(newPath, THIS._path, function(err) {
                if(err) return onError(err);
                //console.log('FileDB Saved:',THIS._path);
                return onSuccess();
            });
        });
    }, 1000);
    this.__save_raw();
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
// This second section implements a JSync.CometDB server.
//



JSync._setCorsHeaders = function(req, res, options) {
    // I do this same thing in several places, so I am turning it into a function.
    res.setHeader('Access-Control-Allow-Origin', options.accessControlAllowOrigin || req.headers.origin || req.headers.referer);  // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).   ///// NOTE 2015-08-01: Client requests do not contain the 'Origin' header because they are not cross-domain requests.  I am adding 'Referer' as another option.
    res.setHeader('Access-Control-Allow-Credentials', 'true');  // Allow cross-domain cookies.  ...otherwise, javascript can't access the response body.
};
JSync._setJsonResponseHeaders = function(res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
};


JSync.CometServer = function(db) {
    if(!(this instanceof JSync.CometServer)) return new JSync.CometServer(db);
    this.longPollTimeout = 100000;
    this.connectionStaleTime = 1000*60*5;
    this.disposableQueueSizeLimit = 200;
    this._receives = {};
    this.setDB(db);
    this.installOpHandlers();

    this._removeStaleClientsInterval = setInterval(_.bind(this._removeStaleClients, this), 10000);
};
JSync.CometServer.prototype.setDB = function(db) {
    if(!db) throw new Error('Null DB');
    if(this.db) throw new Error('DB replacement not implemented yet.');
    this.db = db;
    //db.on(this._dbEventCallback, this);  // For now, I don't actually have a need for these callbacks.
    // Define some states that definitely need to be there:
    db.getStateAutocreate('browsers');
    db.getStateAutocreate('clients');
};
JSync.CometServer.prototype._dbEventCallback = function(id,state,op,data) {
    console.log('CometServer dbEventCallback:',id,state,op,data);
};
JSync.CometServer.prototype.setOpHandler = JSync.CometClient.prototype.setOpHandler;
JSync.CometServer.prototype.getOpHandler = function(name) {
    var h;
    if(this.opHandlers.hasOwnProperty(name)) h = this.opHandlers[name];
    else h = function(clientID, data, next) {
                 console.error('Unknown OpHandler:',name);
                 next({op:'REPLY', error:'Unknown Server OpHandler', cbID:data.cbID});
             };
    return h;
};
JSync.CometServer.prototype.installOpHandlers = function() {
    var THIS = this;
    this.setOpHandler('echoImmediate', function(clientID, data, reply) {
        data.op = 'REPLY';
        reply(data);
    });
    this.setOpHandler('echo', function(clientID, data, reply) {
        data.op = 'REPLY';
        reply();  // Send an Immediate blank reply.
        reply(data);  // Send a Delayed reply.
    });
};
JSync.CometServer.prototype.browserInfo = function(browserID, callback) {
    callback = callback || NOOP;
    var THIS = this;
    if(!browserID) return callback(null);
    this.db.getState('browsers', function(browsers) {
        if(!browsers.data.hasOwnProperty(browserID)) return callback(null);
        var info = JSync.deepCopy(browsers.data[browserID]);  // Prevent external mutation.
        info.browserID = browserID;
        info.clients = {};  // I'm using an object instead of a list mostly for future expansion ability.  I might want to start including some extra info per connection.
        THIS.db.getState('clients', function(clients) {
            var clientID;
            for(clientID in clients.data) if(clients.data.hasOwnProperty(clientID)) {
                if(clients.data[clientID].browserID === browserID) info.clients[clientID] = true;
            }
            callback(info);
        });
    });
};
JSync.CometServer.prototype.clientInfoSync = function(clientID, clientsState) {
    if(!clientID) return null;
    if(!clientsState.data.hasOwnProperty(clientID)) return null;
    var info = {clientID:clientID, browserID:clientsState.data[clientID].browserID};
    // In the future, I might also want to fetch the 'browsers' state and inclue some info from there, but right now, it's just blank objects.
    // Might also want to include a list of other clientIDs that have the same browserID...
    return info;
};
JSync.CometServer.prototype.clientInfo = function(clientID, callback) {
    callback = callback || NOOP;
    var THIS = this;
    this.db.getState('clients', function(clients) { callback(THIS.clientInfoSync(clientID, clients)) });
};
JSync.CometServer.prototype.clientConnect = function(browserID, requestedClientID, onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || LOG_ERR;
    var THIS = this;
    this.db.getState('clients', function(clients) {
        var clientID = (function() {
            if(!requestedClientID) return null;
            if(!JSync.ID_REGEX.test(requestedClientID)) return null;
            var cInfo = THIS.clientInfoSync(requestedClientID, clients);
            if(!cInfo) return null;
            if(cInfo.browserID !== browserID) return null;
            return requestedClientID;
        })();
        if(!clientID) clientID = JSync.newID(null, clients.data);
        (THIS._receives[clientID] || {shutdown:NOOP}).shutdown(true);  // Check for an existing connection with the same clientID and hijack it ('true').
        console.log('Connected: browserID='+browserID+' clientID='+clientID);
        if(!clients.data.hasOwnProperty(clientID)) clients.edit([{op:'create', key:clientID, value:{browserID:browserID, receiveQ:[]}}]);
        THIS._touchClient(clientID, function() { onSuccess({browserID:browserID, clientID:clientID}) }, onError);
    });
};
JSync.CometServer.prototype.clientDisconnect = function(clientID, onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || LOG_ERR;
    var THIS = this;
    this.db.getState('clients', function(clients) {
        if(!clients.data.hasOwnProperty(clientID)) return onError(new Error('clientID not found: '+clientID));
        THIS._removeClient(clients, clientID);
        return onSuccess();
    });
};
JSync.CometServer.prototype._removeClient = function(clientsState, clientID) {
    (this._receives[clientID] || {shutdown:NOOP}).shutdown();  // The shutdown() will remove the entry from _receives.
    if(this._receives.hasOwnProperty(clientID)) console.log('CometServer shutdown() did not remove _receives[clientID] !');
    clientsState.edit([{op:'delete', key:clientID}]);
};
JSync.CometServer.prototype._removeStaleClients = function() {
    var THIS = this;
    this.db.getState('clients', function(clients) {
        var curTime = new Date().getTime(),
            clientID;
        for(clientID in clients.data) if(clients.data.hasOwnProperty(clientID)) {
            if(curTime-clients.data[clientID].atime > THIS.connectionStaleTime) {
                console.log('Removing Stale Client:', clientID);
                THIS._removeClient(clients, clientID);
            }
        }
    });
};
JSync.CometServer.prototype._touchClient = function(clientID, onSuccess, onError) {
    onSuccess = onSuccess || NOOP; onError = onError || LOG_ERR;
    var THIS = this;
    this.db.getState('clients', function(clients) {
        var now = new Date().getTime();
        clients.edit([{op:'update!', path:[clientID], key:'atime', value:now}]);
        THIS.db.getState('browsers', function(browsers) {
            browsers.edit([{op:'update!', path:[clients.data[clientID].browserID], key:'atime', value:now}]);
            return onSuccess();
        }, onError);
    }, onError);
};
JSync.CometServer.prototype.clientSend = function(clientID, bundle, onSuccess, onError) {
    this._touchClient(clientID);    
    var THIS = this;
    var func = function(bundleItem, next) {
        bundleItem = bundleItem || {};
        // We provide opHandlers with this 'reply' function.  Call it up to twice: Once as an Immediate (usually undefined) reply, or a second time for a Delayed reply.
        var replied = false,
            callNum = 0;
        var reply = function(result) {
            callNum += 1;
            if(callNum > 2) throw new Error('Too many reply() calls!');
            if(replied) throw new Error('Already replied!');
            if(callNum===1 && !result) {
                // Blank Immediate result.
                next();
            } else if(callNum===1 && result) {
                // Immediate result.
                replied = true;
                next(null, _.extend({op:'REPLY', cbID:bundleItem.cbID}, result));
            } else if(callNum===2 && !result) {
                throw new Error('Falsey Delayed reply!');
            } else if(callNum===2 && result) {
                // Delayed result.
                replied = true;
                THIS.addToReceiveQ(clientID, _.extend({op:'REPLY', cbID:bundleItem.cbID}, result));
            } else {
                throw new Error('This should never happen.');
            }
        };
        var handler = THIS.getOpHandler(bundleItem.op);
        setTimeout(function() { handler(clientID, bundleItem, reply) }, 0);  // We use a timeout to accomplish two things:  1) Prevent stack overflows, and prevent one client from hogging the server.  2) Guarantee correct order of operations, regardless of the async implementation of the handlers.  Without this timeout, it's easy for operations to become reversed depending on whether an async function is really asynchronous or whether it's synchronous with an async interface.
    };
    var chain = [],
        i, ii;
    for(i=0, ii=bundle.length; i<ii; i++) chain[chain.length] = [func, bundle[i]];
    slide.chain(chain, function(err, result) {
        if(err) throw new Error('I have never seen this.');
        var out = [],
            data;
        while(result.length) {
            data = result.shift();
            if(data === undefined) continue;
            out[out.length] = data;
        }
        return onSuccess(out);
    });
};
// Example usage:  cometServer.addToReceiveQ('0x1245678', {op:'myOp', a:1, b:2, _disposable:true})
JSync.CometServer.prototype.addToReceiveQ = function(clientID, data) {
    var THIS = this;
    this.db.getState('clients', function(clients) {
        if(!clients.data.hasOwnProperty(clientID)) return; // The client disconnected while we were sending data to them.  Discard the data.
        if((data||0)._disposable) {
            // This data is disposable.  Throw it out if the queue is already too long:
            if(clients.data[clientID].receiveQ.length > THIS.disposableQueueSizeLimit) return;
            delete data['_disposable'];  // Save some bandwidth.
        }
        clients.edit([{op:'arrayPush', path:[clientID, 'receiveQ'], value:data}]);
        (THIS._receives[clientID] || {dataIsWaiting:NOOP}).dataIsWaiting(clients.data[clientID].receiveQ.length);
    });
};
// Example usage:  cometServer.broadcast(['0x12345678'], JSync.CometServer.broadcast_includeAll, data)
JSync.CometServer.broadcast_includeAll = function(clientID, data, cb) { cb(true) };  // So I don't need to re-invent this everywhere.
JSync.CometServer.prototype.broadcast = function(excludeConnIDs, shouldIncludeFunc, data) {
    excludeConnIDs = excludeConnIDs || [];
    var THIS = this,
        excludeMap = {},
        i, ii;
    for(i=0, ii=excludeConnIDs.length; i<ii; i++) { excludeMap[excludeConnIDs[i]] = true; }
    this.db.getState('clients', function(clients) {
        _.each(clients.data, function(val, clientID) {
            if(excludeMap.hasOwnProperty(clientID)) return;  // This clientID is excluded.
            shouldIncludeFunc(clientID, data, function(shouldInclude) {
                if(shouldInclude) THIS.addToReceiveQ(clientID, data);
            });
        });
    });
};
JSync.CometServer.prototype.clientReceive = function(clientID, onSuccess, onError) {
    this._touchClient(clientID);

    // First, does a long poll already exist for this clientID?  If so, kill the old one before proceeding:
    (this._receives[clientID] || {shutdown:NOOP}).shutdown();

    var THIS = this,
        out = [],
        myObj = {dataIsWaiting:null, shutdown:null};
    this._receives[clientID] = myObj;
    myObj.shutdown = function(hijacked) {
        if(THIS._receives[clientID] !== myObj) {   // The connection was already shut down.
            if(out.length) throw new Error('Connection is already shutdown, but output is still in queue!  This should never happen.');
            return;
        }
        var r = THIS._receives[clientID];
        delete THIS._receives[clientID];
        var myOut = out;
        out = [];  // So subsequent shutdown() calls don't freak out about data in 'out'.
        if(hijacked) {
            var err = new Error('clientID was hijacked!');
            err.statusCode = 452;  // The sebweb router will use this as the response status code.
            return onError(err);
        }
        // Shut down the socket, etc...
        return onSuccess(myOut);
    };
    var send = function() {
        THIS.db.getState('clients', function(clients) {
            if(THIS._receives[clientID] !== myObj) return;  // The connection was already shut down.
            if(!clients.data.hasOwnProperty(clientID)) return myObj.shutdown(); // The client disconnected.  There's no point to send any data.  (Also, it would cause a "Path not found" exception in edit() below.)  Just shut down the socket and stuff like that.
            out = clients.data[clientID].receiveQ;
            clients.edit([{op:'update', path:[clientID], key:'receiveQ', value:[]}]);
            myObj.shutdown();
        }, onError);  /////////// 2018-03-06 I think I should be passing onError to getState (instead of passing nothing).  I am modifying this code without the ability to test.
    };
    var debounced_send = _.debounce(send, 4);
    myObj.dataIsWaiting = function(waitingCount) {
        waitingCount = waitingCount || 0;
        if(waitingCount > 100) {
console.log('Forcing send due to waitingCount');
            return send(); // No need to wait any longer.  Enough data has accumulated.  We want to send chunks out periodically to reduce stress on the server, in case a client submits huge bundles.  Also helps the server to service multiple clients while dealing with an abusive client.
        } 
        return debounced_send();
    };

    setTimeout(myObj.shutdown, this.longPollTimeout); // Force the long-poll to execute before the server or filewalls close our connection.  The reason we need to do this from the server is becasue Chrome does not support the ajax 'timeout' option.

    // Finally, if there is data already waiting, initiate the process:
    this.db.getState('clients', function(clients) {
        if(clients.data[clientID].receiveQ.length) myObj.dataIsWaiting();
    }, onError);  /////////// 2018-03-06 I think I should be passing onError to getState (instead of passing nothing).  I am modifying this code without the ability to test.
};










JSync.installCometServerIntoSebwebRouter = function(comet, router, baseURL, options) {
    if(!_.isString(baseURL)) throw new Error('Expected a baseURL');
    if(!baseURL.length) throw new Error('Empty baseURL!');
    if(baseURL.charAt(0) !== '/') throw new Error("baseURL should start with '/'.");
    if(baseURL.charAt(baseURL.length-1) === '/') throw new Error("baseURL should not end with '/'.");
    router.prependRoutes([
        {path:'^'+baseURL+'/connect$',    func:JSync.sebwebHandler_connect(comet, options), log_level:'error'},
        {path:'^'+baseURL+'/disconnect$', func:JSync.sebwebHandler_connect(comet, options), log_level:'error'},
        {path:'^'+baseURL+'/send$',       func:JSync.sebwebHandler_send(comet, options), log_level:'error'},
        {path:'^'+baseURL+'/receive$',    func:JSync.sebwebHandler_receive(comet, options), log_level:'error'}
    ]);
};
JSync.sebwebHandler_connect = function(comet, options) {
    var sebweb = require('sebweb');
    if(!options.sebweb_cookie_secret) throw new Error('You must define options.sebweb_cookie_secret!');
    return sebweb.BodyParser(sebweb.CookieStore(options.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        JSync._setCorsHeaders(req, res, options);
        var afterWeHaveABrowserID = function(browserID) {
            var opArray = req.formidable.fields.op;
            if(!_.isArray(opArray)) return onError(new Error('no op!'));
            if(opArray.length !== 1) return onError(new Error('Wrong number of ops!'));
            var op = opArray[0];
            if(!_.isString(op)) return onError(new Error('non-string op!'));
            var clientIdArray = req.formidable.fields.clientID || req.formidable.fields._clientID;  // '_clientID' is used by 'connect' to prevent 'ajax()' from waiting for connection.
            if(!_.isArray(clientIdArray)) return onError(new Error('no clientID!'));
            if(clientIdArray.length !== 1) return onError(new Error('Wrong number of clientIDs!'));
            var clientID = clientIdArray[0];
            if(clientID  &&  !_.isString(clientID)) return onError(new Error('Invalid clientID!'));  // Here, clientID can be null (for auto-id-assignment during connect) or a string.
            switch(op) {
                case 'connect':
                    comet.clientConnect(browserID, clientID, function(clientInfo) {
                        JSync._setJsonResponseHeaders(res);
                        res.end(JSON.stringify(clientInfo));
                        return onSuccess();
                    }, onError);    
                    break;

                case 'disconnect':
                    console.log('Disconnected: browserID='+browserID+' clientID='+clientID);
                    comet.browserInfo(browserID, function(browserInfo) {
                        if(!browserInfo) return onError(new Error('Disconnect: browserID not found (weird!): '+browserID));  // This would be weird, since we *just* validated the browserID...
                        if(!(clientID in browserInfo.clients)) return onError(new Error('Disconnect: Wrong browserID, or expired client.'));
                        comet.clientDisconnect(clientID, function() {
                            JSync._setJsonResponseHeaders(res);
                            res.end('{}');
                            onSuccess();
                        }, onError);
                    });
                    break;

                default: return onError(new Error('Invalid op!'));
            }
        };
        comet.db.getState('browsers', function(browsers) {
            var browserID = res.SWCS_get('JSync_BrowserID');
            if(browserID) {
                if(browserID in browsers.data) return afterWeHaveABrowserID(browserID);
                console.log('BrowserID was provided by client, but not recognized by server:',browserID);
            } else {
                console.log('No BrowserID was provided.');
            }

            // Either no browserID was given, or we did not recognize the given browserID.  Generate a new one:
            browserID = JSync.newID(null, browsers.data);
            browsers.edit([{op:'create', key:browserID, value:{}}]);
            res.SWCS_set('JSync_BrowserID', browserID);
            return afterWeHaveABrowserID(browserID);
        });
    }, options.sebweb_cookie_options));
};
JSync.extractBrowserIDFromRequest = function(req, cookieName, cookieSecurity, cookieSecret) {
    // It is a common requirement to access the browserID from outside the JSync framework.
    // This convenience function allows you to extract it easily and safely.
    var sebweb = require('sebweb');
    var store = sebweb._cookies.extractCookie(req, cookieName, cookieSecurity, cookieSecret, true);
    var browserID = store['JSync_BrowserID'];
    // I could also get the 'browsers' state and verify that the browserID is in there, but that would require this function to be async, and also require access to the cometDB, so I'll wait until I have a real-world need to do this.
    return browserID;
};
JSync.sebwebAuth = function(comet, options, next) {
    var sebweb = require('sebweb');
    return sebweb.BodyParser(sebweb.CookieStore(options.sebweb_cookie_secret, function(req, res, onSuccess, onError) {
        JSync._setCorsHeaders(req, res, options);
        var clientIDArray = req.formidable.fields.clientID;
        if(!_.isArray(clientIDArray)) return onError(new Error('No clientID!'));
        if(clientIDArray.length !== 1) return onError(new Error('Wrong number of clientIDs!'));
        var clientID = clientIDArray[0];
        if(!_.isString(clientID)) return onError(new Error('clientID is not a string!'));
        // First, check the browserID:
        var browserID = res.SWCS_get('JSync_BrowserID');
        comet.browserInfo(browserID, function(browserInfo) {
            if(!browserInfo) {
                // This occurs when a client IP address changes, or if a cookie gets hijacked.  The user should log back in and re-authenticate.
                var err = new Error('Unknown browserID: '+browserID);
                err.statusCode = 450;
                return onError(err);
            }
            // Now that the browserID is checked, make sure the clientID matches:
            if(!browserInfo.clients.hasOwnProperty(clientID)) {
                // This occurs when a client goes to sleep for a long time and then wakes up again (after their stale connection has already been cleared).  It is safe to allow the user to connect() again and resume where they left off.
                var err = new Error('Unknown clientID: '+clientID);
                err.statusCode = 451;
                return onError(err);
            }

            // Note that status code 452 (client hijacked) is managed by the clientReceive shutdown() function.

            // Authentication complete.  Continue on to the next step:
            return next(browserID, clientID, req, res, onSuccess, onError);
        });
    }, options.sebweb_cookie_options));
};
JSync.sebwebHandler_send = function(comet, options) {
    return JSync.sebwebAuth(comet, options, function(browserID, clientID, req, res, onSuccess, onError) {
        var bundleArray = req.formidable.fields.bundle;
        if(!_.isArray(bundleArray)) return onError(new Error('No Bundle!'));
        if(bundleArray.length !== 1) return onError(new Error('Wrong Bundle Length!'));
        var bundleStr = bundleArray[0];
        if(!bundleStr) return onError(new Error('Blank Bundle!'));
        if(bundleStr.charAt(0) !== '['  ||  bundleStr.charAt(bundleStr.length-1) !== ']') return onError(new Error('Bundle missing [] chars!'));
        var bundle = JSON.parse(bundleStr);
        comet.clientSend(clientID, bundle, function(result) {
            JSync._setJsonResponseHeaders(res)
            res.end(JSON.stringify(result));
            return onSuccess();
        }, onError);
    });
};
JSync.sebwebHandler_receive = function(comet, options) {
    return JSync.sebwebAuth(comet, options, function(browserID, clientID, req, res, onSuccess, onError) {
        comet.clientReceive(clientID, function(result) {
            JSync._setJsonResponseHeaders(res)
            res.end(JSON.stringify(result));
            return onSuccess();
        }, onError);
    });
};







JSync.AccessPolicy_WideOpen = function(clientID, stateID, cb) { cb({read:true,  create:true,  remove:true,  update:true }) };
JSync.AccessPolicy_ReadOnly = function(clientID, stateID, cb) { cb({read:true,  create:false, remove:false, update:false}) };
JSync.AccessPolicy_Denied =   function(clientID, stateID, cb) { cb({read:false, create:false, remove:false, update:false}) };






JSync.CometDBServer = function(comet, db, accessPolicy) {
    if(!(this instanceof JSync.CometDBServer)) return new JSync.CometDBServer(comet, db, accessPolicy);
    
    this.comet = comet;
    this.setAccessPolicy(accessPolicy);
    this.setDB(db);
    this._ignoreSendList = [];
    this.installOpHandlers();
};
JSync.CometDBServer.prototype.setAccessPolicy = function(accessPolicy) {
    this.accessPolicy = accessPolicy || JSync.AccessPolicy_Denied;  // 'Denied' is the only safe default.
    var THIS = this;
    this._shouldIncludeInBroadcast = function(clientID, data, cb) {   // So we don't need to re-create this closure on every network operation.  (That would be expensive.)
        THIS.accessPolicy(clientID, data.id, function(access) { cb(access.read) });
    };



};
JSync.CometDBServer.prototype.setDB = function(db) {
    if(!db) throw new Error('Null DB');
    if(this.db) throw new Error('DB replacement not implemented yet.');  // When replacing a stateDB, you would need to unregister callback, re-load currently-used states... etc.
    this.db = db;
    db.on(this._dbEventCallback, this);
};
JSync.CometDBServer.prototype._dbEventCallback = function(id, state, op, data) {
    // Eventually, I will also need to add handling of the 'reset' event.  I'll get to that when I add the DirDB, and have more complex loading/unloading of data.
    if(op === 'create') {
        this._broadcast({op:'createState', id:id, stateData:state.data});
    } else if(op === 'delete') {
        this._broadcast({op:'deleteState', id:id}); 
    } else if(op === 'delta') {
        this._broadcast({op:op, id:id, delta:data});
    } else {
        console.log('Unknown dbEventCallback Op:', id, state, op, data);
    }
};
JSync.CometDBServer.prototype._broadcast = function(data) {
    var dataStr = JSync.stringify(data),
        ignoreClientIDs = [],
        i, ii;
    for(i=0, ii=this._ignoreSendList.length; i<ii; i++) {
        if(i === 1000) console.log('ignoreSendList.length > 1000:', this._ignoreSendList[i]);
        if(this._ignoreSendList[i].dataStr === dataStr) {
            ignoreClientIDs = this._ignoreSendList[i].clientIDs;
            this._ignoreSendList.splice(i,1);
            break;
        }
    }
    this.comet.broadcast(ignoreClientIDs, this._shouldIncludeInBroadcast, data);
};
JSync.CometDBServer.prototype._ignoreSend = function(clientIDs, data) {
    // This function helps us to be able to propagate server-side state operations, while also being able to handle client-generated ops.
    this._ignoreSendList[this._ignoreSendList.length] = {dataStr:JSync.stringify(data), clientIDs:clientIDs};
};
JSync.CometDBServer.prototype.installOpHandlers = function() {
    var THIS = this;
    this.comet.setOpHandler('getState', function(clientID, data, reply) {
        reply();  // Send an Immediate blank reply.
        THIS.accessPolicy(clientID, data.id, function(access) {
            if(access.read) THIS.db.getState(data.id,
                                             function(state, id) { reply({id:data.id, stateData:state.data}) },
                                             function(err) { reply({id:data.id, error:err.message}) });
            else reply({id:data.id, error:'Access Denied'});
        });
    });
    this.comet.setOpHandler('createState', function(clientID, data, reply) {
        reply();  // Send an Immediate blank reply.
        THIS.accessPolicy(clientID, data.id, function(access) {
            if(access.create) {
                THIS._ignoreSend([clientID], {op:data.op, id:data.id, stateData:data.stateData});
                THIS.db.createState(data.id,
                                    JSync.State(data.stateData),
                                    function(state, id) { reply({id:data.id}) },
                                    function(err) { reply({id:data.id, error:err.message}) });
            } else reply({id:data.id, error:'Access Denied'});
        });
    });
    this.comet.setOpHandler('deleteState', function(clientID, data, reply) {
        reply();  // Send an Immediate blank reply.
        THIS.accessPolicy(clientID, data.id, function(access) {
            if(access.remove) {
                THIS._ignoreSend([clientID], {op:data.op, id:data.id});
                THIS.db.deleteState(data.id,
                                    function(state, id) { reply({id:data.id}) },
                                    function(err) { reply({id:data.id, error:err.message}) });
            } else reply({id:data.id, error:'Access Denied'});
        });
    });
    this.comet.setOpHandler('delta', function(clientID, data, reply) {
        reply();  // Send an Immediate blank reply.
        THIS.accessPolicy(clientID, data.id, function(access) {
            if(access.update) THIS.db.getState(data.id,
                                               function(state, id) {
                                                   THIS._ignoreSend([clientID], {op:data.op, id:data.id, delta:data.delta});
                                                   try { state.applyDelta(data.delta);
                                                   } catch(err) { return reply({id:data.id, error:err.message}) };
                                                   reply({id:data.id});
                                               }, function(err) { reply({id:data.id, error:err.message}) });
            else reply({id:data.id, error:'Access Denied'});
        });
    });
};



})();
