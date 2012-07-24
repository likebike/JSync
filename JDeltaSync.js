//  JDelta - Realtime Delta Distribution
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


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



JDeltaSync.Client = function(url) {
    // Guard against forgetting the 'new' operator:
    if(this === JDeltaSync)
        return new JDeltaSync.Client(url);
    if(!url)
        throw new Error('You must provide a base url.');
    this._url = url;
    this._sendQueue = [];
    this._sentQueue = [];
    this._receiveQueue = [];
};
JDeltaSync.Client.prototype._listStatesRegex = function(idRegex, onSuccess, onError) {
    var regexStr = idRegex.toString();
    jQuery.ajax({
        url:this._url,
        data:{cmd:'listStatesRegex',
              idRegex:regexStr},
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
var _regexEscape = function(str) { return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"); };  // Just temporary.  Use XRegExp if you need real escape support.
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

    // Simplify the implementation temporarily:
    var regexStr = '',
        i, ii;
    for(i=0, ii=ids.length; i<ii; i++) {
        if(i>0) regexStr += '|';
        regexStr += '^'+_regexEscape(ids[i])+'$';
    }
    var regex = new RegExp(regexStr);
    return this._listStatesRegex(regex, onSuccess, onError);
    
    //onSuccess([{id:'a', lastDeltaSeq:5, lastDeltaHash:0x12345678},
    //           {id:'b', lastDeltaSeq:9, lastDeltaHash:0x5eba571a}]);
};
JDeltaSync.Client.prototype.fetchDeltas = function(items, onSuccess, onError) {
    // Fetches state deltas from server.  Does *not* use/affect the queue.
    items = [{id:'a', startSeq:3, endSeq:5},  // Using a query structure like this allows us to minimize # of SQL queries that we need to perform.
             {id:'b', seq:9}];                //
    onSuccess([{id:'a', delta:{seq:3, curHash:'A', steps:[]}},
               {id:'a', delta:{seq:4, curHash:'B', steps:[]}},
               {id:'a', delta:{seq:5, curHash:'C', steps:[]}},
               {id:'b', delta:{seq:9, curHash:'X', steps:[]}}]);
};



JDeltaSync.sebwebHandler = function(syncServer) {
    return function(req, res, onSuccess, onError) {
        var url = URL.parse(req.url, true);
        switch(url.query.cmd) {
            case 'listStatesRegex':
                var idRegexStr = url.query.idRegex;
                console.log('idRegexStr:',idRegexStr);
                if(!_.isString(idRegexStr))
                    return onError('Illegal idRegex');
                if(!idRegexStr.length)
                    return onError('Blank idRegex');
                if(idRegexStr.charAt(0)!=='/'  ||  idRegexStr.charAt(1)!=='^'  ||  idRegexStr.charAt(idRegexStr.length-2)!=='$'  ||  idRegexStr.charAt(idRegexStr.length-1)!=='/')
                    return onError('idRegex missing /^...$/ chars: '+idRegexStr);
                idRegexStr = idRegexStr.substring(1, idRegexStr.length-1); // Chop off the surrounding '/' chars.
                var idRegex = RegExp(idRegexStr);
                syncServer.listStatesRegex(idRegex, function(result) {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(result));
                    onSuccess();
                }, onError);
                break;
            default:
                onError(new Error('Illegal command'));
        }
    };
};
JDeltaSync.Server = function(db) {
    // Guard against forgetting the 'new' operator:
    if(this === JDeltaSync)
        return new JDeltaSync.Server(db);
    if(!db)
        throw new Error("Expected a 'db' arg.");
    this._db = db;
    this._clientConnections = {};
};
JDeltaSync.Server.prototype.listStatesRegex = function(idRegex, onSuccess, onError) {
    var that = this;
    var out = [];
    var thereWasAnError = false;
    var numOfPendingCallbacks = 1;  // 1 so end does not get triggered before the end of the iteration.  (There is an extra checkForEnd after the iteration).
    var onSuccessAlreadyCalled = false;
    var checkForEnd = function() {
        numOfPendingCallbacks--;
        if(thereWasAnError) return;
        if(numOfPendingCallbacks < 0) throw new Error('This should never happen');
        if(!numOfPendingCallbacks) {
            if(onSuccessAlreadyCalled) throw new Error('This should never happen');
            onSuccessAlreadyCalled = true;
            onSuccess(out);
        }
    };
    this._db.iterStates(idRegex, function(id, state) {
        if(thereWasAnError) return;
        numOfPendingCallbacks++;
        that._db._storage.getLastDelta(id, function(id, delta) {
            out[out.length] = {id:id, lastDeltaSeq:delta.seq, lastDeltaHash:delta.curHash};
            checkForEnd();
        }, function(err) {
            thereWasAnError = true;
            onError(err);
            checkForEnd();
        })
    });
    doneWithIteration = true;
    checkForEnd();
};
JDeltaSync.Server.prototype.listStates = function(items) {};




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
