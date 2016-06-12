var request = require('request');
var utils = require('./utils.js');
var pathUtils = require('path');
var fs = require('fs');
var q = require('q');

module.exports = {

    tempLibraries: {},

    createTempLibrary: function()
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
                this.tempLibraries.push({key: data.MediaContainer.Directory[0].$.key, dir: res.dir});
                return new Promise(function(resolve, reject) { resolve(); });
            }, function(err) {
                return new Promise(function(resolve, reject) { reject('Unable to process the response: ' + err); });
            });
        }, function(err) {
            return new Promise(function(resolve, reject) { reject(err); });
        });
    },

    createTempLibraries: function(count)
    {
        var funcs = [];
        for(var i = 0;i < count - 1;i++)
            funcs.push(createTempLibrary);

        var result = createTempLibrary();
        funcs.forEach(function (f) {
            result = result.then(f);
        });

        return result;
    },

    getMetadata: function(libraryKey)
    {
        return new Promise(function(resolve, reject) {
            request('http://127.0.0.1:32400/library/sections/' + libraryKey + '/all', function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    resolve(response.body);
                }
                else reject(error);
            });
        });
    },

    refreshLibrary: function(libraryKey) {
        return new Promise(function(resolve, reject) {
            request('http://127.0.0.1:32400/library/sections/' + libraryKey + '/refresh', function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    resolve('success');
                }
                else reject(error);
            });
        });
    },

    checkMovieInLibrary: function(title, year, sectionKey, logFile)
    {
        logFile.info('Getting metadata for library ' + sectionKey);
        return this.getMetadata(sectionKey).then(function(xmlData) {
            return utils.xmlToJSON(xmlData).then(function(globData) {
                var originalMedia = utils.checkDuplicate(title, year, globData);
                var info = null;
                if(originalMedia)
                {
                    logFile.info('Found media.');
                    info = {name: pathUtils.basename(originalMedia.Media[0].Part[0].$.file), title: originalMedia.$.title, thumb: originalMedia.$.thumb, year: originalMedia.$.year};
                    logFile.info('Info object is ' + info);
                }
                return new Promise(function(resolve, reject) { resolve(info); });
            }, function(error) {
                // error in XML parsing
                return new Promise(function(resolve, reject) { reject(error); } );
            });
        }, function(error) {
            return new Promise(function(resolve, reject) { reject('Could not fetch global metadata. ' + error); });
        });
    },

    shiftToMovieLibrary: function(file, title, year, sectionKey, logFile)
    {
        var _this = this;
        return new Promise(function(resolve, reject) {
            request('http://127.0.0.1:32400/library/sections', function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    resolve(response.body);
                }
                reject(error);
            });
        }).then(function(xmlData) {
            utils.xmlToJSON(xmlData).then(function(sections) {
                var mainLibrary = null;
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

                return _this.shiftToLibraryFolder(__dirname + "/uploads/" + file, location, title, year).then(function() {
                    return _this.refreshLibrary(1);
                }, function(error) {
                    return new Promise(function(resolve, reject) { reject(error); });
                });
            });
        }, function(error) {
           return new Promise(function(resolve, reject) { reject('Request to fetch section info failed with error: ' + error); });
        });
    },

    waitMovieDeferred: q.defer(),

    waitForMovieInLibrary: function(title, year, sectionKey, logFile)
    {
        var _this = this;
        logFile.info('Waiting for movie "' + title + '" in library ' + sectionKey);
        logFile.info('Waiting for request slot...');
        return _this.waitMovieDeferred.promise.then(function() {
            logFile.info('Received request slot.');
            _this.waitMovieDeferred = q.defer();
            return _this.checkMovieInLibrary(title, year, sectionKey, logFile).then(function(info) {
                if(info)
                {
                    logFile.info('Movie found in library. Ending wait.');
                    _this.waitMovieDeferred.resolve();
                    return new Promise(function(resolve, reject) { resolve(); });
                }
                else
                {
                    logFile.info('Movie not found. Making another call...');
                    _this.waitMovieDeferred.resolve();
                    return utils.promiseWait(5000).then(function() {
                        return _this.waitForMovieInLibrary(title, year, sectionKey, logFile);
                    });
                }
            }, function(error) {
                _this.waitMovieDeferred.resolve();
                return new Promise(function(resolve, reject) { reject(error); });
            });
        });
    },

    waitForThumbAndYear: function(info, sectionKey, logFile)
    {
        var _this = this;
        logFile.info('Waiting for year and thumb for movie ' + info.title);
        return _this.checkMovieInLibrary(info.title, info.year, sectionKey, logFile).then(function(res) {
            if(!res)
            {
                logFile.info('Unable to wait for movie "' + info.title + '" as it does not exist anymore. Returning the result...');
                return new Promise(function(resolve, reject) { resolve(info); });
            }
            else if(res.thumb != undefined && res.year != undefined)
            {
                logFile.info('Thumb and year fetch. Returning the result...');
                return new Promise(function(resolve, reject) { resolve(res); });
            }
            else
            {
                logFile.info('Thumb and year not fetched. Making another call...');
                return utils.promiseWait(5000).then(function() { return _this.waitForThumbAndYear(info, sectionKey, logFile)});
            }
        }, function(error) {
            return new Promise(function(resolve, reject) { reject(error)});
        });
    }
}