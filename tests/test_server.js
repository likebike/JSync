// usage:  node test_server.js [BIND_PORT] [BIND_IP]

var http = require('http'),
    sebweb = require('sebweb'),
    BIND_PORT = process.argv[2]  ||  8080,
    BIND_IP = process.argv[3]  ||  '127.0.0.1';

var router = sebweb.Router([
    {path:'^/(?<path>.*)$', func:sebweb.StaticDir(__dirname+'/static', {indexFilename:'index.html'})}
]);

var server = http.createServer(router);
server.listen(BIND_PORT, BIND_IP);
console.log('Server is running: http://%s:%s/', BIND_IP, BIND_PORT);
