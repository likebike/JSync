//  JDelta - Realtime Delta Distribution
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


(function() {

// First, install ourselves and import our dependencies:
var JDeltaSync = {},
    JDeltaDB,
    JDelta,
    _;
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.JDeltaSync = JDeltaSync;
    JDeltaDB = require('./JDeltaDB.js').JDeltaDB;
    JDelta = require('./JDelta.js').JDelta;
    _ = require('underscore');
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.JDeltaSync = JDeltaSync;
    JDeltaDB = window.JDeltaDB;
    JDelta = window.JDelta;
    _ = window._;
} else throw new Error('This environment is not yet supported.');

JDeltaSync.VERSION = '0.1.0a';



JDeltaSync.Client = function() {
    // Guard against forgetting the 'new' operator:
    if(this === JDeltaSync)
        return new JDeltaSync.Client();
    this._sendQueue = [];
    this._sentQueue = [];
    this._receiveQueue = [];
};
JDeltaSync.Client.prototype.listAllStates = function(idPrefix, recursive, onSuccess, onError) {
    // For example, imagine we are making YouTube v 2.0:
    // PROBLEMS:  operations across multiple states... no transaction support yet.
    //            You get into *really* messy situations when you want to undo/redo a multi-state transaction if other activity has occurred in one of the affected states.  For example, what if bob adds a video -- an entry goes into his /users/bob/videos, and also into /videos/.  Then billy creates a video.  Then bob performs an undo.  What should happen to billy's video, especially if they both get stored in the same state somewhere...
    '/users/chris_sebastian';         // User info.
    '/users/chris_sebastian/videos';  // --VIEW.  List of user's video ids.  Listens to /videos/*.  But, hm, i don't want to instantiate a separate VIEW per user...  Needs to be one view.
    '/users/chris_sebastian/comments';// --VIEW.  List of user's comment ids.  (Makes it easy to remove spam accounts and all their comments.)
    '/videos/1';                      // Video #1's info and data.
    '/videos/1/comments';             // --VIEW.  List of comments on this video.
    '/comments/1';                    // Comment #1
    '/comments/2';                    // Comment #2
    '/comments/3';                    // Comment #3

    /////////

    '/users/chris_sebastian'
    '/users/chris_sebastian/videos/1'
    '/users/chris_sebastian/videos/1/comments/1'
    '/users/chris_sebastian/videos/1/comments/2'
    '/users/chris_sebastian/videos/1/comments/3'

    /////////

    // VIEWS: listens for changes on specific state id patterns, like /videos/*/comments, and be able to produce all the comments for a specific user (for example).  Updates cheaply whenever there is a change event on any video.


    '/userVideos';                    // VIEW.  input = /videos/*.    output = hash linking userID to videoIDs.
    '/userComments';                  // VIEW.  input = /comments/*.  output = hash linking userID to commentIDs.
    '/videoComments';                 // VIEW.  input = /comments/*.  output = hash linking videoID to commentIDs.
    '/users/chris_sebastian';         // User info.
    '/videos/1';                      // Video #1's info and data.
    '/comments/1';                    // Comment #1
    '/comments/2';                    // Comment #2
    '/comments/3';                    // Comment #3








    '/whiteboards/1'
    '/shapes/1'
    '/plan/1'   // Generated from a whiteboard.  Specific seq




};
JDeltaSync.Client.prototype.listStates = function(ids, onSuccess, onError) {
    // Fetches state infos from server.  Does *not* use/affect the queue.
    
    onSuccess([{id:'a', lastDeltaSeq:5, lastDeltaHash:0x12345678},
               {id:'b', lastDeltaSeq:9, lastDeltaHash:0x5eba571a}]);
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


JDeltaSync.Server = function() {
    // Guard against forgetting the 'new' operator:
    if(this === JDeltaSync)
        return new JDeltaSync.Server();
    this._clientConnections = {};
};
JDeltaSync.Server.prototype.listStates = function(items) {};




})();

