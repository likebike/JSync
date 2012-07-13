//  JsonDelta - Test Suite
//  (c) 2012 LikeBike LLC
//  JsonDelta is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


var coverage = require('./coverage.js'),
    assert = require('assert'),
    JsonDelta = require('./cov_lib/JsonDelta.js');
JDELTA = JsonDelta.JDELTA;


var o = {a:1, c:2, b:3, d:{z:4, x:5, y:6}};
assert.deepEqual(JDELTA.stringify(o), '{"a":1,"b":3,"c":2,"d":{"x":5,"y":6,"z":4}}');
o['e'] = 7;
assert.deepEqual(JDELTA.stringify(o), '{"a":1,"b":3,"c":2,"d":{"x":5,"y":6,"z":4},"e":7}');
delete o['c'];
assert.deepEqual(JDELTA.stringify(o), '{"a":1,"b":3,"d":{"x":5,"y":6,"z":4},"e":7}');
o['c'] = 8;
assert.deepEqual(JDELTA.stringify(o), '{"a":1,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['a'] = 9;
assert.deepEqual(JDELTA.stringify(o), '{"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[1] = '\\slash';
assert.deepEqual(JDELTA.stringify(o), '{"1":"\\\\slash","a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['2'] = [1,null,3];
assert.deepEqual(JDELTA.stringify(o), '{"1":"\\\\slash","2":[1,null,3],"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[3] = null;
assert.deepEqual(JDELTA.stringify(o), '{"1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[0] = 'number0';
assert.deepEqual(JDELTA.stringify(o), '{"0":"number0","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['0'] = 'string0';
assert.deepEqual(JDELTA.stringify(o), '{"0":"string0","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[0] = 'number0again';
assert.deepEqual(JDELTA.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['加'] = '油';
assert.deepEqual(JDELTA.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7,"加":"油"}');
o[true] = false;
assert.deepEqual(JDELTA.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7,"true":false,"加":"油"}');
console.log(JDELTA.stringify(o));

assert.equal(JDELTA.hash(''), 0x12345678);  // 0x12345678 == 305419896
assert.equal(JDELTA.hash('\0'), 305419897);
assert.equal(JDELTA.hash('a'), 305419994);
assert.equal(JDELTA.hash('b'), 305419995);
assert.equal(JDELTA.hash('c'), 305419996);
assert.equal(JDELTA.hash('aa'), 305420190);
assert.equal(JDELTA.hash('ab'), 305420192);
assert.equal(JDELTA.hash('ac'), 305420194);
assert.equal(JDELTA.hash('The quick brown fox jumps over the lazy dog'), 305510356);
assert.equal(JDELTA.hash('加油！'), 305692563);
var s = 'The quick brown fox jumps over the lazy dog. 加油！';
var bigS = '';
var startTime = new Date().getTime();
for(var i=0; i<1024*1024; i++) bigS += s;
console.log('loop time: %s ms', new Date().getTime() - startTime);
startTime = new Date().getTime();
assert.equal(JDELTA.hash(bigS), 522514691);
console.log('hash of %s-char str: %s ms', bigS.length, new Date().getTime() - startTime);
startTime = new Date().getTime();
assert.equal(JDELTA.hash(s), 310928681);
console.log('hash of %s-char str: %s ms', s.length, new Date().getTime() - startTime);


assert.deepEqual(JDELTA.create(
                 {a:1}, [{op:'add', key:'b', value:2}, {op:'update', key:'a', value:3}, {op:'remove', key:'b'}]),
                 {"steps":[{"path":"$","key":"b","after":2},
                           {"path":"$","key":"a","before":1,"after":3},
                           {"path":"$","key":"b","before":2}]});
assert.deepEqual(JDELTA.reverse(JDELTA.create(
                 {a:1}, [{op:'add', key:'b', value:2}, {op:'update', key:'a', value:3}, {op:'remove', key:'b'}])),
                 {"steps":[{"path":"$","key":"b","after":2},
                           {"path":"$","key":"a","before":3,"after":1},
                           {"path":"$","key":"b","before":2}]});
assert.deepEqual(JDELTA.reverse(JDELTA.reverse(JDELTA.create(
                 {a:1}, [{op:'add', key:'b', value:2}, {op:'update', key:'a', value:3}, {op:'remove', key:'b'}]))),
                 {"steps":[{"path":"$","key":"b","after":2},
                           {"path":"$","key":"a","before":1,"after":3},
                           {"path":"$","key":"b","before":2}]});


var d = JDELTA.create({a:1}, [{op:'update', key:'a', value:{b:2,c:4}}, {op:'update', path:'$.a', key:'b', value:3}]);
assert.deepEqual(d, {"steps":[{"path":"$","key":"a","before":1,"after":{"b":2,"c":4}},
                              {"path":"$.a","key":"b","before":2,"after":3}]});
var o = JDELTA.patch({a:1}, d);
// perform some mutations on 'o' to make sure that the original 'd' is not affected via unexpected shared references:
o.a.b = 5;
o.a.d = 6;
o.e = 7;
assert.deepEqual(JDELTA.patch({a:1}, d), {a:{b:3,c:4}});
var rd = JDELTA.reverse(d);
assert.deepEqual(rd, {"steps":[{"path":"$.a","key":"b","before":3,"after":2},
                               {"path":"$","key":"a","before":{"b":2,"c":4},"after":1}]});
assert.deepEqual(JDELTA.patch({a:{b:3,c:4}}, rd), {a:1});


assert.deepEqual(JDELTA.create({}, []), {"steps":[]});
assert.deepEqual(JDELTA.create({}, [{op:'add',key:'a',value:'1'}]), {"steps":[{"path":"$","key":"a","after":"1"}]});
assert.throws(function(){JDELTA.create({}, [{op:'add', path:'$.x', key:'a', value:'1'}])}, /Path not found/);
assert.throws(function(){JDELTA.create({a:1}, [{op:'add', key:'a', value:2}])}, /Already in target/);
assert.throws(function(){JDELTA.create({}, [{op:'update', key:'a', value:2}])}, /Not in target/);
assert.deepEqual(JDELTA.create({a:1}, [{op:'update', key:'a', value:2}]), {"steps":[{"path":"$","key":"a","before":1,"after":2}]});
assert.deepEqual(JDELTA.create({a:1}, [{op:'update', key:'a', value:2},
                                       {op:'add', key:'b', value:3}]), {"steps":[{"path":"$","key":"a","before":1,"after":2},
                                                                                 {"path":"$","key":"b","after":3}]});

assert.throws(function(){JDELTA.patch({a:2}, JDELTA.create({a:1}, [{op:'update', key:'a', value:3}]))}, /'before' value did not match/);
assert.deepEqual(JDELTA.patch({a:2}, JDELTA.create({a:2}, [{op:'update', key:'a', value:3}])), {a:3});
assert.deepEqual(JDELTA.patch({a:2}, JDELTA.create({a:2}, [{op:'remove', key:'a'}])), {});
assert.deepEqual(JDELTA.patch([1,2,3], JDELTA.create([1,2,3], [{op:'update', key:1, value:4}])), [1,4,3]);
assert.deepEqual(JDELTA.create([1,2,3], [{op:'arrayInsert', key:1, value:'a'}]),
                 {"steps":[{"op":"arrayInsert","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDELTA.create([1,'a',2,3], [{op:'arrayRemove', key:1}]),
                 {"steps":[{"op":"arrayRemove","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDELTA.reverse(JDELTA.create([1,2,3], [{op:'arrayInsert', key:1, value:'a'}])),
                 {"steps":[{"op":"arrayRemove","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDELTA.reverse(JDELTA.create([1,'a',2,3], [{op:'arrayRemove', key:1}])),
                 {"steps":[{"op":"arrayInsert","path":"$","key":1,"value":"a"}]});
assert.deepEqual(JDELTA.patch([1,2,3], JDELTA.create([1,2,3], [{op:'arrayInsert', key:1, value:'a'}])),
                 [1,'a',2,3]);
assert.deepEqual(JDELTA.patch([1,'a',2,3], JDELTA.create([1,'a',2,3], [{op:'arrayRemove', key:1}])),
                 [1,2,3]);
var o = [1,{a:2},3];
var d = JDELTA.create(o, [{op:'arrayInsert', key:1, value:{x:[4,'5',6]}},
                          {op:'update', path:'$.2', key:'a', value:[2]},
                          {op:'arrayRemove', path:'$.1.x', key:0}]);
var o2 = JDELTA.patch(JDELTA._deepCopy(o), d);
assert.deepEqual(o2, [1,{x:['5',6]},{a:[2]},3]);
var rd = JDELTA.reverse(d);
assert.deepEqual(JDELTA.patch(JDELTA._deepCopy(o2), rd), o);
// A modification should be detected:
o2[2]['a'][1] = 10;
assert.throws(function(){JDELTA.patch(JDELTA._deepCopy(o2), rd)}, /'before' value did not match/);

// I'm using the code coverage report as my guide... writing the following tests to hit lines that have not been tested:
assert.throws(function(){JDELTA.create()}, /Expected 'o' to be an Object or Array/);
assert.throws(function(){JDELTA.create({})}, /Expected 'operations' to be an Array of OperationSpecs/);
assert.throws(function(){JDELTA.create({}, [{}])}, /undefined op/);
assert.throws(function(){JDELTA.create({}, [{op:''}])}, /undefined key/);
assert.throws(function(){JDELTA.create({}, [{op:'add', key:1}])}, /undefined value/);
assert.throws(function(){JDELTA.create({}, [{op:'update', key:1}])}, /undefined value/);
assert.throws(function(){JDELTA.create({}, [{op:'remove', key:1}])}, /Not in target/);
assert.throws(function(){JDELTA.create({}, [{op:'arrayInsert', key:'1'}])}, /Expected an integer key/);
assert.throws(function(){JDELTA.create({}, [{op:'arrayInsert', key:1}])}, /create:arrayInsert: Expected an Array target/);
assert.throws(function(){JDELTA.create([], [{op:'arrayInsert', key:1}])}, /IndexError/);
assert.throws(function(){JDELTA.create([], [{op:'arrayInsert', key:-1}])}, /IndexError/);
assert.throws(function(){JDELTA.create({}, [{op:'arrayRemove', key:'1'}])}, /Expected an integer key/);
assert.throws(function(){JDELTA.create({}, [{op:'arrayRemove', key:1}])}, /create:arrayRemove: Expected an Array target/);
assert.throws(function(){JDELTA.create([], [{op:'arrayRemove', key:1}])}, /IndexError/);
assert.throws(function(){JDELTA.create([], [{op:'xxx', key:1}])}, /Illegal operation/);
assert.throws(function(){JDELTA.reverse()}, /Expected a Delta object/);
assert.throws(function(){JDELTA.reverse({})}, /Not a Delta object/);
assert.throws(function(){JDELTA.reverse({steps:[{op:'xxx'}]})}, /Illegal operation/);
assert.throws(function(){JDELTA.patch()}, /Expected first arg to be an Object or Array/);
assert.throws(function(){JDELTA.patch({})}, /Expected second arg to be a Delta object/);
assert.throws(function(){JDELTA.patch({}, {})}, /Invalid Delta object/);
assert.throws(function(){JDELTA.patch({}, {steps:[{}]})}, /undefined path/);
assert.throws(function(){JDELTA.patch({}, {steps:[{path:''}]})}, /undefined key/);
assert.throws(function(){JDELTA.patch({}, {steps:[{path:'$', key:'x', before:''}]})}, /Not in target/);
assert.throws(function(){JDELTA.patch({x:1}, {steps:[{path:'$', key:'x'}]})}, /Unexpectedly in target/);
assert.throws(function(){JDELTA.patch({}, {steps:[{op:'arrayInsert', path:'$', key:'1'}]})}, /Expected an integer key/);
assert.throws(function(){JDELTA.patch({}, {steps:[{op:'arrayInsert', path:'$', key:1}]})}, /patch:arrayInsert: Expected an Array target/);
assert.throws(function(){JDELTA.patch([], {steps:[{op:'arrayInsert', path:'$', key:1}]})}, /IndexError/);
assert.throws(function(){JDELTA.patch([], {steps:[{op:'arrayInsert', path:'$', key:0}]})}, /undefined value/);
assert.throws(function(){JDELTA.patch({}, {steps:[{op:'arrayRemove', path:'$', key:'1'}]})}, /Expected an integer key/);
assert.throws(function(){JDELTA.patch({}, {steps:[{op:'arrayRemove', path:'$', key:1}]})}, /patch:arrayRemove: Expected an Array target/);
assert.throws(function(){JDELTA.patch([], {steps:[{op:'arrayRemove', path:'$', key:0}]})}, /IndexError/);
assert.throws(function(){JDELTA.patch(['x'], {steps:[{op:'arrayRemove', path:'$', key:0}]})}, /Array value did not match/);
assert.throws(function(){JDELTA.patch({}, {steps:[{op:'xxx', path:'$', key:''}]})}, /Illegal operation/);
assert.throws(function(){JDELTA._getTarget()}, /I need an Object or Array/);
assert.throws(function(){JDELTA.patch({}, {steps:[{path:'', key:''}]})}, /I need a path/);
assert.throws(function(){JDELTA.patch({}, {steps:[{path:'xxx', key:''}]})}, /The first path item must be \$/);




console.log('All Tests Passed.  :)');
console.log('Generating Code Coverage Reports...');
coverage.save_report(JsonDelta);

