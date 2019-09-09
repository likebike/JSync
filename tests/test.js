//  JDelta - Test Suite
//  (c) 2012 LikeBike LLC
//  JDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


var coverage = require('./coverage.js'),
    assert = require('assert'),
    JDelta_mod = require('./cov_lib/JDelta.js'),
    JDeltaDB_mod = require('./cov_lib/JDeltaDB.js');

JDelta = JDelta_mod.JDelta;
JDeltaDB = JDeltaDB_mod.JDeltaDB;


var o = {a:1, c:2, b:3, d:{z:4, x:5, y:6}};
assert.deepEqual(JDelta.stringify(o), '{"a":1,"b":3,"c":2,"d":{"x":5,"y":6,"z":4}}');
o['e'] = 7;
assert.deepEqual(JDelta.stringify(o), '{"a":1,"b":3,"c":2,"d":{"x":5,"y":6,"z":4},"e":7}');
delete o['c'];
assert.deepEqual(JDelta.stringify(o), '{"a":1,"b":3,"d":{"x":5,"y":6,"z":4},"e":7}');
o['c'] = 8;
assert.deepEqual(JDelta.stringify(o), '{"a":1,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['a'] = 9;
assert.deepEqual(JDelta.stringify(o), '{"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[1] = '\\slash';
assert.deepEqual(JDelta.stringify(o), '{"1":"\\\\slash","a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['2'] = [1,null,3];
assert.deepEqual(JDelta.stringify(o), '{"1":"\\\\slash","2":[1,null,3],"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[3] = null;
assert.deepEqual(JDelta.stringify(o), '{"1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[0] = 'number0';
assert.deepEqual(JDelta.stringify(o), '{"0":"number0","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['0'] = 'string0';
assert.deepEqual(JDelta.stringify(o), '{"0":"string0","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[0] = 'number0again';
assert.deepEqual(JDelta.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['加'] = '油';
assert.deepEqual(JDelta.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7,"加":"油"}');
o[true] = false;
assert.deepEqual(JDelta.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7,"true":false,"加":"油"}');
console.log(JDelta.stringify(o));


// A quick study of Javascript bitwise operations and negative numbers:
console.log(1 << 1);
console.log(1 << 30);
console.log(1 << 31);  // The left-most (32) bit controls sign.
console.log(1 << 32);  // the shift count is modulus 32.
console.log(1 << 33);
console.log(0x12345678 << 4);  // = 0x23456780
console.log( (0x12345678 << 4) | (0x12345678 >>> (32-4)) );  // = 0x23456781
console.log(0x12345678 << 8);  // = 0x34567800
console.log( (0x12345678 << 8) | (0x12345678 >>> (32-8)) );  // = 0x34567812
console.log( (1<<31).toString(16) );  // = -80000000
console.log( (0x80000000).toString(16) );  // = 80000000


// Just for fun, see how difficult it is to find collisions:
var hashes = {},
    h, l;
for(var i=0; i<100000/*00*/; i++) {
    h = JDelta._hash(''+i);
    l = hashes[h] || [];
    hashes[h] = l.concat([i]);
}
for(var h in hashes) if(hashes.hasOwnProperty(h)) {
    l = hashes[h];
    if(l.length > 1) {
        console.log('Collision: ',l.join(','));
    }
}


assert.equal(JDelta._hash(''),   0x12345678);  // 0x12345678 == 305419896
assert.equal(JDelta._hash('\0'), 610839794);
assert.equal(JDelta._hash('a'),  1221679976);
assert.equal(JDelta._hash('b'),  0x91a2b6d8);
assert.equal(JDelta._hash('c'),  591752641);
assert.equal(JDelta._hash('aa'), 591753393);
assert.equal(JDelta._hash('ab'), 1183506802);
assert.equal(JDelta._hash('ac'), 0x8d15c304);
assert.equal(JDelta._hash('The quick brown fox jumps over the lazy dog'), 0xb6aad44c);
assert.equal(JDelta._hash('加油！'), 0x625296d2);
var s = 'The quick brown fox jumps over the lazy dog. 加油！';
var bigS = '';
var startTime = new Date().getTime();
var loopsToDo = 1024*1024;
var bigSHash = 0x42fc6236;
if(typeof window !== 'undefined') {
    loopsToDo = 1024*2;  // Browser.  Take it easy.
    bigSHash = 0xbc535c53;
}
for(var i=0; i<loopsToDo; i++) bigS += s;
console.log('loop time: %s ms', new Date().getTime() - startTime);
startTime = new Date().getTime();
assert.equal(JDelta._hash(bigS), bigSHash);
console.log('_hash of %s-char str: %s ms', bigS.length, new Date().getTime() - startTime);
startTime = new Date().getTime();
assert.equal(JDelta._hash(s), 0xbc4e7448);
console.log('_hash of %s-char str: %s ms', s.length, new Date().getTime() - startTime);



assert.deepEqual(JDelta.create(
                 {a:1}, [{op:'create', key:'b', value:2}, {op:'update', key:'a', value:3}, {op:'delete', key:'b'}]),
                 {"steps":[{"path":"$","key":"b","after":2},
                           {"path":"$","key":"a","before":1,"after":3},
                           {"path":"$","key":"b","before":2}]});
assert.deepEqual(JDelta.reverse(JDelta.create(
                 {a:1}, [{op:'create', key:'b', value:2}, {op:'update', key:'a', value:3}, {op:'delete', key:'b'}])),
                 {"steps":[{"path":"$","key":"b","after":2},
                           {"path":"$","key":"a","before":3,"after":1},
                           {"path":"$","key":"b","before":2}]});
assert.deepEqual(JDelta.reverse(JDelta.reverse(JDelta.create(
                 {a:1}, [{op:'create', key:'b', value:2}, {op:'update', key:'a', value:3}, {op:'delete', key:'b'}]))),
                 {"steps":[{"path":"$","key":"b","after":2},
                           {"path":"$","key":"a","before":1,"after":3},
                           {"path":"$","key":"b","before":2}]});


var d = JDelta.create({a:1}, [{op:'update', key:'a', value:{b:2,c:4}}, {op:'update', path:'$.a', key:'b', value:3}]);
assert.deepEqual(d, {"steps":[{"path":"$","key":"a","before":1,"after":{"b":2,"c":4}},
                              {"path":"$.a","key":"b","before":2,"after":3}]});
var o = JDelta.patch(null, {a:1}, d);
// perform some mutations on 'o' to make sure that the original 'd' is not affected via unexpected shared references:
o.a.b = 5;
o.a.d = 6;
o.e = 7;
assert.deepEqual(JDelta.patch(null, {a:1}, d), {a:{b:3,c:4}});
var rd = JDelta.reverse(d);
assert.deepEqual(rd, {"steps":[{"path":"$.a","key":"b","before":3,"after":2},
                               {"path":"$","key":"a","before":{"b":2,"c":4},"after":1}]});
assert.deepEqual(JDelta.patch(null, {a:{b:3,c:4}}, rd), {a:1});


assert.deepEqual(JDelta.create({}, []), {"steps":[]});
assert.deepEqual(JDelta.create({}, [{op:'create',key:'a',value:'1'}]), {"steps":[{"path":"$","key":"a","after":"1"}]});
assert.throws(function(){JDelta.create({}, [{op:'create', path:'$.x', key:'a', value:'1'}])}, /Path not found/);
assert.throws(function(){JDelta.create({a:1}, [{op:'create', key:'a', value:2}])}, /Already in target/);
assert.throws(function(){JDelta.create({}, [{op:'update', key:'a', value:2}])}, /Not in target/);
assert.deepEqual(JDelta.create({a:1}, [{op:'update', key:'a', value:2}]), {"steps":[{"path":"$","key":"a","before":1,"after":2}]});
assert.deepEqual(JDelta.create({a:1}, [{op:'update', key:'a', value:2},
                                       {op:'create', key:'b', value:3}]), {"steps":[{"path":"$","key":"a","before":1,"after":2},
                                                                                 {"path":"$","key":"b","after":3}]});

assert.throws(function(){JDelta.patch(null, {a:2}, JDelta.create({a:1}, [{op:'update', key:'a', value:3}]))}, /'before' value did not match/);
assert.deepEqual(JDelta.patch(null, {a:2}, JDelta.create({a:2}, [{op:'update', key:'a', value:3}])), {a:3});
assert.deepEqual(JDelta.patch(null, {a:2}, JDelta.create({a:2}, [{op:'delete', key:'a'}])), {});
assert.deepEqual(JDelta.patch(null, [1,2,3], JDelta.create([1,2,3], [{op:'update', key:1, value:4}])), [1,4,3]);
assert.deepEqual(JDelta.create([1,2,3], [{op:'arrayInsert', key:1, value:'a'}]),
                 {"steps":[{"op":"arrayInsert","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDelta.create([1,'a',2,3], [{op:'arrayRemove', key:1}]),
                 {"steps":[{"op":"arrayRemove","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDelta.reverse(JDelta.create([1,2,3], [{op:'arrayInsert', key:1, value:'a'}])),
                 {"steps":[{"op":"arrayRemove","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDelta.reverse(JDelta.create([1,'a',2,3], [{op:'arrayRemove', key:1}])),
                 {"steps":[{"op":"arrayInsert","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDelta.patch(null, [1,2,3], JDelta.create([1,2,3], [{op:'arrayInsert', key:1, value:'a'}])),
                 [1,'a',2,3]);
assert.deepEqual(JDelta.patch(null, [1,'a',2,3], JDelta.create([1,'a',2,3], [{op:'arrayRemove', key:1}])),
                 [1,2,3]);
var o = [1,{a:2},3];
var d = JDelta.create(o, [{op:'arrayInsert', key:1, value:{x:[4,'5',6]}},
                          {op:'update', path:'$.2', key:'a', value:[2]},
                          {op:'arrayRemove', path:'$.1.x', key:0}]);
var o2 = JDelta.patch(null, JDelta._deepCopy(o), d);
assert.deepEqual(o2, [1,{x:['5',6]},{a:[2]},3]);
var rd = JDelta.reverse(d);
assert.deepEqual(JDelta.patch(null, JDelta._deepCopy(o2), rd), o);
// A modification should be detected:
o2[2]['a'][1] = 10;
assert.throws(function(){JDelta.patch(null, JDelta._deepCopy(o2), rd)}, /'before' value did not match/);

// I'm using the code coverage report as my guide... writing the following tests to hit lines that have not been tested:
assert.throws(function(){JDelta.create()}, /Expected 'state' to be an Object or Array/);
assert.throws(function(){JDelta.create({})}, /Expected 'operations' to be an Array of OperationSpecs/);
assert.throws(function(){JDelta.create({}, [{}])}, /undefined op/);
assert.throws(function(){JDelta.create({}, [{op:''}])}, /undefined key/);
assert.throws(function(){JDelta.create({}, [{op:'create', key:1}])}, /undefined value/);
assert.throws(function(){JDelta.create({}, [{op:'update', key:1}])}, /undefined value/);
assert.throws(function(){JDelta.create({}, [{op:'delete', key:1}])}, /Not in target/);
assert.throws(function(){JDelta.create({}, [{op:'arrayInsert', key:'1'}])}, /Expected an integer key/);
assert.throws(function(){JDelta.create({}, [{op:'arrayInsert', key:1}])}, /create:arrayInsert: Expected an Array target/);
assert.throws(function(){JDelta.create([], [{op:'arrayInsert', key:1}])}, /IndexError/);
assert.throws(function(){JDelta.create([], [{op:'arrayInsert', key:-1}])}, /IndexError/);
assert.throws(function(){JDelta.create({}, [{op:'arrayRemove', key:'1'}])}, /Expected an integer key/);
assert.throws(function(){JDelta.create({}, [{op:'arrayRemove', key:1}])}, /create:arrayRemove: Expected an Array target/);
assert.throws(function(){JDelta.create([], [{op:'arrayRemove', key:1}])}, /IndexError/);
assert.throws(function(){JDelta.create([], [{op:'xxx', key:1}])}, /Illegal operation/);
assert.throws(function(){JDelta.reverse()}, /Expected a Delta object/);
assert.throws(function(){JDelta.reverse({})}, /Not a Delta object/);
assert.throws(function(){JDelta.reverse({steps:[{op:'xxx'}]})}, /Illegal operation/);
assert.throws(function(){JDelta.patch(null)}, /Expected 'state' to be an Object or Array./);
assert.throws(function(){JDelta.patch(null, {})}, /Expected 'delta' to be a Delta object./);
assert.throws(function(){JDelta.patch(null, {}, {})}, /Invalid Delta object/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{}]})}, /undefined path/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{path:''}]})}, /undefined key/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{path:'$', key:'x', before:''}]})}, /Not in target/);
assert.throws(function(){JDelta.patch(null, {x:1}, {steps:[{path:'$', key:'x'}]})}, /Unexpectedly in target/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{op:'arrayInsert', path:'$', key:'1'}]})}, /Expected an integer key/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{op:'arrayInsert', path:'$', key:1}]})}, /patch:arrayInsert: Expected an Array target/);
assert.throws(function(){JDelta.patch(null, [], {steps:[{op:'arrayInsert', path:'$', key:1}]})}, /IndexError/);
assert.throws(function(){JDelta.patch(null, [], {steps:[{op:'arrayInsert', path:'$', key:0}]})}, /undefined value/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{op:'arrayRemove', path:'$', key:'1'}]})}, /Expected an integer key/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{op:'arrayRemove', path:'$', key:1}]})}, /patch:arrayRemove: Expected an Array target/);
assert.throws(function(){JDelta.patch(null, [], {steps:[{op:'arrayRemove', path:'$', key:0}]})}, /IndexError/);
assert.throws(function(){JDelta.patch(null, ['x'], {steps:[{op:'arrayRemove', path:'$', key:0}]})}, /Array value did not match/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{op:'xxx', path:'$', key:''}]})}, /Illegal operation/);
assert.throws(function(){JDelta._getTarget()}, /I need an Object or Array/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{path:'', key:''}]})}, /I need a path/);
assert.throws(function(){JDelta.patch(null, {}, {steps:[{path:'xxx', key:''}]})}, /The first path item must be \$/);

var dispatcher = JDelta.createDispatcher();
dispatcher.on('all', function(path, id, cmd) {
    console.log('ALL:', path, id, cmd);
});
dispatcher.on('$.b', function(id, cmd) {
    console.log('B:', id, cmd);
});

var state = {a:1, b:[2,'3',4]};
var d = JDelta.create(state, [{op:'create', key:'c', value:5},
                              {op:'arrayRemove', path:'$.b', key:1},
                              {op:'arrayInsert', path:'$.b', key:1, value:3},
                              {op:'update', path:'$.b', key:1, value:'three'}
                              ]);
JDelta.patch(null, state, d, dispatcher);
assert.deepEqual(state, {"a":1,"b":[2,"three",4],"c":5});
JDelta.patch(null, state, JDelta.reverse(d), dispatcher);
assert.deepEqual(state, {a:1, b:[2,'3',4]});


if(typeof exports !== 'undefined') {
    console.log('Generating JDelta Code Coverage Report...');
    coverage.save_report(JDelta_mod);
}









var db = new JDeltaDB.DB();
db.createState('a');
assert.throws(function(){db.createState('a')}, /State already exists/);
db.edit('a', [{op:'create', key:'x', value:1}]);
assert.throws(function(){db.edit('a', [{op:'create', key:'x', value:1}])}, /Already in target/);
db.edit('a', [{op:'update', key:'x', value:{r:'1'}}]);
var cb = function(path,event) {
    console.log('CALLBACK:',path,event,this);
};
db.on('a', 'all', cb);
db.edit('a', [{op:'create', key:'y', value:[1,2,3]},
              {op:'arrayInsert', path:'$.y', key:1, value:1.5}
             ]);
var cb2 = function(event) {
    console.log('CALLBACK2 for $.y:',event,this);
};
db.on('a', '$.y', cb2);
db.edit('a', [{op:'arrayRemove', path:'$.y', key:1},
              {op:'create', key:'z', value:'abc'}]);

var re3 = /^a$/;
var cb3 = function(path, id, cmd) {
    console.log('REGEX A:', path, id, cmd);
};
db.on(re3, 'all', cb3);
var re4 = /^b$/;
var cb4 = function(path, id, cmd) {
    console.log('REGEX B:', path, id, cmd);
};
db.on(re4, 'all', cb4);



db.render('a', null, function(o) { assert.deepEqual(o, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"}); });
db.render('a', 1, function(o) { assert.deepEqual(o, {"x":1}); });
db.render('a', 2, function(o) { assert.deepEqual(o, {"x":{"r":"1"}}); });
db.render('a', 3, function(o) { assert.deepEqual(o, {"x":{"r":"1"},"y":[1,1.5,2,3]}); });
db.render('a', 4, function(o) { assert.deepEqual(o, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"}); });
db.render('a', 5, function(o) { assert.deepEqual(o, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"}); });

// Tamper with the state data to cause an error and a roll-back:
db._states.a.state.tamper='data';
assert.deepEqual(db._states.a.state, {"tamper":"data","x":{"r":"1"},"y":[1,2,3],"z":"abc"});
assert.throws(function(){db.edit('a', [{op:'update', key:'z', value:true}])}, /invalid parentHash/);
db.rollback('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"});
db.edit('a', [{op:'update', key:'z', value:true}]);
assert.throws(function(){db.edit('a', [{op:'delete', key:'w'}])}, /Not in target/);

assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,2,3],"z":true});
db.canUndo('a', function(b) { assert.equal(b, true); });
db.undo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"});
db.canUndo('a', function(b) { assert.equal(b, true); });
db.undo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,1.5,2,3]});
db.canUndo('a', function(b) { assert.equal(b, true); });
db.undo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"}});
db.canUndo('a', function(b) { assert.equal(b, true); });
db.undo('a');
assert.deepEqual(db._states.a.state, {"x":1});
db.canUndo('a', function(b) { assert.equal(b, true); });
db.undo('a');
assert.deepEqual(db._states.a.state, {});
db.canUndo('a', function(b) { assert.equal(b, false); });
assert.throws(function(){db.undo('a')}, /unable to undo \(already at beginning\)/);
db.canRedo('a', function(b) { assert.equal(b, true); });
db.redo('a');
assert.deepEqual(db._states.a.state, {"x":1});
db.canRedo('a', function(b) { assert.equal(b, true); });
db.redo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"}});
db.canRedo('a', function(b) { assert.equal(b, true); });
db.redo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,1.5,2,3]});
db.canRedo('a', function(b) { assert.equal(b, true); });
db.redo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"});
db.canRedo('a', function(b) { assert.equal(b, true); });
db.redo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,2,3],"z":true});
db.canRedo('a', function(b) { assert.equal(b, false); });
db.canUndo('a', function(b) { assert.equal(b, true); });
db.undo('a');
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,2,3],"z":"abc"});
db.edit('a', [{op:'arrayRemove', path:'$.y', key:1}]);
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,3],"z":"abc"});
db.canRedo('a', function(b) { assert.equal(b, false); });
db.canUndo('a', function(b) { assert.equal(b, true); });
assert.throws(function(){db.edit('a', [{op:'arrayRemove', path:'$.y', key:5}])}, /IndexError/);
assert.deepEqual(db._states.a.state, {"x":{"r":"1"},"y":[1,3],"z":"abc"});

db.createState('b');
db.deleteState('b');




db.off('a', 'all', cb);
db.off('a', null, cb2);  //  null removes all events for that callback.
db.off(re3, 'all', cb3);  // For regex events, we need to use the exact same objects because javascript doesn't support equality testing of regexes.
db.off(re4, 'all', cb4);
JDelta.stringify(db, null, 2);  // We should now be able to stringify the db after the callbacks have been removed.  Before they are removed, there are cyclical references which cause the stringify to crash thru the stack limit.



var db2 = JDeltaDB.DB();
var db3 = new JDeltaDB.DB();



if(typeof exports !== 'undefined') {
    console.log('Generating JDeltaDB Code Coverage Report...');
    coverage.save_report(JDeltaDB_mod);
}


console.log('All Tests Passed.  :)');
