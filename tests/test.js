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

assert.deepEqual(JDELTA.createDelta({}, []), {"prehash":305420272,"posthash":305420272,"ops":[]});
assert.deepEqual(JDELTA.createDelta({}, [{op:'add',key:'a',value:'1'}]), {"prehash":305420272,"posthash":305422793,"ops":[{"op":"add","key":"a","value":"1"}]});
assert.throws(function(){JDELTA.createDelta({}, [{op:'add', path:'$.x', key:'a', value:'1'}])}, /Path not found/);
assert.throws(function(){JDELTA.createDelta({a:1}, [{op:'add', key:'a', value:2}])}, /Already in target/);
assert.throws(function(){JDELTA.createDelta({}, [{op:'update', key:'a', value:2}])}, /Not in target/);
assert.deepEqual(JDELTA.createDelta({a:1}, [{op:'update', key:'a', value:2}]), {"prehash":305422001,"posthash":305422007,"ops":[{"op":"update","key":"a","value":2}]});
assert.deepEqual(JDELTA.createDelta({a:1}, [{op:'update', key:'a', value:2},
                                            {op:'add', key:'b', value:3}]), {"prehash":305422001,"posthash":305425872,"ops":[{"op":"update","key":"a","value":2},
                                                                                                                             {"op":"add","key":"b","value":3}]});

assert.throws(function(){JDELTA.applyDelta({a:2}, JDELTA.createDelta({a:1}, [{op:'update', key:'a', value:3}]))}, /Prehash did not match/);
assert.deepEqual(JDELTA.applyDelta({a:2}, JDELTA.createDelta({a:2}, [{op:'update', key:'a', value:3}])), {a:3});
assert.deepEqual(JDELTA.applyDelta({a:2}, JDELTA.createDelta({a:2}, [{op:'remove', key:'a'}])), {});
assert.deepEqual(JDELTA.applyDelta([1,2,3], JDELTA.createDelta([1,2,3], [{op:'update', key:1, value:4}])), [1,4,3]);

console.log('All Tests Passed.  :)');
console.log('Generating Code Coverage Reports...');
coverage.save_report(JsonDelta);

