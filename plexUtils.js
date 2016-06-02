var request = require('request');

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
    }
}