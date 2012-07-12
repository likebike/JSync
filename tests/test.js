//  jsonseq - Test Suite
//  (c) 2012 LikeBike LLC
//  jsonseq is freely distributable under the 3-clause BSD license.  (See LICENSE.TXT)


var coverage = require('./coverage.js'),
    assert = require('assert'),
    jsondiff = require('./cov_lib/jsondiff.js');
JDIFF = jsondiff.JDIFF;


var o = {a:1, c:2, b:3, d:{z:4, x:5, y:6}};
assert.deepEqual(JDIFF.stringify(o), '{"a":1,"b":3,"c":2,"d":{"x":5,"y":6,"z":4}}');
o['e'] = 7;
assert.deepEqual(JDIFF.stringify(o), '{"a":1,"b":3,"c":2,"d":{"x":5,"y":6,"z":4},"e":7}');
delete o['c'];
assert.deepEqual(JDIFF.stringify(o), '{"a":1,"b":3,"d":{"x":5,"y":6,"z":4},"e":7}');
o['c'] = 8;
assert.deepEqual(JDIFF.stringify(o), '{"a":1,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['a'] = 9;
assert.deepEqual(JDIFF.stringify(o), '{"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[1] = '\\slash';
assert.deepEqual(JDIFF.stringify(o), '{"1":"\\\\slash","a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['2'] = [1,null,3];
assert.deepEqual(JDIFF.stringify(o), '{"1":"\\\\slash","2":[1,null,3],"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[3] = null;
assert.deepEqual(JDIFF.stringify(o), '{"1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[0] = 'number0';
assert.deepEqual(JDIFF.stringify(o), '{"0":"number0","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['0'] = 'string0';
assert.deepEqual(JDIFF.stringify(o), '{"0":"string0","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o[0] = 'number0again';
assert.deepEqual(JDIFF.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7}');
o['加'] = '油';
assert.deepEqual(JDIFF.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7,"加":"油"}');
o[true] = false;
assert.deepEqual(JDIFF.stringify(o), '{"0":"number0again","1":"\\\\slash","2":[1,null,3],"3":null,"a":9,"b":3,"c":8,"d":{"x":5,"y":6,"z":4},"e":7,"true":false,"加":"油"}');
console.log(JDIFF.stringify(o));

assert.equal(JDIFF.hash(''), 0x12345678);  // 0x12345678 == 305419896
assert.equal(JDIFF.hash('\0'), 305419897);
assert.equal(JDIFF.hash('a'), 305419994);
assert.equal(JDIFF.hash('b'), 305419995);
assert.equal(JDIFF.hash('c'), 305419996);
assert.equal(JDIFF.hash('aa'), 305420190);
assert.equal(JDIFF.hash('ab'), 305420192);
assert.equal(JDIFF.hash('ac'), 305420194);
assert.equal(JDIFF.hash('The quick brown fox jumps over the lazy dog'), 305510356);
assert.equal(JDIFF.hash('加油！'), 305692563);
var s = 'The quick brown fox jumps over the lazy dog. 加油！';
var bigS = '';
var startTime = new Date().getTime();
for(var i=0; i<1024*1024; i++) bigS += s;
console.log('loop time: %s ms', new Date().getTime() - startTime);
startTime = new Date().getTime();
assert.equal(JDIFF.hash(bigS), 522514691);
console.log('hash of %s-char str: %s ms', bigS.length, new Date().getTime() - startTime);
startTime = new Date().getTime();
assert.equal(JDIFF.hash(s), 310928681);
console.log('hash of %s-char str: %s ms', s.length, new Date().getTime() - startTime);


console.log('All Tests Passed.  :)');
console.log('Generating Report...');
coverage.save_report(jsondiff);

