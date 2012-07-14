//  JsonDelta - JSON Delta Edits
//  (c) 2012 LikeBike LLC
//  JsonDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


// Heavily inspired by: http://tools.ietf.org/html/draft-pbryan-json-patch-00


(function() {


// First, install ourselves and import our dependencies:
var JDELTA = {},
    _;
if(exports !== undefined) {
    // We are on Node.
    exports.JDELTA = JDELTA;
    _ = require('underscore'),
    Backbone = require('backbone');
} else if(window !== undefined) {
    // We are in a browser.
    window.JDELTA = JDELTA;
    _ = window._,
    Backbone = window.Backbone;
} else throw new Error('This environment is not yet supported.');
    

JDELTA.VERSION = '0.2.0a';



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

    var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        gap,
        indent,
        meta = {    // table of character substitutions
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
        },
        rep;


    function quote(string) {

// If the string contains no control characters, no quote characters, and no
// backslash characters, then we can safely slap some quotes around it.
// Otherwise we must also replace the offending characters with safe escape
// sequences.

        escapable.lastIndex = 0;
        return escapable.test(string) ? '"' + string.replace(escapable, function (a) {
            var c = meta[a];
            return typeof c === 'string'
                ? c
                : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"' : '"' + string + '"';
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

            return isFinite(value) ? String(value) : 'null';

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
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
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
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
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
        }                                                                          //////////////////  NOTE by Christopher Sebastian: End of switch.
    }                                                                              //////////////////  NOTE by Christopher Sebastian: End of str().

// If the JSON object does not yet have a stringify method, give it one.

    if (typeof JDELTA.stringify !== 'function') {                                   //////////////////  EDIT by Christopher Sebastian: JSON --> JDELTA
        JDELTA.stringify = function (value, replacer, space) {                      //////////////////  EDIT by Christopher Sebastian: JSON --> JDELTA

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
                throw new Error('JDELTA.stringify');                                //////////////////  EDIT by Christopher Sebastian: JSON --> JDELTA
            }

// Make a fake root object containing our value under the key of ''.
// Return the result of stringifying the value.

            return str('', {'': value});
        };
    }

}());

///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
/////////////                       ///////////////////////////////////////////////
/////////////  END JSON2 EXTRACT    ///////////////////////////////////////////////
/////////////                       ///////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////






JDELTA._hash = function(s) {
    // A fast, simple, (stupid) hash function for detecting errors, NOT for cryptography!
    // Based on: http://stackoverflow.com/questions/811195/fast-open-source-checksum-for-small-strings
    var chk = 0x12345678,
        i, ii;
    for(i=0, ii=s.length; i<ii; i++) {
        chk += (s.charCodeAt(i)+1) * (i+1)
        chk = chk % 0xffffffff;
    }
    return chk;
};


JDELTA._getTarget = function(o, path) {
    if(!o)
        throw new Error('I need an Object or Array!');
    if(!path)
        throw new Error('I need a path!');
    var pieces = path.split('.');
    if(pieces[0] !== '$')
        throw new Error('The first path item must be $!');
    var i, ii;
    for(i=1, ii=pieces.length; i<ii; i++) {
        o = o[pieces[i]];
        if(!o)
            throw new Error('Path not found');
    }
    return o;
}

JDELTA._deepCopy = function(o) {
    return JSON.parse(JSON.stringify(o));  // There is probably a faster way to deep-copy...
};

JDELTA._isInt = function(o) {
    return parseInt(o) === o;
};

JDELTA.create = function(state, operations) {
    if(!_.isObject(state))
        throw new Error("Expected 'state' to be an Object or Array.");
    if(!_.isArray(operations))
        throw new Error("Expected 'operations' to be an Array of OperationSpecs.");
    var stateCopy = JDELTA._deepCopy(state),
        steps = [],
        i, ii, step, op, path, key, value, target, before;
    for(i=0, ii=operations.length; i<ii; i++) {
        step = operations[i];
        op = step.op;
        path = step.path  ||  '$';
        key = step.key;
        value = step.value;
        if(op === undefined)
            throw new Error('undefined op!');
        if(key === undefined)
                throw new Error('undefined key!');
        target = JDELTA._getTarget(stateCopy, path);
        switch(op) {
            case 'create':
                if(value === undefined)
                    throw new Error('undefined value!');
                if(key in target)
                    throw new Error('Already in target: '+key);
                steps[steps.length] = {path:path, key:key, after:JDELTA._deepCopy(value)};  // We need to '_deepCopy' because if the object gets modified by future operations, it could affect a reference.
                target[key] = value;
                break;
            case 'update':
                if(value === undefined)
                    throw new Error('undefined value!');
                if(!(key in target))
                    throw new Error('Not in target: '+key);
                steps[steps.length] = {path:path, key:key, before:JDELTA._deepCopy(target[key]), after:JDELTA._deepCopy(value)};
                target[key] = value;
                break;
            case 'delete':
                if(!(key in target))
                    throw new Error('Not in target: '+key);
                steps[steps.length] = {path:path, key:key, before:JDELTA._deepCopy(target[key])};
                delete target[key];
                break;
            case 'arrayInsert':
                if(!JDELTA._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('create:arrayInsert: Expected an Array target!');
                if(key<0  ||  key>target.length)
                    throw new Error('IndexError');
                steps[steps.length] = {op:'arrayInsert', path:path, key:key, value:JDELTA._deepCopy(value)};
                target.splice(key, 0, value);
                break;
            case 'arrayRemove':
                if(!JDELTA._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('create:arrayRemove: Expected an Array target!');
                if(key<0  ||  key>=target.length)
                    throw new Error('IndexError');
                steps[steps.length] = {op:'arrayRemove', path:path, key:key, value:JDELTA._deepCopy(target[key])};
                target.splice(key, 1);
                break;
            default:
                throw new Error('Illegal operation: '+op);
        }
    }
    return {steps:steps};
};
JDELTA.reverse = function(delta) {
    if(!_.isObject(delta))
        throw new Error('Expected a Delta object!');
    if(delta.steps === undefined)
        throw new Error("Not a Delta object!");
    var reversedSteps = [],
        i, fstep, rstep, op;
    for(i=delta.steps.length-1; i>=0; i--) {
        fstep = delta.steps[i];
        rstep = {path:fstep.path, key:fstep.key};
        op = fstep.op  ||  'obj';
        switch(op) {
            case 'obj':
                if('after' in fstep)
                    rstep.before = fstep.after;
                if('before' in fstep)
                    rstep.after = fstep.before;
                break;
            case 'arrayInsert':
                rstep.op = 'arrayRemove';
                rstep.value = fstep.value;
                break;
            case 'arrayRemove':
                rstep.op = 'arrayInsert';
                rstep.value = fstep.value;
                break;
            default:
                throw new Error('Illegal operation: '+op);
        }
        reversedSteps[reversedSteps.length] = rstep;
    }
    return {steps:reversedSteps};
};
JDELTA.patch = function(state, delta, dispatcher) {
    // Note: 'state' is modified.
    if(!_.isObject(state))
        throw new Error("Expected first arg to be an Object or Array.");
    if(!_.isObject(delta))
        throw new Error('Expected second arg to be a Delta object.');
    if(!_.isArray(delta.steps))
        throw new Error('Invalid Delta object.');
    var steps = delta.steps,
        events = [],  //  Queue the events until the end in case we fail (and roll-back) half-way thru.
        i, ii, step, op, path, key, target;
    for(i=0, ii=steps.length; i<ii; i++) {
        step = steps[i];
        op = step.op  ||  'obj';
        path = step.path;
        if(path === undefined)
            throw new Error('undefined path!');
        key = step.key;
        if(key === undefined)
            throw new Error('undefined key!');
        target = JDELTA._getTarget(state, path);

        switch(op) {
            case 'obj':
                if('before' in step) {
                    if(!(key in target))
                        throw new Error('Not in target: '+key);
                    if( JDELTA.stringify(target[key]) !== JDELTA.stringify(step.before) )
                        throw new Error("'before' value did not match!");
                } else {
                    if(key in target)
                        throw new Error('Unexpectedly in target: '+key);
                }

                if('after' in step) {
                    target[key] = JDELTA._deepCopy(step.after);  // We must '_deepCopy', otherwise the object that the delta references could be modified externally, resulting in totally unexpected mutation.
                    events[events.length] = [path, {op:'set', path:path, key:key, value:target[key]}];
                } else {
                    if(key in target) {
                        delete target[key];
                        events[events.length] = [path, {op:'delete', path:path, key:key}];
                    }
                }
                break;
            case 'arrayInsert':
                if(!JDELTA._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('patch:arrayInsert: Expected an Array target!');
                if(key<0  ||  key>target.length)
                    throw new Error('IndexError');
                if(step.value === undefined)
                    throw new Error('undefined value!');
                target.splice(key, 0, JDELTA._deepCopy(step.value))
                events[events.length] = [path, {op:'arrayInsert', path:path, key:key, value:target[key]}];
                break;
            case 'arrayRemove':
                if(!JDELTA._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('patch:arrayRemove: Expected an Array target!');
                if(key<0  ||  key>=target.length)
                    throw new Error('IndexError');
                if( JDELTA.stringify(target[key]) !== JDELTA.stringify(step.value) )
                    throw new Error('Array value did not match!');
                target.splice(key, 1);
                events[events.length] = [path, {op:'arrayRemove', path:path, key:key}];
                break;
            default:
                throw new Error('Illegal operation: '+op);
        }
    }

    // TODO: Handle Roll-back on error.

    // We made it thru all the steps.  Now send out the events.
    // TODO: Maybe add event "compression" (for example, if step 1 sets 'a' to 1, then step 2 sets 'a' to 2, then maybe you only need to send out the second event.)   Not a high priority for now because i don't really expect this functionality to make much of a difference for normal situations.
    if(dispatcher) {
        for(i=0, ii=events.length; i<ii; i++) {
            dispatcher.trigger.apply(dispatcher, events[i]);
        }
    }
    return state; // For chaining...
};

JDELTA.createDispatcher = function() {
    // This function is here mostly so that our end-users don't need to import Underscore and Backbone just to create a dispatcher.
    return _.clone(Backbone.Events);
};

})();
