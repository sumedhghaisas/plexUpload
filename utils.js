var xml2js = require('xml2js');
var fs = require('fs');
var pathUtils = require('path');

module.exports = {
    
    xmlToJSON: function(xmlData)
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
    },
    
    copyFile: function(source, target) 
    {
        return new Promise(function(resolve, reject) {
            var rd = fs.createReadStream(source);
            rd.on('error', reject);
            var wr = fs.createWriteStream(target);
            wr.on('error', reject);
            wr.on('finish', resolve);
            rd.pipe(wr);
        });
    },
    
    addDummyFile: function(name, dir)
    {
        var type = pathUtils.extname(name);
        var source = __dirname + "/samples/sample" + type;
        var target = dir + "/" + name;
        return this.copyFile(source, target);
    },
    
    deleteDummyFile: function(name, dir)
    {
        var path = dir + '/' + name;
        setTimeout(function() {fs.unlink(path, function(error) { if(error) console.log('Enable to delete file ' + path + ' :' + error) })}, 5000);
    },
    
    promiseWait: function(time)
    {
        return new Promise(function(resolve, reject) {
            
            var fun = function()
            {
                resolve();
            }
            
            setTimeout(fun, time);
        });
    },
    
    checkDuplicate: function(title, year, globData)
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
}