// usage:  node test_server.js [BIND_PORT] [BIND_IP]

var http = require('http'),
    sebweb = require('sebweb'),
    JDeltaDB = require('../JDeltaDB.js').JDeltaDB,
    JDeltaSync = require('../JDeltaSync.js').JDeltaSync,
    BIND_PORT = process.argv[2]  ||  8080,
    BIND_IP = process.argv[3]  ||  '127.0.0.1';

//var db = JDeltaDB.DB(JDeltaDB.RamStorage(__dirname+'/db.json'));
var db = JDeltaDB.DB(JDeltaDB.DirStorage(__dirname+'/db'));
//db.createState('a');
//db.edit('a', [{op:'create', key:'x', value:1}]);
//db.edit('a', [{op:'update', key:'x', value:{r:'1'}}]);
//db.createState('b');
//db.edit('b', [{op:'create', key:'x', value:1},
//              {op:'update', key:'x', value:{r:'1'}}]);
var syncServer = JDeltaSync.Server(db);

var router = sebweb.Router([
    {path:'^/rt_test/query$',      func:JDeltaSync.sebwebHandler_query(syncServer)},
    {path:'^/rt_test/clientSend$', func:JDeltaSync.sebwebHandler_clientSend(syncServer)},
    {path:'^/rt_test/clientReceive$', func:JDeltaSync.sebwebHandler_clientReceive(syncServer)},
    {path:'^/static_cached/(?<path>.*)$', func:sebweb.StaticDir(__dirname+'/static', {indexFilename:'index.html', forceExpires:true})},
    {path:'^/(?<path>.*)$', func:sebweb.StaticDir(__dirname+'/static', {indexFilename:'index.html'})},
], {logReqStart:true});

var server = http.createServer(router);
server.listen(BIND_PORT, BIND_IP);
console.log('Server is running: http://%s:%s/', BIND_IP, BIND_PORT);
