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

var utils = require('./utils.js');
var plexUtils = require('./plexUtils.js');

var setupDeferred = q.defer();

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
console.log('Initializing ' + config.parallelUploadCount + ' temp libraries...');
plexUtils.tempLibraries = JSON.parse(fs.readFileSync('temp_libraries.json', 'utf8'));

if(plexUtils.tempLibraries.length < config.parallelUploadCount)
{
    createTempLibraries(config.parallelUploadCount - plexUtils.tempLibraries.length).then(function() {
        fs.writeFileSync('temp_libraries.json', JSON.stringify(plexUtils.tempLibraries));
        console.log('Starting up the server...');
        setupDeferred.resolve();
    });
}
else if(plexUtils.tempLibraries.length > config.parallelUploadCount)
{
    plexUtils.tempLibraries = plexUtils.tempLibraries.slice(0, config.parallelUploadCount);
    console.log(plexUtils.tempLibraries);
    setupDeferred.resolve();
}
else setupDeferred.resolve();


// wait for initial setup
setupDeferred.promise.then(function() {

function shiftToLibraryFolder(file, folderPath, title, year)
{
    return new Promise(function(resolve, reject) {
        var oldPath = file;
        var newPath = folderPath + "\\[" + year + "] " + title;
        console.log('Moving file...');
        console.log(oldPath);
        console.log(newPath);
        fs.mkdir(newPath, function(err) {
            if(err)
            {
                reject('Unable to create dir ' + newPath + ". Error: " + err);
            }
            else 
            {
                fs.rename(oldPath, newPath + "/" + pathUtils.basename(file), function(err) {
                    if(err)
                    {
                        console.log("lol");
                        reject("Unable to move file " + oldPath + " to " + newPath + ". Error: " + err);
                    }
                    else resolve();
                });
            }
        });
        
    });
}

function shiftToMovieLibrary(file, title, year, sectionKey)
{
    return new Promise(function(resolve, reject) {
        request('http://127.0.0.1:32400/library/sections', function (error, response, body) {
            if (!error && response.statusCode == 200) {
                resolve(response.body);
            }
            reject(error);
        });
    }).then(function(xmlData) {
        utils.xmlToJSON(xmlData).then(function(sections) {
            var mainLibrary = null;;
            for(var i = 0;i < sections.MediaContainer.Directory.length;i++)
            {
                var library = sections.MediaContainer.Directory[i];
                if(library.$.key == sectionKey)
                {
                    mainLibrary = library;
                    break;
                }
            }
            if(mainLibrary == null)
                return new Promise(function(resolve, reject) { reject('Invalid sectionKey.'); });
            
            var location = mainLibrary.Location[0].$.path;
            
            return shiftToLibraryFolder(__dirname + "/uploads/" + file, location, title, year).then(function() {
                return plexUtils.refreshLibrary(1);
            }, function(error) {
                return new Promise(function(resolve, reject) { reject(error); });
            });
        });
    }, function(error) {
       return new Promise(function(resolve, reject) { reject('Request to fetch section info failed with error: ' + error); }); 
    });
}

function checkMovieInLibrary(title, year, sectionKey, logFile)
{
    logFile.debug('In checkMovieInLibrary');
    return plexUtils.getMetadata(sectionKey).then(function(xmlData) {
        return utils.xmlToJSON(xmlData).then(function(globData) {
            logFile.debug('globData is');
            logFile.debug(globData);
            var originalMedia = utils.checkDuplicate(title, year, globData);
            var info = null;
            if(originalMedia)
            {
                logFile.debug('In checkMovieInLibrary: found media');
                info = {name: pathUtils.basename(originalMedia.Media[0].Part[0].$.file), title: originalMedia.$.title, thumb: originalMedia.$.thumb, year: originalMedia.$.year};
            }
            logFile.debug('In checkMovieInLibrary: returning promise');
            logFile.debug(info);
            return new Promise(function(resolve, reject) { logFile.debug('In promise'); resolve(info); });
        }, function(error) {
            // error in XML parsing
            logFile.debug('error');
            return new Promise(function(resolve, reject) { reject(error); } );
        });
    }, function(error) {
        logFile.debug('error');
        return new Promise(function(resolve, reject) { reject('Could not fetch global metadata. ' + error); });
    });
}

function waitForMovieInLibrary(title, year, sectionKey)
{
    var tries = 5;
    return new Promise(function(resolve, reject) {
        var fun = function() {
            checkMovieInLibrary(title, year, sectionKey).then(function(info) {
                if(info)
                    resolve(info);
                else if(tries > 0)
                {
                    tries--;
                    setTimeout(fun, 500);
                }
                else resolve(info);
            }, function(error) {
                reject(error);
            });
        };
        
        setTimeout(fun, 1000);
    });
}

function waitForThumbAndYear(info, sectionKey, logFile)
{
    var tries = 5;
    return new Promise(function(resolve, reject) {
        if(info.thumb)
            resolve(info);
        else 
        {
            var fun = function() {
                checkMovieInLibrary(info.title, info.year, sectionKey, logFile).then(function(res) {
                    logFile.debug(res);
                    if(res && res.thumb != undefined && res.year != undefined)
                        resolve(res);
                    else if(tries > 5)
                    {
                        tries--;
                        setTimeout(fun, 1000);
                    }
                    else resolve(res);
                }, function(error) {
                    reject(error);
                });
            }
            
            setTimeout(fun, 1000);
        }
    });
}

function checkTempMovie(tempMedia, sectionKey, logFile)
{
    logFile.debug('in checkTempMovie');
    return checkMovieInLibrary(tempMedia.$.title, tempMedia.$.year, 1, logFile).then(function(info) {
        logFile.debug('in checkTempMovie: returned ' + info);
        if(info)
        {
            info.status = 'EXIST';
        }
        else info = {name: pathUtils.basename(tempMedia.Media[0].Part[0].$.file), title: tempMedia.$.title, thumb: tempMedia.$.thumb, year: tempMedia.$.year, status: 'NEXIST'};
        return waitForThumbAndYear(info, sectionKey, logFile);
    }, function(error) {
        logFile.debug('in checkTempMovie: error: ' + error);
        return new Promise(function(resolve, reject) { reject(error); });
    });
}

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
                return shiftToMovieLibrary(newMedia, 1);
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
    console.log(req.body);
    console.log(req.body.name);
    console.log(req.body.title);
    console.log(req.body.year);
    shiftToMovieLibrary(req.body.name, req.body.title, req.body.year, 1).then(function(data) {
        waitForMovieInLibrary(req.body.title, req.body.year, 1).then(function(info) {
            console.log(info);
            res.send(info);
        }, function(error) {
            res.send(error);
        });
    }, function(err) {
        console.log(err);
        res.send(err);
    });
});

var server = app.listen(3000, function() {
    console.log("Working on port 3000");
});
const io = require('socket.io')(server);
app.use(express.static('static'));

var clients = {};
var CMTokens = {count: 0};
var CMRequests = [];

var freeTempLibraries = [];
for(var i = 0;i < plexUtils.tempLibraries.length;i++)
    freeTempLibraries.push(plexUtils.tempLibraries[i]);

function testFun2(request, tempLibrary, logFile)
{
    var sectionKey = tempLibrary.key;
    var newMedia = null;
    
    logFile.debug('In testFun2');
    
    return plexUtils.getMetadata(sectionKey).then(utils.xmlToJSON
    , function(error) {
        return new Promise(function(resolve, reject) { reject('ERROR: Could not retrieve temp library metadata. error: ' + error); });
    }).then(function(jsonData) {
        logFile.debug('In Fun: received metadata ');
        logFile.debug(jsonData);
        if(jsonData.MediaContainer.Video)
        {
            for(var i = 0;i < jsonData.MediaContainer.Video.length;i++)
            {
                if(pathUtils.basename(jsonData.MediaContainer.Video[i].Media[0].Part[0].$.file) == request.filename)
                {
                    newMedia = jsonData.MediaContainer.Video[i];
                    break;
                }
            }  
            logFile.debug('In Fun: after media scan');
            if(newMedia)
            {
                logFile.info('Media identified with title: ' + newMedia.$.title);
                logFile.debug('In Fun: found media scan');
                return checkTempMovie(newMedia, sectionKey, logFile).then(function(info) {
                    logFile.debug("Success");
                    logFile.debug(info);
                    return new Promise(function(resolve, reject) { resolve(info); });
                }, function(error) {
                    logFile.debug(error);
                    return new Promise(function(resolve, reject) { reject(error); });
                });
            }
            else return utils.promiseWait(1000).then(function() {
                return testFun2(request, tempLibrary, logFile);
            });
        }
        else return utils.promiseWait(1000).then(function() {
            return testFun2(request, tempLibrary, logFile);
        });
    }, function(error) {
        return new Promise(function(resolve, reject) { reject(error); });
    });
}

function testFun(request, tempLibrary, logFile)
{
    return utils.addDummyFile(request.filename, tempLibrary.dir).then(function() {
        return plexUtils.refreshLibrary(tempLibrary.key).then(function() {
            logFile.debug('Calling testFun2...');
            return testFun2(request, tempLibrary, logFile);
        }, function() {
            return new Promise(function(resolve, reject) { reject('ERROR: could not refresh temp movie library. error: ' + error); });
        }).then(function(info) {
            utils.deleteDummyFile(request.filename, tempLibrary.dir);
            return new Promise(function(resolve, reject) { resolve(info); });
        }, function(error) {
            utils.deleteDummyFile(request.filename, tempLibrary.dir);
            return new Promise(function(resolve, reject) { reject(error); });
        });
    }, function(error) {
        return new Promise(function(resolve, reject) { reject('ERROR: could not copy sample file for name ' + request.filename); });
    }).catch(function(err) { logFile.error(err); });
}

function acceptCMRequest(socket, data, logFile)
{
    return new Promise(function(resolve, reject) {
        logFile.info('Checking for slot...');
        if(freeTempLibraries.length > 0)
        {
            CMRequests.push({id: socket.id, filename: data.filename, index: data.index});
            resolve();
            var request = null;
            while(request == null && CMRequests.length > 0)
            {
                request = CMRequests.shift();
                //check if the client is still connected
                if(!clients[request.id])
                    request == null;
            }
        
            if(request != null) 
            {
                //get free temp library
                var tempLibrary = freeTempLibraries.shift();
        
                logFile.info('Request for ' + request.filename + ' with temp library key ' + tempLibrary.key);
                testFun(request, tempLibrary, logFile).then(function(info) {
                    logFile.info('Request satisfied. Sending the response through socket.');
                    logFile.debug(request);
                    var res = {index: request.index, info:info};
                    logFile.debug(info);
                    freeTempLibraries.push(tempLibrary);
                    clients[request.id].emit('CMAccept', res);
                }, function(error) {
                    logFile.error(error);
                }).catch(function(err) { logFile.error(error); });
        
                setTimeout(acceptCheckMovieRequest, 200);
            }
        }
        else 
        {
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
        var logFile = logger.createSimpleLogger(__dirname + '/logs/' + pathUtils.basename(data.filename) + '.log');
        logFile.setLevel('debug');
        acceptCMRequest(socket, data, logFile).then(function() {
            socket.emit('CMReceived', {index: data.index});
        }, function(error) {
            socket.emit('CMFull', {index: data.index});
        });
    });
});

app.get('/', function(req, res) {
    res.sendFile(__dirname + "/index.html");
});

});