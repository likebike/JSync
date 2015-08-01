"use strict";

(function() {
    
// First, install ourselves and import our dependencies:
var JSync = {},
    _,
    jQuery,     // Browser only.
    undefined;  // So 'undefined' really is undefined.
if(typeof exports !== 'undefined') {
    // We are on Node.
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
    eq(JSync.getTarget({a:{b:'c'}},['a','b']), 'c');
    eq(JSync.stringify(JSync.deepCopy({a:[1,2,'3']})), '{"a":[1,2,"3"]}');
    eq(JSync._isInt(5), true);
    eq(JSync._isInt('5'), false);
    var state = {a:1};
    var ops = [{op:'create', path:[], key:'b', value:{x:24}},
               {op:'update!', path:['b'], key:'c', value:3},
               {op:'update', path:['b'], key:'c', value:[30]},
               {op:'delete', path:[], key:'a'},
               {op:'arrayInsert', path:['b','c'], key:0, value:'item-0'},
               {op:'arrayRemove', path:['b','c'], key:1}];
    var delta = JSync.createDelta(state, ops);
    eq(JSync.stringify(delta), '{"steps":[{"after":{"x":24},"key":"b","path":[]},{"after":3,"key":"c","path":["b"]},{"after":[30],"before":3,"key":"c","path":["b"]},{"before":1,"key":"a","path":[]},{"key":0,"op":"arrayInsert","path":["b","c"],"value":"item-0"},{"key":1,"op":"arrayRemove","path":["b","c"],"value":30}]}');
    eq(JSync.stringify(JSync.reverseDelta(delta)), '{"steps":[{"key":1,"op":"arrayInsert","path":["b","c"],"value":30},{"key":0,"op":"arrayRemove","path":["b","c"],"value":"item-0"},{"after":1,"key":"a","path":[]},{"after":3,"before":[30],"key":"c","path":["b"]},{"before":3,"key":"c","path":["b"]},{"before":{"x":24},"key":"b","path":[]}]}');
    eq(JSync.stringify(delta), JSync.stringify(JSync.reverseDelta(JSync.reverseDelta(delta))));
    eq(JSync.stringify(JSync.patch(JSync.deepCopy(state),delta)), '{"b":{"c":["item-0"],"x":24}}');
    eq(JSync.stringify(JSync.render(JSync.deepCopy(state),[delta,JSync.reverseDelta(delta)])), '{"a":1}');
    var d = JSync.Dispatcher();
    var out1 = null,
        out2 = {};
    d.on(function(val) {out1 = val});
    d.on(function(val) {this.x = val}, out2);
    d.trigger(123);
    eq(out1, 123);
    eq(JSync.stringify(out2), '{"x":123}');
};


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

JSync.createDelta = function(state, operations) {
    if(!_.isObject(state))
        throw new Error("Expected 'state' to be an Object or Array.");
    if(!_.isArray(operations))
        throw new Error("Expected 'operations' to be an Array of OperationSpecs.");
    var stateCopy = JSync.deepCopy(state),
        steps = [],
        i, ii, step, op, path, key, value, target, before;
    for(i=0, ii=operations.length; i<ii; i++) {
        step = operations[i];
        if(step === undefined) {
            console.log(operations);
            throw new Error('STEP IS UNDEFINED!  Occurs on Internet Explorer when you have a trailing comma in one of your data structures.');
        }
        op = step.op;
        path = step.path  ||  [];
        key = step.key;
        value = step.value;
        if(op === undefined)
            throw new Error('undefined op!');
        if(key === undefined)
                throw new Error('undefined key!');
        target = JSync.getTarget(stateCopy, path);
        switch(op) {
            case 'create':
                if(value === undefined)
                    throw new Error('undefined value!');
                if(key in target)
                    throw new Error('Already in target: '+key);
                steps[steps.length] = {path:path, key:key, after:JSync.deepCopy(value)};  // We need to '_deepCopy' because if the object gets modified by future operations, it could affect a reference.
                target[key] = value;
                break;
            case 'update':
                if(value === undefined)
                    throw new Error('undefined value!');  // If you want to set something to undefined, just delete instead.
                if(!(key in target))
                    throw new Error('Not in target: '+key);
                steps[steps.length] = {path:path, key:key, before:JSync.deepCopy(target[key]), after:JSync.deepCopy(value)};
                target[key] = value;
                break;
            case 'update!':
                if(value === undefined)
                    throw new Error('undefined value!');  // If you want to set something to undefined, just delete instead.
                if(key in target) {
                    // Update.
                    steps[steps.length] = {path:path, key:key, before:JSync.deepCopy(target[key]), after:JSync.deepCopy(value)};
                } else {
                    // Create.
                    steps[steps.length] = {path:path, key:key, after:JSync.deepCopy(value)};
                }
                target[key] = value;
                break;
            case 'delete':
                if(!(key in target))
                    throw new Error('Not in target: '+key);
                steps[steps.length] = {path:path, key:key, before:JSync.deepCopy(target[key])};
                delete target[key];
                break;
            case 'arrayInsert':
                if(!JSync._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('create:arrayInsert: Expected an Array target!');
                if(key<0  ||  key>target.length)
                    throw new Error('IndexError');
                steps[steps.length] = {op:'arrayInsert', path:path, key:key, value:JSync.deepCopy(value)};
                target.splice(key, 0, value);
                break;
            case 'arrayRemove':
                if(!JSync._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('create:arrayRemove: Expected an Array target!');
                if(key<0  ||  key>=target.length)
                    throw new Error('IndexError');
                steps[steps.length] = {op:'arrayRemove', path:path, key:key, value:JSync.deepCopy(target[key])};
                target.splice(key, 1);
                break;
            default:
                throw new Error('Illegal operation: '+op);
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
JSync.patch = function(state, delta, dispatcher) {
    // Note: 'state' is modified.
    if(!_.isObject(state))
        throw new Error("Expected 'state' to be an Object or Array.");
    if(!_.isObject(delta))
        throw new Error("Expected 'delta' to be a Delta object.");
    if(!_.isArray(delta.steps))
        throw new Error('Invalid Delta object.');
    var steps = delta.steps,
        events = [],  //  Queue the events until the end in case we fail (and roll-back) half-way thru.
        i, ii, step, op, path, key, target;
    for(i=0, ii=steps.length; i<ii; i++) {
        step = steps[i];
        op = step.op  ||  'obj';
        path = step.path;
        if(!path) throw new Error('undefined path!');
        key = step.key;
        if(key===undefined || key===null) throw new Error('undefined key!');  // Cannot just say '!key' because key could be 0 for array ops.
        target = JSync.getTarget(state, path);

        switch(op) {
            case 'obj':
                if('before' in step) {
                    if(!(key in target))
                        throw new Error('Not in target: '+key);
                    if( JSync.stringify(target[key]) !== JSync.stringify(step.before) )
                        throw new Error("'before' value did not match!");
                } else {
                    if(key in target)
                        throw new Error('Unexpectedly in target: '+key);
                }

                if('after' in step) {
                    target[key] = JSync.deepCopy(step.after);  // We must '_deepCopy', otherwise the object that the delta references could be modified externally, resulting in totally unexpected mutation.
                    events[events.length] = [{op:'set', path:path, key:key, value:JSync.deepCopy(target[key])}];
                } else {
                    if(key in target) {
                        delete target[key];
                        events[events.length] = [{op:'delete', path:path, key:key}];
                    }
                }
                break;
            case 'arrayInsert':
                if(!JSync._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('patch:arrayInsert: Expected an Array target!');
                if(key<0  ||  key>target.length)
                    throw new Error('IndexError');
                if(step.value === undefined)
                    throw new Error('undefined value!');
                target.splice(key, 0, JSync.deepCopy(step.value))
                events[events.length] = [{op:'arrayInsert', path:path, key:key, value:JSync.deepCopy(target[key])}];
                break;
            case 'arrayRemove':
                if(!JSync._isInt(key))
                    throw new Error('Expected an integer key!');
                if(!_.isArray(target))
                    throw new Error('patch:arrayRemove: Expected an Array target!');
                if(key<0  ||  key>=target.length)
                    throw new Error('IndexError');
                if( JSync.stringify(target[key]) !== JSync.stringify(step.value) )
                    throw new Error('Array value did not match!');
                target.splice(key, 1);
                events[events.length] = [{op:'arrayRemove', path:path, key:key}];
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

JSync.render = function(state, deltas) {
    var i, ii;
    for(i=0, ii=deltas.length; i<ii; i++) JSync.patch(state, deltas[i]);
    return state;
};


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
        if(l.callback===callback && l.context===context)
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





JSync.extraAjaxOptions = { xhrFields: {withCredentials:true} };    // Enable CORS cookies.
if(jQuery  &&  !jQuery.support.cors) JSync.extraAjaxOptions = {};  // If you try to use the 'withCredentials' field on IE6, you get an exception.

JSync.getBrowser = function() {   // I am adding this here because jQuery has removed 'browser' support.
                                       // Mostly taken from: https://github.com/jquery/jquery-migrate/blob/master/src/core.js
    var ua = navigator.userAgent.toLowerCase();

    var match = /(chrome)[ \/]([\w.]+)/.exec( ua ) ||
        /(webkit)[ \/]([\w.]+)/.exec( ua ) ||
        /(opera)(?:.*version|)[ \/]([\w.]+)/.exec( ua ) ||
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
    this.successReceiveReconnectMS = 10;
    this.errorResetReconnectMS = 10000;

    if(!_.isString(url)) throw new Error('You must provide a base url.');
    this._url = url;
    this.connectionID = null;
    // ...
};

JSync.Client._ajaxSingletons = {};
JSync.Client.prototype.ajax = function(options) {
    // A robust, commonly-used convenience function.
    var self = this;
    if(options.login) {  //  Auto-Login.
        if(!this.connectionID) return setTimeout(function() {self.ajax(options)}, 1000);
    }
    var errRetryMS = 1000;
    var DOIT = function() {
        if(options.singleton) {
            if(JSync.Client._ajaxSingletons[options.singleton]) return;
            JSync.Client._ajaxSingletons[options.singleton] = true;
        }
        var myRequest = self._activeAJAX[self._activeAJAX.length] = jQuery.ajax(_.extend({
            url:options.url,
            type:options.type,
            data:options.data,
            dataType:'json',
            cache:false,
            success:function(data, retCodeStr, jqXHR) {
                //console.log('SUCCESS: data:', data, 'retCodeStr:', retCodeStr, 'jqXHR:', jqXHR);
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                if(options.singleton) JSync.Client._ajaxSingletons[options.singleton] = false;
                return options.onSuccess.call(options, data, retCodeStr, jqXHR);
            },
            error:function(jqXHR, retCodeStr, exceptionObj) {
                //console.log('ERROR:', jqXHR, retCodeStr, exceptionObj);
                for(var i=self._activeAJAX.length-1; i>=0; i--) {
                    if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
                }
                if(options.singleton) JSync.Client._ajaxSingletons[options.singleton] = false;
                var keepGoing = true;
                if(options.onError) keepGoing = options.onError.call(options, jqXHR, retCodeStr, exceptionObj);
                if(keepGoing) {
                    if(options.login) self._handleAjaxErrorCodes(jqXHR);   //  Auto-login.
                    setTimeout(DOIT, errRetryMS);
                }
                errRetryMS *= 1.62; if(errRetryMS > 120000) errRetryMS = 120000;
                throw exceptionObj;  // Occurs when there is a problem connecting to the server.
            }//,
            //// The COMPLETE function is always called after success and error, so for us it's redundant:
            //complete:function(jqXHR, retCodeStr) {
            //    console.log('COMPLETE:', jqXHR, retCodeStr);
            //    for(var i=self._activeAJAX.length-1; i>=0; i--) {
            //        if(self._activeAJAX[i] === myRequest) self._activeAJAX.splice(i,1);
            //    }
            //    if(options.singleton) JSync.Client._ajaxSingletons[options.singleton] = false;
            //}
        }, JSync.extraAjaxOptions, options.ajaxOpts));
    };
    DOIT();
};

JSync.Client.prototype.waitForConnection = function(callback) {
    // This function was added 2012-11-07 to enable me to create more reliable communications.
    var self = this;
    var check = function() {
        if(self.connectionID) {
            // We got a connection.  Now wait for the join:  (Added 2012-12-11)
            try {
                var cinfo = self.connectionInfo();
                if(cinfo) return callback(cinfo);
            } catch(err) {
                if(err.message.lastIndexOf('No such state:', 0) === 0) {
                    // Ignore.
                } else {
                    if(typeof console !== 'undefined') console.log('Error during waitForConnection:',err);
                }
            }
        }
        setTimeout(check, 100);
    };
    return check();
};

JSync.Client.prototype.login = function(callback) {
};
JSync.Client.prototype.logout = function(callback, sync) {
};
JSync.Client.prototype.onMessage = function(nameRegex, callback) {
};
JSync.Client.prototype.offMessage = function(nameRegex, callback) {
};
JSync.Client.prototype.getState = function(path) {
};
JSync.Client.prototype.edit = function(path, operations, meta, onSuccess, onError) {
};
JSync.Client.prototype.reset = function(path) {
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
