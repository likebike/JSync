
////////////////////////////////////////////////////
/////////////////             //////////////////////
/////////////////  S L I D E  //////////////////////
/////////////////             //////////////////////
///                                              ///
/// https://github.com/isaacs/slide-flow-control ///
///                                              ///
/// Modified to run in web browsers back to IE6. ///
///                                              ///
////////////////////////////////////////////////////

"use strict";

(function() {

var slide = {},
    _,
    undefined;  // So 'undefined' really is undefined.
if(typeof exports !== 'undefined') {
    // We are in Node.
    exports.slide = slide;
    _ = require('underscore');
} else if(typeof window !== 'undefined') {
    // We are in a browser.
    window.slide = slide;
    _ = window._;
} else throw new Error('This environment is not yet supported.');

slide.VERSION = '201508012330';

// Used from chain and asyncMap like this:
// var log = _.bind(console.log, console);
// var add = function(a,b,next) {next(null, a+b)};
// var obj = {add:add};
// slide._bindActor(add,1,2)(log);       //  null, 3
// slide._bindActor(obj,'add',1,2)(log); //  null, 3
slide._bindActor = function() {
  var args = Array.prototype.slice.call(arguments) // jswtf.
    , obj = null
    , fn;
  if(typeof args[0] === "object") {
    obj = args.shift();
    fn = args.shift();
    if (typeof fn === "string") fn = obj[ fn ];
  } else fn = args.shift();
  return function (cb) { fn.apply(obj, args.concat(cb)); };
};

// Able to run async functions in series:
// var mul = function(a,b,next) {next(null, a*b)};
// var first = slide.first;
// var last = slide.last;
// slide.chain( [ [mul, 2, 3],
//                    [obj, 'add', 1, last],
//                    [obj, 'add', first, last]
//                  ], log);                     //  null [6, 7, 13]
slide.first = {};
slide.first0 = {};
slide.last = {};
slide.last0 = {};
slide.chain = function(things, cb) {
  cb = cb || function(){};                              ////////   Added by Christopher Sebastian.
  var res = [];
  (function LOOP(i, len) {
    var NEXT = function() {                             ////////   Added by Christopher Sebastian.
        // Prevent stack overflow:
        if(i>0 && i%500===0) setTimeout(function() { LOOP(i+1, len) }, 0);
        else LOOP(i+1, len);
    };
    if(i >= len) return cb(null,res);
    if(_.isArray(things[i])) things[i] = slide._bindActor.apply(null, _.map(things[i], function(i){
                                                                                          return (i===slide.first)  ? res[0] :
                                                                                                 (i===slide.first0) ? res[0][0] :
                                                                                                 (i===slide.last)   ? res[res.length - 1] :
                                                                                                 (i===slide.last0)  ? res[res.length - 1][0] :
                                                                                                 i; }));
    if(!things[i]) return NEXT();
    things[i](function (er, data) {
      if(er) return cb(er, res);
      //if(data !== undefined) res = res.concat(data);   /////////  Commented by Christopher Sebastian.  I disagree with the use of 'concat' to collect results.  I think it should be an append instead.
      if(data !== undefined) res[res.length] = data;     /////////  Added by Christopher Sebastian.
      return NEXT();
    });
  })(0, things.length);
};

// Runs tasks in parallel:
// slide.asyncMap(['/', '/ComingSoon'],
//                    function(url,cb) {jQuery.ajax({url:url, success:function(data){cb(null,data)}})}, 
//                    log);      //  null [...datas from the 2 pages (in whatever order they were received)...]
//
// slide.asyncMap([1,2,3],
//                    function(x, next) {next(null, x*3,x*2,x*1)},
//                    function(err, res1, res2, res3) {console.log(err, res1, res2, res3)});  //   null [3, 6, 9] [2, 4, 6] [1, 2, 3]
//
slide.asyncMap = function() {
  var steps = Array.prototype.slice.call(arguments)
    , list = steps.shift() || []
    , cb_ = steps.pop();
  if(typeof cb_ !== "function") throw new Error("No callback provided to asyncMap");
  if(!list) return cb_(null, []);
  if(!_.isArray(list)) list = [list];
  var n = steps.length
    , data = [] // 2d array
    , errState = null
    , l = list.length
    , a = l * n;
  if(!a) return cb_(null, []);
  function cb(er) {
    if(errState) return;
    var argLen = arguments.length;
    for(var i=1; i<argLen; i++) if(arguments[i] !== undefined) {
      data[i-1] = (data[i-1] || []).concat(arguments[i]);
    }
    // see if any new things have been added.
    if(list.length > l) {
      var newList = list.slice(l);
      a += (list.length - l) * n;
      l = list.length;
      process.nextTick(function() {
        _.each(newList, function(ar) {
          _.each(steps, function(fn) { fn(ar,cb); });
        });
      });
    }
    if(er || --a === 0) {
      errState = er;
      cb_.apply(null, [errState].concat(data));
    }
  };
  // expect the supplied cb function to be called
  // "n" times for each thing in the array.
  _.each(list, function(ar) {
    _.each(steps, function(fn) { fn(ar,cb); });
  });
};




// Cache results so future requests can be de-duplicated.
// var dedup = slide.asyncMemoize(add, function(a,b){return ''+a+':'+b});
// dedup(1, 2, log);  // First time, add gets called.
// dedup(1, 2, log);  // Result comes from cache.
slide.asyncMemoize = function(func, hashFunc, hasOnError) {
    hashFunc = hashFunc || function(x) { return x; };
    var seen = {};
    return function() {
        var args = Array.prototype.slice.call(arguments);
        var hash = hashFunc.apply(null, args);
        var onSuccess, onError;
        if(hasOnError) {
            onError = args.pop();
            onSuccess = args.pop();
        } else onSuccess = args.pop();
        var results = seen[hash];
        if(results) {
            //console.log('MEMOED!', hash);
            return onSuccess.apply(null, results);
        }
        var totalArgs = args.concat([function() {
            results = Array.prototype.slice.call(arguments);
            seen[hash] = results;
            //console.log('CALLED.', hash);
            return onSuccess.apply(null, results);
        }]);
        if(hasOnError) totalArgs = totalArgs.concat([onError]);
        func.apply(null, totalArgs);
    };
};

// Only allow one call to occur at a time.  Additional calls will be discarded.
// Useful for expensive functions that you don't want to "stack" if called rapidly.
// var single = slide.asyncOneAtATime(function(a,b,next){ setTimeout(function(){next(a,b)}, 3000) });
// single(1,2,log);  single(3,4,log);   // Only "1 2" will be printed.
slide.asyncOneAtATime = function(func, hasOnError) {
    var running = false;
    return function() {
        var args = Array.prototype.slice.call(arguments);
        if(running) {
            console.log('already running.');
            return;
        }
        running = true;
        var onSuccess, onError;
        if(hasOnError) {
            onError = args.pop();
            onSuccess = args.pop();
        } else onSuccess = args.pop();
        var totalArgs = args.concat([function() {
            var results = Array.prototype.slice.call(arguments);
            running = false;
            onSuccess && onSuccess.apply(null, results);
        }]);
        if(hasOnError) totalArgs = totalArgs.concat([function() {
            var results = Array.prototype.slice.call(arguments);
            running = false;
            onError && onError.apply(null, results);
        }]);
        func.apply(null, totalArgs);  // It's no use to wrap this in a 'try' block because exceptions will usually be thrown from the async activities, which we have no way of catching.
    };
};

})();
