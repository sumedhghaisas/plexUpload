var express =   require("express");
var multer  =   require('multer');
var app         =   express();
var request = require('request');
var xml2js = require('xml2js');
var pathUtils = require('path');
var fs = require('fs');
var bodyParser = require('body-parser');

function copyFile(source, target) {
    return new Promise(function(resolve, reject) {
        var rd = fs.createReadStream(source);
        rd.on('error', reject);
        var wr = fs.createWriteStream(target);
        wr.on('error', reject);
        wr.on('finish', resolve);
        rd.pipe(wr);
    });
}

function checkDuplicate(title, year, globData)
{
    for(var i = 0;i < globData.MediaContainer.Video.length;i++)
    {
        var media = globData.MediaContainer.Video[i];
        if(title == media.$.title && year == media.$.year)
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
        xmlToJSON(xmlData).then(function(sections) {
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
    return getMetadata(sectionKey).then(function(xmlData) {
        return xmlToJSON(xmlData).then(function(globData) {
            var originalMedia = checkDuplicate(title, year, globData);
            var info = null;
            if(originalMedia)
            {
                info = {name: pathUtils.basename(originalMedia.Media[0].Part[0].$.file), title: originalMedia.$.title, thumb: originalMedia.$.thumb, year: originalMedia.$.year};
            }
            return new Promise(function(resolve, reject) { resolve(info); });
        }, function(error) {
            // error in XML parsing
            return new Promise(function(resolve, reject) { reject(error); } );
        });
    }, function(error) {
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

function waitForThumb(info, sectionKey)
{
    return new Promise(function(resolve, reject) {
        if(info.thumb)
            resolve(info);
        else 
        {
            var fun = function() {
                checkMovieInLibrary(info.title, info.year, sectionKey).then(function(info) {
                    if(info.thumb)
                        resolve(info);
                    else 
                        setTimeout(fun, 500);
                }, function(error) {
                    reject(error);
                });
            }
            
            setTimeout(fun, 500);
        }
    });
}

function checkTempMovie(tempMedia)
{
    return checkMovieInLibrary(tempMedia.$.title, tempMedia.$.year, 1).then(function(info) {
        if(info)
        {
            info.status = 'EXIST';
        }
        else info = {name: pathUtils.basename(tempMedia.Media[0].Part[0].$.file), title: tempMedia.$.title, thumb: tempMedia.$.thumb, year: tempMedia.$.year, status: 'NEXIST'};
        return waitForThumb(info, 5);
    }, function(error) {
        return new Promise(function(resolve, reject) { reject(error); });
    });
}

function uploadMovie(newMedia)
{
    var sectionKey = 1;
    return getMetadata(sectionKey).then(function(xmlData) {
        return xmlToJSON(xmlData).then(function(globData) {
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

function xmlToJSON(xmlData)
{
    return new Promise(function(resolve, reject) {
        xml2js.parseString(xmlData, function(err, result) {
            if(err)
            {
                reject("Error while parsing xml:" + err);
            }
            else resolve(result);
        });
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

function addDummyFile(name)
{
    var type = pathUtils.extname(name);
    var source = __dirname + "/samples/sample" + type;
    var target = __dirname + "/uploads/" + name;
    return copyFile(source, target);
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

app.get('/', function(req, res) {
    res.sendFile(__dirname + "/index.html");
});

app.get('/js/PlexUpload.js', function(req, res) {
    res.sendFile(__dirname + "/js/PlexUpload.js");
});

app.post('/checkMovie', bodyParser.json(), function(req, res) {
    res.contentType('json');
    
    var newMedia = null;
    
    var fun = function() {
        getMetadata(5).then(xmlToJSON, 
        function(error) {
            console.log('ERROR: Could not retrieve temp library metadata. error: ' + error);
            res.send('Error');
        }).then(function(jsonData) {
            for(var i = 0;i < jsonData.MediaContainer.Video.length;i++)
            {
                if(pathUtils.basename(jsonData.MediaContainer.Video[i].Media[0].Part[0].$.file) == req.body.name)
                {
                    newMedia = jsonData.MediaContainer.Video[i];
                    break;
                }
            }    
            if(newMedia)
            {
                checkTempMovie(newMedia).then(function(info) {
                    console.log("Success");
                    console.log(info);
                    res.send(info)
                }, function(error) {
                    console.log(error);
                    res.send("ERROR INTERNAL");
                });
            }
            else setTimeout(fun, 1000)
        }, function(error) {
            // XML parsing failed.
            console.log(error)
            res.send('ERROR');
        });
    };
    
    addDummyFile(req.body.name).then(function() {
        refreshLibrary(5).then(function() {
            setTimeout(fun, 1000);
        }, function() {
            console.log('ERROR: could not refresh temp movie library. error: ' + error);
            res.send('ERROR');
        });
    }, function(error) {
        console.log('ERROR: could not copy sample file for name ' + req.body.name);
        res.send('ERROR');
    });
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

app.listen(3000,function(){
    console.log("Working on port 3000");
});