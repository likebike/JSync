"use strict";

(function() {
    
// First, install ourselves and import our dependencies:
var JSync = {},
    _,
    jQuery,     // Browser only.
    undefined;  // So 'undefined' really is undefined.
if(typeof exports !== 'undefined') {
    // We are in Node.
    exports.JSync = JSync;
    _ = require('underscore');
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.JSync = JSync;
    _ = window._;
    jQuery = window.jQuery || window.$;
} else throw new Error('This environment is not yet supported.');

JSync.VERSION = '201508012330';


JSync._test = function() {
    var testNum = 0;
    var eq = function(a,b) {  // Test for equality
        testNum += 1;
        var result = a===b;
        console.log('Test #'+testNum+' : '+(result ? 'ok' : 'FAIL!  '+a+'  !==  '+b));
    }
    eq(JSync.stringify({b:[1,2,3],a:{y:4,z:[5],x:'6'}}), '{"a":{"x":"6","y":4,"z":[5]},"b":[1,2,3]}');
    eq(JSync.pad('va','E',3), 'Eva');
    eq(JSync.pad('Eva','Awesome',4), 'AwesomeEva');
    eq(JSync.pad(' Eva','♥',10), '♥♥♥♥♥♥ Eva');
    eq(JSync.generateID(8).length, 8);
    eq(JSync.dsHash('Eva'), '0xe51a2ff8');
    eq(JSync.dsHash('黄哲'), '0x8c4234fa');
    eq(JSync.getTarget({a:{b:'c'}},['a','b']), 'c');
    eq(JSync.stringify(JSync.deepCopy({a:[1,2,'3']})), '{"a":[1,2,"3"]}');
    eq(JSync._isInt(5), true);
    eq(JSync._isInt('5'), false);
    var obj = {a:1};
    var ops = [{op:'create', path:[], key:'b', value:{x:24}},
               {op:'update!', path:['b'], key:'c', value:3},
               {op:'update', path:['b'], key:'c', value:[30]},
               {op:'delete', path:[], key:'a'},
               {op:'arrayInsert', path:['b','c'], key:0, value:'item-0'},
               {op:'arrayRemove', path:['b','c'], key:1}];
    var delta = JSync.edit(JSync.deepCopy(obj), ops);
    var badOps = JSync.deepCopy(ops); badOps[badOps.length] = {op:'delete', key:'nonthere'};
    var o1 = JSync.deepCopy(obj);
    try { JSync.edit(o1, badOps) } catch(err) {}
    eq(JSync.stringify(o1), JSync.stringify(obj));
    eq(JSync.stringify(delta), '{"steps":[{"after":{"x":24},"key":"b","op":"create","path":[]},{"after":3,"key":"c","op":"create","path":["b"]},{"after":[30],"before":3,"key":"c","op":"update","path":["b"]},{"before":1,"key":"a","op":"delete","path":[]},{"after":"item-0","key":0,"op":"arrayInsert","path":["b","c"]},{"before":30,"key":1,"op":"arrayRemove","path":["b","c"]}]}');
    eq(JSync.stringify(JSync.reverseDelta(delta)), '{"steps":[{"after":30,"key":1,"op":"arrayInsert","path":["b","c"]},{"before":"item-0","key":0,"op":"arrayRemove","path":["b","c"]},{"after":1,"key":"a","op":"create","path":[]},{"after":3,"before":[30],"key":"c","op":"update","path":["b"]},{"before":3,"key":"c","op":"delete","path":["b"]},{"before":{"x":24},"key":"b","op":"delete","path":[]}]}');
    eq(JSync.stringify(delta), JSync.stringify(JSync.reverseDelta(JSync.reverseDelta(delta))));
    eq(JSync.stringify(JSync.applyDelta(JSync.deepCopy(obj),delta)), '{"b":{"c":["item-0"],"x":24}}');
    var d1=JSync.deepCopy(delta); d1.steps[5].key = 5;  // Create a broken delta.
    try { JSync.applyDelta(o1, d1) } catch(err) {}  // Expect failure
    eq(JSync.stringify(o1), JSync.stringify(obj));
    var d = JSync.Dispatcher();
    var out1 = null,
        out2 = {};
    d.on(function(val) {out1 = val});
    d.on(function(val) {this.x = val}, out2);
    d.trigger(123);
    eq(out1, 123);
    eq(JSync.stringify(out2), '{"x":123}');
    var s = JSync.State({a:111});
    var cbCount = 0;
    var cb = function(state, delta) { cbCount += 1 };
    s.on(cb);
    s.edit([{op:'create', key:'b', value:222}]);
    eq(cbCount, 1);
    s.off(cb);
    s.edit([{op:'create', key:'c', value:333}]);
    eq(cbCount, 1);
    eq(JSync.stringify(s.data), '{"a":111,"b":222,"c":333}');
    s.applyDelta( JSync.edit(JSync.deepCopy(s.data), [{op:'create', key:'d', value:444}, {op:'delete', key:'a'}]) );
    eq(JSync.stringify(s.data), '{"b":222,"c":333,"d":444}');
};




/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This first section deals with the delta algorithm.  No async, no events, no network requirements.  Just Deltas.
//





///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
/////////////                       ///////////////////////////////////////////////
/////////////  START JSON2 EXTRACT  ///////////////////////////////////////////////
/////////////                       ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////

// This code is extracted directly from json2.js.  The 'parse' and some other stuff has been removed, since I only need the stringify function.  It has been modified slightly to produce alphabetically-storted JSON output, resulting in consistent output across platforms.  Edits have been marked.
// https://raw.github.com/douglascrockford/JSON-js/master/json2.js

(function () {
    'use strict';
    
    var rx_one = /^[\],:{}\s]*$/,
        rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,
        rx_three = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,
        rx_four = /(?:^|:|,)(?:\s*\[)+/g,
        rx_escapable = /[\\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        rx_dangerous = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;

    function f(n) {
        // Format integers to have at least two digits.
        return n < 10 
            ? '0' + n 
            : n;
    }
    
    function this_value() {
        return this.valueOf();
    }

    if (typeof Date.prototype.toJSON !== 'function') {

        Date.prototype.toJSON = function () {

            return isFinite(this.valueOf())
                ? this.getUTCFullYear() + '-' +
                        f(this.getUTCMonth() + 1) + '-' +
                        f(this.getUTCDate()) + 'T' +
                        f(this.getUTCHours()) + ':' +
                        f(this.getUTCMinutes()) + ':' +
                        f(this.getUTCSeconds()) + 'Z'
                : null;
        };

        Boolean.prototype.toJSON = this_value;
        Number.prototype.toJSON = this_value;
        String.prototype.toJSON = this_value;
    }

    var gap,
        indent,
        meta,
        rep;


    function quote(string) {

// If the string contains no control characters, no quote characters, and no
// backslash characters, then we can safely slap some quotes around it.
// Otherwise we must also replace the offending characters with safe escape
// sequences.

        rx_escapable.lastIndex = 0;
        return rx_escapable.test(string) 
            ? '"' + string.replace(rx_escapable, function (a) {
                var c = meta[a];
                return typeof c === 'string'
                    ? c
                    : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
            }) + '"' 
            : '"' + string + '"';
    }


    function str(key, holder) {

// Produce a string from holder[key].

        var i,          // The loop counter.
            k,          // The member key.
            v,          // The member value.
            length,
            mind = gap,
            partial,
            value = holder[key];

// If the value has a toJSON method, call it to obtain a replacement value.

        if (value && typeof value === 'object' &&
                typeof value.toJSON === 'function') {
            value = value.toJSON(key);
        }

// If we were called with a replacer function, then call the replacer to
// obtain a replacement value.

        if (typeof rep === 'function') {
            value = rep.call(holder, key, value);
        }

// What happens next depends on the value's type.

        switch (typeof value) {
        case 'string':
            return quote(value);

        case 'number':

// JSON numbers must be finite. Encode non-finite numbers as null.

            return isFinite(value) 
                ? String(value) 
                : 'null';

        case 'boolean':
        case 'null':

// If the value is a boolean or null, convert it to a string. Note:
// typeof null does not produce 'null'. The case is included here in
// the remote chance that this gets fixed someday.

            return String(value);

// If the type is 'object', we might be dealing with an object or an array or
// null.

        case 'object':

// Due to a specification blunder in ECMAScript, typeof null is 'object',
// so watch out for that case.

            if (!value) {
                return 'null';
            }

// Make an array to hold the partial results of stringifying this object value.

            gap += indent;
            partial = [];

// Is the value an array?

            if (Object.prototype.toString.apply(value) === '[object Array]') {

// The value is an array. Stringify every element. Use null as a placeholder
// for non-JSON values.

                length = value.length;
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, value) || 'null';
                }

// Join all of the elements together, separated with commas, and wrap them in
// brackets.

                v = partial.length === 0
                    ? '[]'
                    : gap
                        ? '[\n' + gap + partial.join(',\n' + gap) + '\n' + mind + ']'
                        : '[' + partial.join(',') + ']';
                gap = mind;
                return v;
            }

// If the replacer is an array, use it to select the members to be stringified.

            if (rep && typeof rep === 'object') {
                length = rep.length;
                for (i = 0; i < length; i += 1) {
                    if (typeof rep[i] === 'string') {
                        k = rep[i];
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (
                                gap 
                                    ? ': ' 
                                    : ':'
                            ) + v);
                        }
                    }
                }
            } else {

// Otherwise, iterate through all of the keys in the object.

                var sortedKeys = [];                                       ////////////// ADDED by Christopher Sebastian
                for(k in value) sortedKeys[sortedKeys.length] = k;         ////////////// ADDED by Christopher Sebastian
                sortedKeys.sort();                                         ////////////// ADDED by Christopher Sebastian
                var q, qq;                                                 ////////////// ADDED by Christopher Sebastian
                for(q=0, qq=sortedKeys.length; q<qq; q++) {                ////////////// ADDED by Christopher Sebastian
                    k = sortedKeys[q];                                     ////////////// ADDED by Christopher Sebastian

                //for (k in value) {                                       ////////////// COMMENTED by Christopher Sebastian
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (
                                gap 
                                    ? ': ' 
                                    : ':'
                            ) + v);
                        }
                    }
                }
            }

// Join all of the member texts together, separated with commas,
// and wrap them in braces.

            v = partial.length === 0
                ? '{}'
                : gap
                    ? '{\n' + gap + partial.join(',\n' + gap) + '\n' + mind + '}'
                    : '{' + partial.join(',') + '}';
            gap = mind;
            return v;
        }
    }

// If the JSON object does not yet have a stringify method, give it one.

    if (typeof JSync.stringify !== 'function') {                                    /////////////////////  EDIT by Christopher Sebastian: JSON --> JSync
        meta = {    // table of character substitutions
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"': '\\"',
            '\\': '\\\\'
        };
        JSync.stringify = function (value, replacer, space) {                        /////////////////////  EDIT by Christopher Sebastian: JSON --> JSync

// The stringify method takes a value and an optional replacer, and an optional
// space parameter, and returns a JSON text. The replacer can be a function
// that can replace values, or an array of strings that will select the keys.
// A default replacer method can be provided. Use of the space parameter can
// produce text that is more easily readable.

            var i;
            gap = '';
            indent = '';

// If the space parameter is a number, make an indent string containing that
// many spaces.

            if (typeof space === 'number') {
                for (i = 0; i < space; i += 1) {
                    indent += ' ';
                }

// If the space parameter is a string, it will be used as the indent string.

            } else if (typeof space === 'string') {
                indent = space;
            }

// If there is a replacer, it must be a function or an array.
// Otherwise, throw an error.

            rep = replacer;
            if (replacer && typeof replacer !== 'function' &&
                    (typeof replacer !== 'object' ||
                    typeof replacer.length !== 'number')) {
                throw new Error('JSync.stringify');                                  /////////////////////  EDIT by Christopher Sebastian: JSON --> JSync
            }

// Make a fake root object containing our value under the key of ''.
// Return the result of stringifying the value.

            return str('', {'': value});
        };
    }

})();

///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
/////////////                       ///////////////////////////////////////////////
/////////////  END JSON2 EXTRACT    ///////////////////////////////////////////////
/////////////                       ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////



JSync.pad = function(s, p, n) {
    while(s.length < n)
        s = p+s;
    return s;
};

var ID_CHARS = '0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHIJKLMNPQRSTUVWXYZ';  // Removed l and O because they are easily confused with 1 and 0.
JSync.generateID = function(len) {
    if(len === undefined) len = 8;
    var id = [];
    while(len--) {
        id[id.length] = ID_CHARS.charAt(Math.floor(Math.random()*ID_CHARS.length));
    }
    return id.join('');
    //var hexStr = Math.floor(Math.random()*0xffffffff).toString(16);
    //while(hexStr.length < 8) hexStr = '0'+hexStr;
    //return '0x' + hexStr;
};

JSync.dsHash = function(s) {
    // The Down Syndrome Hash algorithm, created by Christopher Sebastian.
    // A fast simple hash function for detecting errors, NOT for cryptography!
    // Currently, out of    10,000 hashes, there will be approximately   0 collisions.
    //            out of   100,000 hashes, there will be approximately   8 collisions.
    //            out of 1,000,000 hashes, there will be approximately 190 collisions.
    // ...but to find a collision for a *particular* string, it would be a bit difficult.
    // In contrast, md5 and sha1 have 0 collisions, even after 1,000,000 hashes, but they are much slower (unless you have access to a C implementation, like on NodeJS).
    var hash = 0x12345678,
        i, ii, charCode, shifts;
    for(i=0, ii=s.length; i<ii; i++) {
        charCode = s.charCodeAt(i);
        hash += (charCode+1) * (i+1)
        hash = hash % 0xffffffff;
        shifts = (charCode+1)%32;
        hash = (hash << shifts) | (hash >>> (32-shifts));
    }
    // Finally it is important to convert to hex to avoid negative numbers (which are annoying for our end-user):
    // We need to treat the upper-most 8 bits differently to avoid losing the sign bit (which, in our case, actually contains data, not a sign).
    return '0x' + JSync.pad((hash >>> 24).toString(16), '0', 2) + JSync.pad((hash & 0xffffff).toString(16), '0', 6);
};

// JSync._strArray_startsWith = function(arr, subArr) {
//     if(arr === subArr) return true;
//     if(!_.isArray(arr)) return false;
//     if(!_.isArray(subArr)) return false;
//     if(subArr.length > arr.length) return false;  // Can't start with something longer.
//     var i, ii;
//     for(i=0, ii=subArr.length; i<ii; i++) {
//         if(subArr[i] !== arr[i]) return false;
//     }
//     return true;
// };
JSync.getTarget = function(o, path) {
    if(!o) throw new Error('I need an Object or Array!');
    if(!path) throw new Error('I need a path!');
    if(!_.isArray(path)) throw new Error('path must be an Array: '+path);
    var i, ii;
    for(i=0, ii=path.length; i<ii; i++) {
        o = o[path[i]];
        if(!o) throw new Error('Path not found');
    }
    return o;
}

JSync.deepCopy = function(o) {
    return JSON.parse(JSON.stringify(o));  // There is probably a faster way to deep-copy...
};

JSync._isInt = function(o) {
    return parseInt(o) === o;
};

// The JSync.edit function is used to modify objects, and also
// produce the equivalent delta that represents the same edit operation.
// If you just need a delta, and don't want to actually modify your object,
// then just make a copy first, like this:
//     JSync.edit(JSync.deepCopy(myObj), myOps);
JSync.edit = function(obj, operations) {
    // Note: 'obj' is modified.
    if(!_.isObject(obj))
        throw new Error("Expected 'obj' to be an Object or Array.");
    if(!_.isArray(operations))
        throw new Error("Expected 'operations' to be an Array of OperationSpecs.");
    var origObjStr = JSync.stringify(obj),
        steps = [],
        i, ii, step, op, path, key, value, target;
    var FAIL = function(msg) {
        console.error('Edit Failed.  Rolling back...');
        JSync.applyDelta(obj, JSync.reverseDelta({steps:steps}));
        if(JSync.stringify(obj) === origObjStr) console.error('Rollback Successful.');
        else console.error('Rollback Failed!');
        throw new Error(msg);
    };
    for(i=0, ii=operations.length; i<ii; i++) {
        step = operations[i];
        if(step === undefined) {
            console.log(operations);
            FAIL('STEP IS UNDEFINED!  Occurs on Internet Explorer when you have a trailing comma in one of your data structures.');
        }
        op = step.op;
        path = step.path  ||  [];
        key = step.key;
        value = step.value;
        if(op === undefined)
            FAIL('undefined op!');
        if(key === undefined)
                FAIL('undefined key!');
        target = JSync.getTarget(obj, path);
        switch(op) {
            case 'create':
                if(value === undefined)
                    FAIL('undefined value!');
                if(key in target)
                    FAIL('Already in target: '+key);
                steps[steps.length] = {op:op, path:path, key:key, after:JSync.deepCopy(value)};  // We need to '_deepCopy' because if the object gets modified by future operations, it could affect a reference.
                target[key] = value;
                break;
            case 'update':
                if(value === undefined)
                    FAIL('undefined value!');  // If you want to set something to undefined, just delete instead.
                if(!(key in target))
                    FAIL('Not in target: '+key);
                steps[steps.length] = {op:op, path:path, key:key, before:JSync.deepCopy(target[key]), after:JSync.deepCopy(value)};
                target[key] = value;
                break;
            case 'update!':
                if(value === undefined)
                    FAIL('undefined value!');  // If you want to set something to undefined, just delete instead.
                if(key in target) {
                    // Update.
                    steps[steps.length] = {op:'update', path:path, key:key, before:JSync.deepCopy(target[key]), after:JSync.deepCopy(value)};
                } else {
                    // Create.
                    steps[steps.length] = {op:'create', path:path, key:key, after:JSync.deepCopy(value)};
                }
                target[key] = value;
                break;
            case 'delete':
                if(!(key in target))
                    FAIL('Not in target: '+key);
                steps[steps.length] = {op:op, path:path, key:key, before:JSync.deepCopy(target[key])};
                delete target[key];
                break;
            case 'arrayInsert':
                if(!JSync._isInt(key))
                    FAIL('Expected an integer key!');
                if(!_.isArray(target))
                    FAIL('create:arrayInsert: Expected an Array target!');
                if(key<0  ||  key>target.length)
                    FAIL('IndexError');
                steps[steps.length] = {op:op, path:path, key:key, after:JSync.deepCopy(value)};
                target.splice(key, 0, value);
                break;
            case 'arrayRemove':
                if(!JSync._isInt(key))
                    FAIL('Expected an integer key!');
                if(!_.isArray(target))
                    FAIL('create:arrayRemove: Expected an Array target!');
                if(key<0  ||  key>=target.length)
                    FAIL('IndexError');
                steps[steps.length] = {op:op, path:path, key:key, before:JSync.deepCopy(target[key])};
                target.splice(key, 1);
                break;
            default:
                FAIL('Illegal operation: '+op);
        }
    }
    return {steps:steps};
};
JSync.reverseDelta = function(delta) {
    if(!_.isObject(delta))
        throw new Error('Expected a Delta object!');
    if(delta.steps === undefined)
        throw new Error("Not a Delta object!");
    var reversedSteps = [],
        i, fstep, rstep, op;  // 2012-11-16: I think 'fstep' means "forward step", and 'rstep' means "reverse step".
    for(i=delta.steps.length-1; i>=0; i--) {
        fstep = delta.steps[i];
        if(!('path' in fstep)) throw new Error('Missing "path"');
        if(!('key' in fstep)) throw new Error('Missing "key"');
        rstep = {path:fstep.path, key:fstep.key};
        switch(fstep.op) {
            case 'create':
                if('before' in fstep) throw new Error('Unexpcted "before"');
                if(!('after' in fstep)) throw new Error('Missing "after"');
                rstep.op = 'delete';
                rstep.before = fstep.after;
                break;
            case 'update':
                if(!('before' in fstep)) throw new Error('Missing "before"');
                if(!('after' in fstep)) throw new Error('Missing "after"');
                rstep.op = 'update';
                rstep.before = fstep.after;
                rstep.after = fstep.before;
                break;
            case 'delete':
                if('after' in fstep) throw new Error('Unexpected "after"');
                if(!('before' in fstep)) throw new Error('Missing "before"');
                rstep.op = 'create';
                rstep.after = fstep.before;
                break;
            case 'arrayInsert':
                if('before' in fstep) throw new Error('Unexpected "before"');
                if(!('after' in fstep)) throw new Error('Missing "after"');
                rstep.op = 'arrayRemove';
                rstep.before = fstep.after;
                break;
            case 'arrayRemove':
                if(!('before' in fstep)) throw new Error('Missing "before"');
                if('after' in fstep) throw new Error('Unexpected "after"');
                rstep.op = 'arrayInsert';
                rstep.after = fstep.before;
                break;
            default:
                throw new Error('Illegal operation: '+op);
        }
        reversedSteps[reversedSteps.length] = rstep;
    }
    return {steps:reversedSteps};
};
JSync.applyDelta = function(obj, delta) {
    // Note: 'obj' is modified.
    if(!_.isObject(obj))
        throw new Error("Expected 'obj' to be an Object or Array.");
    if(!_.isObject(delta))
        throw new Error("Expected 'delta' to be a Delta object.");
    if(!_.isArray(delta.steps))
        throw new Error('Invalid Delta object.');
    var origObjStr = JSync.stringify(obj),
        steps = delta.steps,
        i, ii, step, op, path, key, target;
    var FAIL = function(msg) {
        console.error('Delta Application Failed.  Rolling back...');
        JSync.applyDelta(obj, JSync.reverseDelta({steps:delta.steps.slice(0,i)}));
        if(JSync.stringify(obj) === origObjStr) console.error('Rollback Successful.');
        else console.error('Rollback Failed!');
        throw new Error(msg);
    };
    for(i=0, ii=steps.length; i<ii; i++) {
        step = steps[i];
        path = step.path;
        if(!path) FAIL('undefined path!');
        key = step.key;
        if(key===undefined || key===null) FAIL('undefined key!');  // Cannot just say '!key' because key could be 0 for array ops.
        target = JSync.getTarget(obj, path);

        switch(step.op) {
            case 'create':
            case 'update':
            case 'delete':
                if('before' in step) {
                    if(!(key in target))
                        FAIL('Not in target: '+key);
                    if( JSync.stringify(target[key]) !== JSync.stringify(step.before) )
                        FAIL("'before' value did not match!");
                } else {
                    if(key in target)
                        FAIL('Unexpectedly in target: '+key);
                }

                if('after' in step) {
                    target[key] = JSync.deepCopy(step.after);  // We must '_deepCopy', otherwise the object that the delta references could be modified externally, resulting in totally unexpected mutation.
                } else {
                    if(key in target) {
                        delete target[key];
                    }
                }
                break;
            case 'arrayInsert':
                if(!JSync._isInt(key))
                    FAIL('Expected an integer key!');
                if(!_.isArray(target))
                    FAIL('applyDelta:arrayInsert: Expected an Array target!');
                if(key<0  ||  key>target.length)
                    FAIL('IndexError');
                if(step.after === undefined)
                    FAIL('undefined "after"!');
                target.splice(key, 0, JSync.deepCopy(step.after))
                break;
            case 'arrayRemove':
                if(!JSync._isInt(key))
                    FAIL('Expected an integer key!');
                if(!_.isArray(target))
                    FAIL('applyDelta:arrayRemove: Expected an Array target!');
                if(key<0  ||  key>=target.length)
                    FAIL('IndexError');
                if( JSync.stringify(target[key]) !== JSync.stringify(step.before) )
                    FAIL('Array value did not match!');
                target.splice(key, 1);
                break;
            default:
                FAIL('Illegal operation: '+step.op);
        }
    }
    return obj; // For chaining...
};



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This second section deals with higher-level "state" objects, which have Event capabilities.  Still no network requirements.
// Useful for UI patterns, even without network.
//

JSync.State = function(initialData) {
    if(!(this instanceof JSync.State)) return new JSync.State(initialData);
    this._dispatcher = JSync.Dispatcher();
    this.data = initialData || {};
};
JSync.State.prototype.on = function(callback, context) {
    return this._dispatcher.on(callback, context);
};
JSync.State.prototype.off = function(callback, context) {
    return this._dispatcher.off(callback, context);
};
JSync.State.prototype.edit = function(operations) {
    var delta = JSync.edit(this.data, operations);
    this._dispatcher.trigger(this, delta);
};
JSync.State.prototype.applyDelta = function(delta) {
    JSync.applyDelta(this.data, delta);
    this._dispatcher.trigger(this, delta);
};

JSync.ALL = {};
JSync.Dispatcher = function() {
    if(!(this instanceof JSync.Dispatcher)) return new JSync.Dispatcher();
    this.listeners = [];
};
JSync.Dispatcher.prototype.on = function(callback, context) {
    this.listeners[this.listeners.length] = {callback:callback, context:context};
};
JSync.Dispatcher.prototype.off = function(callback, context) {
    var i, l;
    for(i=this.listeners.length-1; i>=0; i--) {
        l = this.listeners[i];
        if( (l.callback===callback && l.context===context) || (callback==JSync.ALL) )
            this.listeners.splice(i, 1);  // Remove.
    }
};
JSync.Dispatcher.prototype.trigger = function() {
    var args = Array.prototype.slice.call(arguments);
    var Ls = this.listeners.slice(),  // Make a copy because listeners can be modified from the event handlers (like removing the handlers for one-shot handlers).
        el, i, ii;
    for(i=0, ii=Ls.length; i<ii; i++) {
        el = Ls[i];
        // Fire!
        el.callback.apply(el.context, args);
    }
};



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This third section deals with network connectivity.
//
// Note that authentication and usernames have no place in this client framework.
// All those access-control details are dealt with on the server-side.
// "Logging in" and similar operations must be defined on a per-app basis.  They can't be defined in a
// simple-enough-yet-general-enough way, so I'm just leaving it out of this framework.
// At this level, we only care about the ConnectionID and BrowserID.


JSync.extraAjaxOptions = { xhrFields: {withCredentials:true} };    // Enable CORS cookies.
if(jQuery  &&  !jQuery.support.cors) JSync.extraAjaxOptions = {};  // If you try to use the 'withCredentials' field on IE6, you get an exception.

JSync.getBrowser = function() {   // I am adding this here because jQuery has removed 'browser' support.
                                       // Mostly taken from: https://github.com/jquery/jquery-migrate/blob/master/src/core.js
    var ua = navigator.userAgent.toLowerCase();

    var match = /(chrome)[ \/]([\w.]+)/.exec( ua ) ||  // What about Chromium?  -- Ah, Chromium also includes 'Chrome' in the UserAgent.
        /(webkit)[ \/]([\w.]+)/.exec( ua ) ||
        /(opera)(?:.*version|)[ \/]([\w.]+)/.exec( ua ) ||  // I really need to separate Old Opera from New Opera (which is actually Chrome).
        /(msie) ([\w.]+)/.exec( ua ) ||
        ua.indexOf("compatible") < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec( ua ) ||
        [];

    return {
        browser: match[ 1 ] || "",
        version: match[ 2 ] || "0"
    };
};

JSync.Client = function(url) {
    // Guard against forgetting the 'new' operator:
    if(!(this instanceof JSync.Client)) return new JSync.Client(url);
    var self = this;

    this.maxSendBundleBytes = 100*1024;
    this.successReceiveReconnectMS = 1;

    if(!_.isString(url)) throw new Error('You must provide a base url.');
    this._url = url;
    this.connectionID = null;
    this.browserID = null;
    this._ajaxSingletons = {};
    this._activeAJAX = [];

    console.log('Still need to installAutoUnloader()');
};
JSync.Client.prototype._handleAjaxErrorCodes = function(jqXHR) {
    // If jqXHR.status is 0, it means there is a problem with cross-domain communication, and Javascript has been dis-allowed access to the XHR object.
    if(jqXHR.status === 401) {
        // Our connectionID has been deleted because it was idle.
        // We need to login again.
        if(typeof console !== 'undefined') console.log('connectionID Lost.  Reconnecting...');
        this.connect();
        return true;
    } else if(jqXHR.status === 403) {
        // Our IP has changed, and our cookie has been changed.
        // We need to login and re-join again.
        if(typeof console !== 'undefined') console.log('browserID Lost.  Reconnecting...');
        this.reconnect();
        return true;
    }
    return false;
};
JSync.Client.prototype.ajax = function(options) {
    // A robust, commonly-used convenience function.
    var self = this,
        errRetryMS = options.errRetryMS || 1000,
        errRetryMaxMS = options.errRetryMaxMS || 120000;
    var DOIT = function() {
        if(options.singleton) {
            if(self._ajaxSingletons[options.singleton]) return;
            self._ajaxSingletons[options.singleton] = true;
        }
        var myRequest = [null];
        var cleanup = function() {
            for(var i=self._activeAJAX.length-1; i>=0; i--) {
                if(self._activeAJAX[i] === myRequest[0]) self._activeAJAX.splice(i,1);
            }
            if(options.singleton) self._ajaxSingletons[options.singleton] = false;
        };
        myRequest[0] = self._activeAJAX[self._activeAJAX.length] = jQuery.ajax(_.extend({
            url:options.url,
            type:options.type,
            data:options.data,
            dataType:'json',      // For some reason, FireFox ignores the server's content-type for CORS requests.  >:(
            jsonp:false,          // Prevent jQuery from auto-converting "dataType:json" to "dataType:jsonp" for cross-domain requests.
            cache:false,
            success:function(data, retCodeStr, jqXHR) {
                //console.log('SUCCESS: data:', data, 'retCodeStr:', retCodeStr, 'jqXHR:', jqXHR);
                cleanup();
                return options.onSuccess.call(options, data, retCodeStr, jqXHR);
            },
            error:function(jqXHR, retCodeStr, exceptionObj) {
                //console.log('ERROR:', jqXHR, retCodeStr, exceptionObj);
                cleanup();
                if(!options.doNotRetry) {
                    if(options.requireConnection) self._handleAjaxErrorCodes(jqXHR);   //  Auto-reconnect.
                    setTimeout(DOIT, errRetryMS);
                }
                errRetryMS *= 1.62; if(errRetryMS > errRetryMaxMS) errRetryMS = errRetryMaxMS;
                if(options.onError) options.onError.call(options, jqXHR, retCodeStr, exceptionObj);
                else throw exceptionObj;  // Occurs when there is a problem connecting to the server.
            }//,
            //// The COMPLETE function is always called after success and error, so for us it's redundant:
            //complete:function(jqXHR, retCodeStr) {
            //    console.log('COMPLETE:', jqXHR, retCodeStr);
            //    cleanup();
            //}
        }, JSync.extraAjaxOptions, options.ajaxOpts));
    };
    if(options.requireConnection) return this.getConnectionInfo(DOIT);
    else return DOIT();
};
JSync.Client.prototype.connect = function(callback) {
    var self = this;
    this.ajax({
        errRetryMaxMS:30000,
        url:self._url+'/connect',
        type:'POST',
        data:{op:'connect'},
        onSuccess:function(data, retCodeStr, jqXHR) {
            if(!_.isObject(data)) throw new Error('Expected object from server!');
            self.connectionID = data.connectionID;
            self.browserID = data.browserID;
            console.log('Connected.  Do I need to re-fetch all states?');
            if(callback) return callback(self);
        },
    });
};
JSync.Client.prototype.disconnect = function(callback, sync) {
    if(!this.connectionID) { // Already logged out.
        if(callback) return callback(this);
        return
    }
    this.ajax({
        doNotRetry:true,
        ajaxOpts:{async:!sync},
        url:self._url+'/disconnect',
        type:'POST',
        data:{op:'disconnect',
              connectionID:self.connectionID},
        onSuccess:function(data, retCodeStr, jqXHR) {
            if(!_.isObject(data)) throw new Error('Expected object from server!');
            self.connectionID = null;
            for(var i=self._activeAJAX.length-1; i>=0; i--) {
                try { self._activeAJAX[i].abort();  // This actually *runs* the error handlers and thrown exceptions will pop thru our stack if we don't try...catch this.
                } catch(e) {}
                self._activeAJAX.splice(i, 1);
            }
            if(callback) return callback(self);
        },
        onError:function(jqXHR, retCodeStr, exceptionObj) {
            console.log('Error logging out:', exceptionObj);
            if(callback) return callback(self);
        }
    });
};
JSync.Client.prototype.reconnect = function() {
    var self = this;
    this.disconnect(function() {
        self.connect(function() {
            console.log('Reconnected.  Do I need to re-fetch all states?');
        });
    });
};
JSync.Client.prototype.getConnectionInfo = function(callback) {  // You can use this like a 'waitForConnection()' function.
    // This function was added 2012-11-07 to enable me to create more reliable communications.
    var self = this;
    var check = function() {
        if(self.connectionID) return callback({connectionID:self.connectionID, browserID:self.browserID});
        setTimeout(check, 100);
    };
    return check();
};
JSync.Client.prototype.onMessage = function(callback) {
};
JSync.Client.prototype.offMessage = function(callback) {
};
JSync.Client.prototype.getState = function(stateID, onSuccess, onError) {
};
JSync.Client.prototype.fetchState = function(stateID, onSuccess, onError) {
};
JSync.Client.prototype.installAutoUnloader = function() {
    if(typeof window === 'undefined') return;
    var self = this;
    window.onbeforeunload = function(e) {
        if(JSync.getBrowser().browser == 'mozilla') {
            // Firefox does not support "withCredentials" for cross-domain synchronous AJAX... and can therefore not pass the cookie unless we use async.   (This might just be the most arbitrary restriction of all time.)
            self.logout();
            var startTime = new Date().getTime();
            while(self.connectionID  &&  (new Date().getTime()-startTime)<3000) {  // We must loop a few times for older versions of FF because they first issue preflighted CORS requests, which take extra time.
                // Issue a synchronouse request to give the above async some time to get to the server.
                jQuery.ajax({url:'/jsync_gettime',
                             cache:false,
                             async:false});
            }
        } else {
            self.logout(null, true);  // Use a synchronous request.
            // IE likes to fire this event A LOT!!!  Every time you click a link that does not start with '#', this gets
            // triggered, even if you have overridden the click() event, or specified a 'javascript:' href.
            // The best solution to this problem is the set your hrefs to "#" and then return false from your click handler.
            // Here is a console message to help me to understand this issue when it occurs:
            setTimeout(function() {console.log('Note: window.onbeforeunload has been triggered.  This occurs in IE when you click a link that does not have a # href.')}, 5000);
        }
    };
};

})();
