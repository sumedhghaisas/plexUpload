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

var utils = require('./utils.js');

var setupDeferred = q.defer();

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
console.log('Initializing ' + config.parallelUploadCount + ' temp libraries...');
var tempLibraries = JSON.parse(fs.readFileSync('temp_libraries.json', 'utf8'));

function createTempLibrary()
{
    return new Promise(function(resolve, reject) {
        var timestamp = Date.now();
        
        var dir = __dirname + "/library_folders/lib_" + timestamp;
        
        console.log('Creating temp library: lib_' + timestamp + ' ...');
        fs.mkdirSync(dir);
        
        var req = 'http://127.0.0.1:32400/library/sections?name=temp_' + timestamp + '&type=movie&agent=com.plexapp.agents.imdb&scanner=Plex%20Movie%20Scanner&language=en&importFromiTunes=&' + queryString.stringify({location: dir});
        request.post({url:req}, function(error, response, body) {
            if(error)
                reject('Error while creating temp library: ' + error);
            else 
                resolve({xml: body, dir: dir});
        });
    }).then(function(res) {
        return utils.xmlToJSON(res.xml).then(function(data) {
            console.log('Successfully created temp library with key: ' + data.MediaContainer.Directory[0].$.key);
            tempLibraries.push({key: data.MediaContainer.Directory[0].$.key, dir: res.dir});
            return new Promise(function(resolve, reject) { resolve(); });
        }, function(err) {
            return new Promise(function(resolve, reject) { reject('Unable to process the response: ' + err); });
        });
    }, function(err) { 
        return new Promise(function(resolve, reject) { reject(err); });
    });
}

function createTempLibraries(count)
{
    var funcs = [];
    for(var i = 0;i < count - 1;i++)
        funcs.push(createTempLibrary);
    
    var result = createTempLibrary();
    funcs.forEach(function (f) {
        result = result.then(f);
    });
    
    return result;
}


if(tempLibraries.length < config.parallelUploadCount)
{
    createTempLibraries(config.parallelUploadCount - tempLibraries.length).then(function() {
        fs.writeFileSync('temp_libraries.json', JSON.stringify(tempLibraries));
        console.log('Starting up the server...');
        setupDeferred.resolve();
    });
}
else if(tempLibraries.length > config.parallelUploadCount)
{
    tempLibraries = tempLibraries.slice(0, config.parallelUploadCount);
    console.log(tempLibraries);
    setupDeferred.resolve();
}
else setupDeferred.resolve();


// wait for initial setup
setupDeferred.promise.then(function() {

//check for saved temp libararies
var tempLibraries = JSON.parse(fs.readFileSync('temp_libraries.json', 'utf8'));
// Check if we need to create a new temp library
if(tempLibraries.length < config.parallelUploadCount)
{
    for(var i = 0;i < (config.parallelUploadCount - tempLibraries);i++)
    {
        
    }
}

function checkDuplicate(title, year, globData)
{
    for(var i = 0;i < globData.MediaContainer.Video.length;i++)
    {
        var media = globData.MediaContainer.Video[i];
        if(title == media.$.title && (year == media.$.year || year == undefined))
        {
            return media;
        }
    }
    return null;
}

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
                return refreshLibrary(1);
            }, function(error) {
                return new Promise(function(resolve, reject) { reject(error); });
            });
        });
    }, function(error) {
       return new Promise(function(resolve, reject) { reject('Request to fetch section info failed with error: ' + error); }); 
    });
}

function checkMovieInLibrary(title, year, sectionKey)
{
    console.log('In checkMovieInLibrary');
    return getMetadata(sectionKey).then(function(xmlData) {
        return utils.xmlToJSON(xmlData).then(function(globData) {
            var originalMedia = checkDuplicate(title, year, globData);
            var info = null;
            if(originalMedia)
            {
                console.log('In checkMovieInLibrary: found media');
                info = {name: pathUtils.basename(originalMedia.Media[0].Part[0].$.file), title: originalMedia.$.title, thumb: originalMedia.$.thumb, year: originalMedia.$.year};
            }
            console.log('In checkMovieInLibrary: returning promise');
            console.log(info);
            return new Promise(function(resolve, reject) { console.log('In promise'); resolve(info); });
        }, function(error) {
            // error in XML parsing
            console.log('error');
            return new Promise(function(resolve, reject) { reject(error); } );
        });
    }, function(error) {
        console.log('error');
        return new Promise(function(resolve, reject) { reject('Could not fetch global metadata. ' + error); });
    });
}

function waitForMovieInLibrary(title, year, sectionKey)
{
    return new Promise(function(resolve, reject) {
        var fun = function() {
            checkMovieInLibrary(title, year, sectionKey).then(function(info) {
                if(info)
                    resolve(info);
                else 
                    setTimeout(fun, 500);
            }, function(error) {
                reject(error);
            });
        };
        
        setTimeout(fun, 1000);
    });
}

function waitForThumbAndYear(info, sectionKey)
{
    return new Promise(function(resolve, reject) {
        if(info.thumb)
            resolve(info);
        else 
        {
            var fun = function() {
                checkMovieInLibrary(info.title, info.year, sectionKey).then(function(res) {
                    console.log(res);
                    if(res && res.thumb != undefined && res.year != undefined)
                        resolve(res);
                    else 
                        setTimeout(fun, 1000);
                }, function(error) {
                    reject(error);
                });
            }
            
            setTimeout(fun, 1000);
        }
    });
}

function checkTempMovie(tempMedia, sectionKey)
{
    console.log('in checkTempMovie');
    return checkMovieInLibrary(tempMedia.$.title, tempMedia.$.year, 1).then(function(info) {
        console.log('in checkTempMovie: returned ' + info);
        if(info)
        {
            info.status = 'EXIST';
        }
        else info = {name: pathUtils.basename(tempMedia.Media[0].Part[0].$.file), title: tempMedia.$.title, thumb: tempMedia.$.thumb, year: tempMedia.$.year, status: 'NEXIST'};
        return waitForThumbAndYear(info, sectionKey);
    }, function(error) {
        console.log('in checkTempMovie: error: ' + error);
        return new Promise(function(resolve, reject) { reject(error); });
    });
}

function uploadMovie(newMedia)
{
    var sectionKey = 1;
    return getMetadata(sectionKey).then(function(xmlData) {
        return utils.xmlToJSON(xmlData).then(function(globData) {
            var originalMedia = checkDuplicate(newMedia, globData);
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



function getMetadata(libraryKey)
{
    return new Promise(function(resolve, reject) {
        request('http://127.0.0.1:32400/library/sections/' + libraryKey + '/all', function (error, response, body) {
            if (!error && response.statusCode == 200) {
                resolve(response.body);
            }
            else reject(error);
        });
    });
}

function refreshLibrary(libraryKey) {
    return new Promise(function(resolve, reject) {
        request('http://127.0.0.1:32400/library/sections/' + libraryKey + '/refresh', function (error, response, body) {
            if (!error && response.statusCode == 200) {
                console.log("Library Successfully refreshed") // Print the google web page.
                resolve('success');
            }
            else reject(error);
        });
    });
}

var storage =   multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, './uploads');
  },
  filename: function (req, file, callback) {
    console.log(file);
    callback(null, file.originalname);
  }
});

var upload = multer({ storage : storage}).single('media');

app.get('/js/PlexUpload.js', function(req, res) {
    res.sendFile(__dirname + "/js/PlexUpload.js");
});

function deleteTempLibrary(sectionKey)
{
    console.log('deleting temp library...');
    return new Promise(function(resolve, reject) {
        request.delete('http://127.0.0.1:32400/library/sections/' + sectionKey, function (error, response, body) {
            if(error)
                reject('Error: not able to delete library with key ' + sectionKey + " : " + error);
            else resolve();
        });
    });
}

function deleteFolderRecursive(path) 
{
    return new Promise(function(resolve, reject) { 
        rmdir(path, function(error)
        {
            if(error)
            {
                console.log(error);
                reject(error);
            }
            else resolve();
        });
    });
}


app.post('/checkMovie', bodyParser.json(), function(req, res) {
    res.contentType('json');
    
    var newMedia = null;
    
    var fun = function(sectionKey, dir) {
        console.log('In Fun');
        var f_fun = fun.bind(null, sectionKey, dir);
        getMetadata(sectionKey).then(utils.xmlToJSON
        , function(error) {
            console.log('ERROR: Could not retrieve temp library metadata. error: ' + error);
            res.send('Error');
            return new Promise(function(resolve, reject) { reject(); });
        }).then(function(jsonData) {
            console.log('In Fun: received metadata ' + jsonData);
            for(var i = 0;i < jsonData.MediaContainer.Video.length;i++)
            {
                if(pathUtils.basename(jsonData.MediaContainer.Video[i].Media[0].Part[0].$.file) == req.body.name)
                {
                    newMedia = jsonData.MediaContainer.Video[i];
                    break;
                }
            }  
            console.log('In Fun: after media scan');
            if(newMedia)
            {
                console.log('In Fun: found media scan');
                checkTempMovie(newMedia, sectionKey).then(function(info) {
                    console.log("Success");
                    console.log(info);
                    res.send(info);
                    return new Promise(function(resolve, reject) { resolve(); });
                }, function(error) {
                    console.log(error);
                    res.send("ERROR INTERNAL");
                    return new Promise(function(resolve, reject) { resolve(); });
                }).then(function() {
                    deleteTempLibrary(sectionKey);
                    deleteFolderRecursive(dir);
                });;
            }
            else setTimeout(f_fun, 1000);
            //return new Promise(function(resolve, reject) { reject(); });
        }, function(error) {
            // XML parsing failed.
            console.log(error)
            res.send('ERROR');
            //return new Promise(function(resolve, reject) { resolve(); });
        });
    };
    
    createTempLibrary().then(function(data) {
        console.log('testing');
        console.log(data);
        var f_fun = fun.bind(null, data.key, data.dir);
        addDummyFile(req.body.name, data.dir).then(function() {
            console.log('testing');
            refreshLibrary(data.key).then(function() {
                setTimeout(f_fun, 1000);
                return new Promise(function(resolve, reject) { reject(); });
            }, function() {
                console.log('ERROR: could not refresh temp movie library. error: ' + error);
                res.send('ERROR');
                return new Promise(function(resolve, reject) { resolve(); });
            }).then(function() {
                deleteTempLibrary(data.key);
                deleteFolderRecursive(data.dir);
            });
        }, function(error) {
            console.log('ERROR: could not copy sample file for name ' + req.body.name);
            res.send('ERROR');
            return new Promise(function(resolve, reject) { resolve(); });
        });
    }, function(err) {
        console.log(err);
    })
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
for(var i = 0;i < tempLibraries.length;i++)
    freeTempLibraries.push(tempLibraries[i]);

function testFun2(request, tempLibrary)
{
    var sectionKey = tempLibrary.key;
    var newMedia = null;
    
    console.log('In testFun2');
    
    return getMetadata(sectionKey).then(utils.xmlToJSON
    , function(error) {
        return new Promise(function(resolve, reject) { reject('ERROR: Could not retrieve temp library metadata. error: ' + error); });
    }).then(function(jsonData) {
        console.log('In Fun: received metadata ');
        console.log(jsonData);
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
            console.log('In Fun: after media scan');
            if(newMedia)
            {
                console.log('In Fun: found media scan');
                return checkTempMovie(newMedia, sectionKey).then(function(info) {
                    console.log("Success");
                    console.log(info);
                    return new Promise(function(resolve, reject) { resolve(info); });
                }, function(error) {
                    console.log(error);
                    return new Promise(function(resolve, reject) { reject(error); });
                });
            }
            else return utils.promiseWait(1000).then(function() {
                return testFun2(request, tempLibrary);
            });
        }
        else return utils.promiseWait(1000).then(function() {
            return testFun2(request, tempLibrary);
        });
    }, function(error) {
        return new Promise(function(resolve, reject) { reject(error); });
    });
}

function testFun(request, tempLibrary)
{
    console.log('In testFun');
    return utils.addDummyFile(request.filename, tempLibrary.dir).then(function() {
        return refreshLibrary(tempLibrary.key).then(function() {
            console.log('Calling testFun2...');
            return testFun2(request, tempLibrary);
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
    }).catch(function(err) { console.log(err); });
}

function acceptCMRequest()
{
    return new Promise(function(resolve, reject) {
        if(freeTempLibraries.length > 0)
        {
            var request = null;
            while(request == null && CMRequests.length > 0)
            {
                console.log('testing');
                request = CMRequests.shift();
                //check if the client is still connected
                if(!clients[request.id])
                    request == null;
            }
        
            if(request == null)
                resolve();
            else 
            {
                //get free temp library
                var tempLibrary = freeTempLibraries.shift();
        
                console.log('Request for ' + request.filename + ' sectionKey ' + tempLibrary.key);
                testFun(request, tempLibrary).then(function(info) {
                    console.log('Will return info...');
                    console.log(request);
                    var res = {index: request.index, info:info};
                    console.log(info);
                    freeTempLibraries.push(tempLibrary);
                    clients[request.id].emit('CMAccept', res);
                }, function(error) {
                    console.log(error);
                }).catch(function(err) { console.log(error); });
        
                setTimeout(acceptCheckMovieRequest, 200);
                resolve();
            }
        }
        else reject('Slots Full.');
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
        CMRequests.push({id: socket.id, filename: data.filename, index: data.index});
        acceptCMRequest().then(function() {
            socket.emit('CMReceived');
        }, function(error) {
            socket.emit('CMFull');
        });
    });
});

app.get('/', function(req, res) {
    res.sendFile(__dirname + "/index.html");
});

});