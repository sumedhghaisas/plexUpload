var plexUtils = require('./plexUtils.js');
var pathUtils = require('path');
var utils = require('./utils.js');
var fs = require('fs');
var logger = require('simple-node-logger');

var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

module.exports = {

    CMRequests: [],

    checkTempMovie: function(tempMedia, sectionKey, logFile)
    {
        var _this = this;
        logFile.info('Checking movie "' + tempMedia.$.title + '"(' + tempMedia.$.year + ') in main library(' + config.MovieSectionKey + ')...');
        return plexUtils.checkMovieInLibrary(tempMedia.$.title, tempMedia.$.year, config.MovieSectionKey, logFile).then(function(info) {
            if(info)
            {
                logFile.info('Assigning EXIST status.');
                info.status = 'EXIST';
            }
            else 
            {
                logFile.info('Assigning NEXIST status.');
                info = {name: pathUtils.basename(tempMedia.Media[0].Part[0].$.file), title: tempMedia.$.title, thumb: tempMedia.$.thumb, year: tempMedia.$.year, status: 'NEXIST'};
            }

            logFile.info('Wait for movie:"' + info.title + '" in library ' + sectionKey + ' for thumb and year.');
            return plexUtils.waitForThumbAndYear(info, sectionKey, logFile, 7).then(function(info) {
                return new Promise(function(resolve, reject) { resolve(info); });
            }, function(error) {
                return new Promise(function(resolve, reject) { reject(error); });
            });
        }, function(error) {
            return new Promise(function(resolve, reject) { reject(error); });
        });
    },
    
    processCheckRequest: function(request, tempLibrary, logFile, tries)
    {
        var sectionKey = tempLibrary.key;
        var newMedia = null;

        var _this = this;

        logFile.info('Getting metadata for library ' + sectionKey);
        return plexUtils.getMetadata(sectionKey).then(utils.xmlToJSON
            , function(error) {
                return new Promise(function(resolve, reject) { reject('ERROR: Could not retrieve temp library metadata. error: ' + error); });
            }).then(function(jsonData) {
                logFile.info('Checking if metadata for file "' + request.filename + '" is fetched...');
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
                    if(newMedia)
                    {
                        logFile.info('Media identified with title: ' + newMedia.$.title);
                        return _this.checkTempMovie(newMedia, sectionKey, logFile).then(function(info) {
                            return new Promise(function(resolve, reject) { resolve(info); });
                        }, function(error) {
                            return new Promise(function(resolve, reject) { reject(error); });
                        });
                    }
                    else
                    {
                        logFile.info('Could not fetch metadata for file.');
                        logFile.info('Sending the request again...');
                        return utils.promiseWait(5000).then(function() {
                            return _this.processCheckRequest(request, tempLibrary, logFile);
                        });
                    }
                }
                else
                {
                    logFile.info('Could not fetch metadata for file.');
                    logFile.info('Sending the request again...');
                    if(tries > 0)
                    {
                        return utils.promiseWait(5000).then(function() {
                            tries = tries - 1;
                            return _this.processCheckRequest(request, tempLibrary, logFile, tries);
                        });
                    }
                    else return new Promise(function(resolve, reject) { resolve(null); })
                }
            }, function(error) {
                return new Promise(function(resolve, reject) { reject(error); });
            });
    },

    checkRequest: function(request, tempLibrary, logFile) {
        var _this = this;

        return utils.addDummyFile(request.filename, tempLibrary.dir).then(function () {
            logFile.info('Sample file placed in temp library.');
            return plexUtils.refreshLibrary(tempLibrary.key).then(function () {
                logFile.info('Temp library (' + tempLibrary.key + ") refreshed successfully.");
                return _this.processCheckRequest(request, tempLibrary, logFile, 6);
            }, function () {
                return new Promise(function (resolve, reject) {
                    reject('ERROR: could not refresh temp movie library. error: ' + error);
                });
            }).then(function (info)  {
                return utils.fetchImage('http://127.0.0.1:32400' + info.thumb, info, logFile).then(function () {
                    utils.deleteDummyFile(request.filename, tempLibrary.dir);
                    return new Promise(function (resolve, reject) {
                        resolve(info);
                    });
                });
            }, function (error) {
                utils.deleteDummyFile(request.filename, tempLibrary.dir);
                return new Promise(function (resolve, reject) {
                    reject(error);
                });
            });
        }, function (error) {
            return new Promise(function (resolve, reject) {
                reject('ERROR: could not copy sample file for name ' + request.filename);
            });
        }).catch(function (err) {
            logFile.error("Error in checkRequest: " + err);
        });
    }
}