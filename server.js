var express =   require("express");
var multer  =   require('multer');
var app         =   express();
var request = require('request');
var pathUtils = require('path');
var fs = require('fs');
var bodyParser = require('body-parser');
var queryString = require('querystring');
var util = require("util");
var rmdir = require('rimraf');
var q = require('q');
var async = require('async');
var logger = require('simple-node-logger');
var http = require('http');

var utils = require('./utils.js');
var plexUtils = require('./plexUtils.js');
var checkMovie = require('./checkMovie.js');

var setupDeferred = q.defer();

var clients = {};
var CMTokens = {count: 0};
var CMRequests = [];
var uploadRequests = [];
var uploadSlots = [];
var mainLibraryPath = '';

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
console.log('Initializing ' + config.parallelCheckCount + ' temp libraries...');
plexUtils.tempLibraries = JSON.parse(fs.readFileSync('temp_libraries.json', 'utf8'));

if(plexUtils.tempLibraries.length < config.parallelCheckCount)
{
    createTempLibraries(config.parallelCheckCount - plexUtils.tempLibraries.length).then(function() {
        fs.writeFileSync('temp_libraries.json', JSON.stringify(plexUtils.tempLibraries));
        console.log('Starting up the server...');
        setupDeferred.resolve();
    });
}
else if(plexUtils.tempLibraries.length > config.parallelCheckCount)
{
    plexUtils.tempLibraries = plexUtils.tempLibraries.slice(0, config.parallelCheckCount);
    console.log(plexUtils.tempLibraries);
    setupDeferred.resolve();
}
else setupDeferred.resolve();

plexUtils.waitMovieDeferred.resolve();

// wait for initial setup
setupDeferred.promise.then(function() {
    return new Promise(function(resolve, reject) {
        request('http://' + config.MainPlexIP + ':' + config.MainPlexPort + '/library/sections', function (error, response, body) {
            if (!error && response.statusCode == 200) {
                resolve(response.body);
            }
            reject(error);
        });
    }).then(function(xmlData) {
        return utils.xmlToJSON(xmlData).then(function(sections) {
            var mainLibrary = null;;
            for(var i = 0;i < sections.MediaContainer.Directory.length;i++)
            {
                var library = sections.MediaContainer.Directory[i];
                if(library.$.key == config.MovieSectionKey)
                {
                    mainLibrary = library;
                    break;
                }
            }
            if(mainLibrary == null)
                return new Promise(function(resolve, reject) { reject('Invalid sectionKey.'); });

            mainLibraryPath = mainLibrary.Location[0].$.path;
            console.log('Main library path is: ' + mainLibraryPath);
            return new Promise(function(resolve, reject) { resolve(); });
        });
    }, function(error) {
        return new Promise(function(resolve, reject) { reject('Request to fetch section info failed with error: ' + error); });
    }).catch(function(error) { console.log(error); });
}, function(error) {
    console.log('Could not initialize plex upload.');
    return new Promise(function(resolve, reject) { reject(); });
}).then(function() {

    function uploadMovie(newMedia)
    {
        var sectionKey = 1;
        return plexUtils.getMetadata(sectionKey).then(function(xmlData) {
            return utils.xmlToJSON(xmlData).then(function(globData) {
                var originalMedia = utils.checkDuplicate(newMedia, globData);
                if(originalMedia)
                    return new Promise(function(resolve, reject) { reject('The media already exists.'); });
                else
                {
                    console.log('Adding media...');
                    return plexUtils.shiftToMovieLibrary(newMedia, 1);
                }
            }, function(error) {
                return new Promise(function(resolve, reject) { reject(error); } );
            });
        }, function(error) {
            return new Promise(function(resolve, reject) { reject('Could not fetch global metadata. ' + error); });
        });
    }

    var storage =   multer.diskStorage({
        destination: function (req, file, callback) {
            callback(null, './uploads');
        },
        filename: function (req, file, callback) {
            callback(null, file.originalname);
        }
    });

    var upload = multer({ storage : storage}).single('media');

    app.get('/js/PlexUpload.js', function(req, res) {
        res.sendFile(__dirname + "/js/PlexUpload.js");
    });

    app.post('/uploadMovie', upload, function(req, res) {

        var logFile = logger.createSimpleLogger(__dirname + '/logs/' + pathUtils.basename(req.body.title) + '_U.log');
        logFile.info('Shifting file to library folder: ' + mainLibraryPath);
        utils.shiftToLibraryFolder(__dirname + "/uploads/" + req.body.name, mainLibraryPath, req.body.title, req.body.year).
        then(function() {
            logFile.info('Successfully shifted to library folder.');
            plexUtils.refreshLibrary(config.MovieSectionKey).then(function() {
                plexUtils.waitForMovieInLibrary(req.body.title, req.body.year, config.MovieSectionKey, logFile).
                then(function() {
                    logFile.info('Releasing upload slot.');
                    uploadSlots.push(req.body.slot);
                    res.send();
                }, function(error) {
                    uploadSlots.push(req.body.slot);
                    logFile.error(error);
                    res.send(null);
                });
            }, function(error) {
                logFile.error(error);
                res.send(null);
            });
        }, function(error) {
            uploadSlots.push(req.body.slot);
            logFile.error(error);
            res.send(null);
        }).catch(function(error) {
            logFile.error(error);
            res.send(null);
        });
    });

    var server = app.listen(3000, function() {
        console.log("Working on port 3000");
    });
    const io = require('socket.io')(server);
    app.use(express.static('static'));

    for(var i = 0;i < config.parallelUploadCount;i++)
        uploadSlots.push({id: i});

    console.log(uploadSlots);

    var freeTempLibraries = [];
    for(var i = 0;i < plexUtils.tempLibraries.length;i++)
        freeTempLibraries.push(plexUtils.tempLibraries[i]);

    function acceptUploadRequest(socket, data)
    {
        var logFile = logger.createSimpleLogger(__dirname + '/logs/' + pathUtils.basename(data.info.title) + '_U.log');
        logFile.info('Checking for slot...');
        return new Promise(function(resolve, reject) {
            if(uploadSlots.length > 0)
            {
                uploadRequests.push({id: socket.id, data: data, index: data.index});
                logFile.info('Accepting request...');
                resolve();
                var request = null;
                while(request == null && uploadRequests.length > 0)
                {
                    request = uploadRequests.shift();
                    //check if the client is still connected
                    if(!clients[request.id])
                        request = null;
                }

                if(request)
                {
                    logFile = logger.createSimpleLogger(__dirname + '/logs/' + pathUtils.basename(request.data.info.title) + '_U.log');
                    logFile.info('Accepting upload request for movie ' + request.data.info.title);
                    var slot = uploadSlots.shift();
                    clients[request.id].emit('UAccept', {data: data, slot: slot});
                }
            }
            else
            {
                logFile.info('Slots full!');
                reject('Full!!');
            }
        });
    }

    function acceptCMRequest(socket, data)
    {
        return new Promise(function (resolve, reject) {
            var logFile = logger.createSimpleLogger(__dirname + '/logs/' + pathUtils.basename(data.filename) + '_CM.log');
            logFile.info('Checking for slot...');
            if (freeTempLibraries.length > 0) {
                CMRequests.push({id: socket.id, filename: data.filename, index: data.index});
                logFile.info('Check Movie Request with filename ' + data.filename + ' accepted.');
                resolve();
                var request = null;
                while (request == null && CMRequests.length > 0) {
                    request = CMRequests.shift();
                    //check if the client is still connected
                    if (!clients[request.id])
                        request = null;
                }

                if (request != null) {
                    //get free temp library
                    var tempLibrary = freeTempLibraries.shift();
                    logFile = logger.createSimpleLogger(__dirname + '/logs/' + pathUtils.basename(request.filename) + '_CM.log');
                    logFile.info('Request for ' + request.filename + ' will be satisfied with temp library key ' + tempLibrary.key);
                    checkMovie.checkRequest(request, tempLibrary, logFile).then(function (info) {
                        logFile.info('Request satisfied. Sending the response through socket.');
                        var res = {index: request.index, info: info};
                        logFile.debug(info);
                        freeTempLibraries.push(tempLibrary);
                        logFile.debug(info.thumb);
                        utils.fetchImage('http://127.0.0.1:32400' + info.thumb, info, logFile).then(function (base64Img) {
                            clients[request.id].emit('CMAccept', res);
                        }, function (error) {
                            logFile.error(error);
                        });
                    }, function (error) {
                        logFile.error(error);
                    });
                }
            }
            else {
                logFile.info('Slots full.');
                reject('Slots Full.');
            }
        });
    }


    // Set socket.io listeners.
    io.on('connection', (socket) => {
        clients[socket.id] = socket;
        console.log('a user connected');

        socket.on('disconnect', () => {
            console.log('user disconnected');
            delete clients[socket.id];
        });

        socket.on('checkMovieRequest', function(data) {
            acceptCMRequest(socket, data).then(function() {
                socket.emit('CMReceived', {index: data.index});
            }, function(error) {
                socket.emit('CMFull', {index: data.index});
            });
        });

        socket.on('uploadRequest', function(data) {
            acceptUploadRequest(socket, data).then(function() {
                socket.emit('UReceived', data);
            }, function() {
                socket.emit('UFull', data);
            });
        });
    });

    app.get('/', function(req, res) {
        res.sendFile(__dirname + "/index.html");
    });

    app.get('/movieThumbs/:title', function(req, res) {
        fs.exists("movieThumbs/" + req.params.title + ".jpg", function(exists) {
            if (exists) {
                res.sendFile(__dirname + "/movieThumbs/" + req.params.title + ".jpg");
            }
            else res.send('Error');
        });
    });
});