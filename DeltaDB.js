//  JsonDelta - Distributed Delta-Sequence Database
//  (c) 2012 LikeBike LLC
//  JsonDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)



(function() {

// First, install ourselves and import our dependencies:
var DeltaDB = {},
    JDelta;
if(exports !== undefined) {
    // We are on Node.
    exports.DeltaDB = DeltaDB;
    JDelta = require('./JsonDelta');
} else if(window !== undefined) {
    // We are in a browser.
    window.DeltaDB = DeltaDB;
    JDelta = window.JDelta;
} else throw new Error('This environment is not yet supported.');

DeltaDB.VERSION = '0.1.0a';

})();


