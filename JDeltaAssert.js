//  JDelta - Assert for the browser
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


// API inspired by Node.JS


(function() {
// Only install ourselves if there is no assert already:
if(typeof assert === 'undefined') {
    var assert = function(b) { if(!b) throw new Error(b); },
        JDelta;
    if(typeof exports !== 'undefined') {
        // We are on Node.
        exports.assert = assert;
        JDelta = require('./JDelta').JDelta;
    } else if(typeof window !== 'undefined') {
        window.assert = assert;
        JDelta = window.JDelta;
    }

    assert.deepEqual = function(a,b) {
        var aStr = JDelta.stringify(a),
            bStr = JDelta.stringify(b);
        if(aStr !== bStr) throw new Error(aStr + '  !deepEqual  ' + bStr);
    };
    assert.equal = function(a,b) {
        if(a != b) throw new Error(''+a+' != '+b);
    };
    assert.throws = function(func, regex) {
        try {
            func();
            throw new Error('Expected exception!');
        } catch(e) {
            if(!regex.test(e.message)) throw new Error('Unexpected exception: '+e.message);
        }
    };
}
})();
