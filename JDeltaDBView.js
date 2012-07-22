//  JDelta - Database Views
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


// Views inspired by CouchDB.


(function() {

var JDeltaDBView = {},
    JDeltaDB;
if(typeof exports !== 'undefined') {
    // We are on Node.
    exports.JDeltaDBView = JDeltaDBView;
    JDeltaDB = require('./JDeltaDB.s').JDeltaDB;
} else if(typeof window !== 'undefined') {
    // We are in a brower.
    window.JDeltaDBView = JDeltaDBView;
    JDeltaDB = window.JDeltaDB;
} else throw new Error('This environment is not yet supported.');

JDeltaDBView.VERSION = '0.1.0a';

JDeltaDBView.View = function(db, idRegex, func) {
    // Guard against forgetting the 'new' operator:  "var db = JDeltaDBView.View();"   instead of   "var db = new JDeltaDBView.View();"
    if(this === JDeltaDBView)
        return new JDeltaDBView.View(db, idRegex, func);
    this._viewState = {};
    this._idRegex = idRegex;

};

})();
