$(document).ready(function(){
    var bar = $('.bar');
    var percent = $('.percent');
    var status = $('#status');

    var socket = io();

    var CMCall = null;
    var uploadCall = null;
    var uploadRequestCall = null;

    var indices = [];
    var uploadIndices = [];

    var pfCount = 0;
    var existCount = 0;
    var uploadCount = 0;
    var abortedCount = 0;
    var unmatchedCount = 0;

    var update = null;
    var updateUnmatched = null;

    socket.on('CMAccept', function(res) {
        console.log('response received.');
        update(res);
    });

    socket.on('CMUnmatched', function(res) {
        updateUnmatched(res.index);
    });

    socket.on('CMReceived', function(res) {
        console.log('Calling next movie...');
        CMStatusUpdate(res.index);
        if(indices.length > 0)
            CMCall(indices.shift());
    });

    socket.on('CMFull', function(res) {
        console.log('For index ' + res.index + ' bufffer full...');
        indices.push(res.index);
        if(indices.length > 0)
        {
            var f_nextCall = CMCall.bind(null, indices.shift());
            setTimeout(f_nextCall, 2000);
        }
    });

    socket.on('UReceived', function(res) {
        if(uploadIndices.length > 0)
            uploadRequestCall(uploadIndices.shift());
    });

    socket.on('UAccept', function(res) {
        uploadCall(res);
    });

    socket.on('UFull', function(res) {
        console.log('Upload slots full...');
        uploadIndices.push(res);
        var f_nextCall = URequestCall.bind(null, uploadIndices.shift());
        setTimeout(f_nextCall, 5000);
    });

    $('form').ajaxForm({
        beforeSend: function() {
            status.empty();
            var percentVal = '0%';
            bar.width(percentVal)
            percent.html(percentVal);
            console.log("testing");
        },

        beforeSubmit: function(arr, $form, options) {
            var mediaInfo = null;
            $.ajax({
                url: '/checkMovie',
                method: "POST",
                contentType: 'application/json',
                data: JSON.stringify({name: arr[0].value.name}),

                success: function(data) {
                    mediaInfo = data;
                },

                async: false
            });
            if(mediaInfo[0].status == 'EXIST')
            {
                console.log("Movie " + mediaInfo[0].name + " already exists.");
                return false;
            }
        },

        uploadProgress: function(event, position, total, percentComplete) {
            var percentVal = percentComplete + '%';
            bar.width(percentVal)
            percent.html(percentVal);
        },

        success: function() {
            var percentVal = '100%';
            bar.width(percentVal)
            percent.html(percentVal);
        },

        complete: function(xhr) {
            status.html(xhr.responseText);
        }
    });

    var rowCount=0;
    function createStatusbar(obj)
    {
        rowCount++;
        var row="odd";
        if(rowCount %2 ==0) row ="even";
        this.rowNumber=rowCount;
        this.statusbar = $("<div class='row' id='"+rowCount+"'></div>");

        this.imageDiv = $('<div class="col-md-3"></div>').appendTo(this.statusbar);
        this.imageHref = $('<a href="#" class="thumbnail" style="width:140px;height:205"></a>').appendTo(this.imageDiv);
        this.thumb = $('<img src="" alt="Please wait while we fetch the metadata..." style="width:100%">').appendTo(this.imageHref);

        this.infoDiv = $('<div class="col-md-6"></div>').appendTo(this.statusbar);
        this.title = $('<div class="title"></div>').appendTo(this.infoDiv);
        this.filename = $("<div class='filename'></div>").appendTo(this.infoDiv);
        this.size = $("<div class='filesize'></div>").appendTo(this.infoDiv);

        this.progress = $('<div class="progress"></div>').appendTo(this.infoDiv).hide();
        this.progressBar = $('<div class="progress-bar progress-bar-striped active" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%"></div>').appendTo(this.progress);
        this.progressSpan = $('<span class="sr-only">45% Complete</span>').appendTo(this.progress);
        this.abort = $('<button type="button" class="btn btn-danger">Abort</button>').appendTo(this.infoDiv).hide();

        this.statusDiv = $('<div class="col-md-3"></div>').appendTo(this.statusbar);
        this.statusHeader = $('<h2></h2>').appendTo(this.statusDiv);
        this.statusLabel = $('<span class="label label-default">Checking...</span>').appendTo(this.statusHeader);

        this.pendingFileEntry = $('<li class="list-group-item"></li>').appendTo($('#pendingFilesList')).hide();

        this.filenameText = null;

        this.metaInfo = null;

        this.startUpload = function()
        {
            this.progress.show();
            this.abort.show();
            this.updateStatus('upload');
        }

        this.endUpload = function()
        {
            this.progress.hide();
            this.abort.hide();
        }

        this.updateStatus = function(cStatus)
        {
            if(cStatus == 'exist')
            {
                this.statusLabel.html('EXIST');
                this.statusLabel.removeClass();
                this.statusLabel.addClass('label label-warning');
                this.statusbar.detach().appendTo($('#existFilesPanel'));
                existCount++;
                $('#existCount').html(existCount);
            }
            else if(cStatus == 'upload')
            {
                this.statusLabel.html('Uploading...');
                this.statusLabel.removeClass();
                this.statusLabel.addClass('label label-primary');
            }
            else if(cStatus == 'aborted')
            {
                this.statusLabel.html('ABORTED');
                this.statusLabel.removeClass();
                this.statusLabel.addClass('label label-danger');
                this.statusbar.detach().appendTo($('#abortedFiles'));
                abortedCount++;
                $('#abortedCount').html(abortedCount);
            }
            else if(cStatus == 'uploaded')
            {
                this.statusLabel.html('UPLOADED');
                this.statusLabel.removeClass();
                this.statusLabel.addClass('label label-success');
                this.statusbar.appendTo($('#uploadFilesPanel'));
                uploadCount++;
                $('#uploadCount').html(uploadCount);
            }
            else if(cStatus == 'checking')
            {
                this.pendingFileEntry.hide();
                pfCount--;
                $('#pfCount').html(pfCount);
                this.statusbar.appendTo($('#dragandrophandler'));
            }
            else if(cStatus == 'pending')
            {
                this.pendingFileEntry.html(this.filenameText);
                this.pendingFileEntry.show();
                pfCount++;
                $('#pfCount').html(pfCount);
            }
            else if(cStatus == 'unmatched')
            {
                this.statusbar.detach().appendTo($('#unmatchedFilesPanel'));
                unmatchedCount++;
                $('#unmatchedCount').html(unmatchedCount);
            }
        }

        this.setFileNameSize = function(name, size)
        {
            this.filenameText = name;
            var sizeStr="";
            var sizeKB = size/1024;

            if(parseInt(sizeKB) > 1024)
            {
                var sizeMB = sizeKB/1024;
                sizeStr = sizeMB.toFixed(2)+" MB";
            }
            else
            {
                sizeStr = sizeKB.toFixed(2)+" KB";
            }

            this.filename.html("Filename: " + name);
            this.size.html("Size: " + sizeStr);
        }

        this.setThumbnail = function(title) {
            this.thumb.attr('src', "/movieThumbs/" + title);
        }

        this.setTitle = function(title) {
            this.title.html("Title: " + title);
        }

        this.setProgress = function(progress)
        {
            this.progressBar.css('width', progress + '%').attr('aria-valuenow', progress);
        }

        this.setAbort = function(jqxhr)
        {
            var sb = this.statusbar;
            var _this = this;
            this.abort.click(function()
            {
                _this.endUpload();
                jqxhr.abort();
                _this.updateStatus('aborted');
            });
        }
    }

    function handleFileUpload(files, statusArr, i)
    {
        if(i < statusArr.length)
        {
            var file = files[i];
            var status = statusArr[i];
            var data = null;

            socket.emit('checkMovieRequest', {filename: file.name, index: i});
        }
    }

    function handleSequentialFileUploads(files, obj)
    {
        if(files.length == 0)
            return;

        var statusArr = [];

        for (var i = 0; i < files.length; i++)
        {
            var status = new createStatusbar(obj); //Using this we can set progress.
            status.setFileNameSize(files[i].name, files[i].size);
            status.updateStatus('pending');
            statusArr.push(status);
            indices.push(i);
        }

        update = function(res) {
            var data = res.info;
            var status = statusArr[res.index];
            var file = files[res.index];

            status.metaInfo = data;

            status.setThumbnail(res.info.title);
            console.log(res);
            if(data.status == 'EXIST')
            {
                console.log("Movie " + data.name + " already exists.");
                status.updateStatus('exist');
            }
            else
            {
                socket.emit('uploadRequest', res);
            }
        }

        CMCall = function(index)
        {
            handleFileUpload(files, statusArr, index);
        }

        uploadCall = function(info)
        {
            var res = info.data;
            var slot = info.slot;
            var file = files[res.index];
            var status = statusArr[res.index];
            var data = status.metaInfo;

            var fd = new FormData();
            fd.append('media', file);
            fd.append('title', data.title);
            fd.append('name', data.name);
            fd.append('year', data.year);
            fd.append('slot', slot);
            sendFileToServer(fd, status, function(error, data) { console.log(error); });
        }

        uploadRequestCall = function(res)
        {
            console.log('testing');
            socket.emit('uploadRequest', res);
        }

        CMStatusUpdate = function(index)
        {
            statusArr[index].updateStatus('checking');
        }

        updateUnmatched = function(index)
        {
            statusArr[index].updateStatus('unmatched');
        }

        handleFileUpload(files, statusArr, indices.shift());
    }

    var folderInit = function(e) {
        var fileList = e.target.files;
        handleSequentialFileUploads(fileList, $("#dragandrophandler"));
    }

    function sendFileToServer(formData, status, cb)
    {
        var uploadURL ="/uploadMovie";
        var extraData ={};
        status.startUpload();
        var jqXHR=$.ajax({
            xhr: function() {
                var xhrobj = $.ajaxSettings.xhr();
                if (xhrobj.upload)
                {
                    xhrobj.upload.addEventListener('progress', function(event) {
                        var percent = 0;
                        var position = event.loaded || event.position;
                        var total = event.total;
                        if (event.lengthComputable) {
                            percent = Math.ceil(position / total * 100);
                        }
                        //Set progress
                        if(typeof status!== 'undefined')
                            status.setProgress(percent);
                    }, false);
                }
                return xhrobj;
            },
            url: uploadURL,
            type: "POST",
            contentType:false,
            processData: false,
            cache: false,
            data: formData,
            success: function(data) {
                if(typeof status !== 'undefined')
                {
                    status.setProgress(100);
                    status.endUpload();
                    status.updateStatus('uploaded');
                }
                cb(data);
            },
            error: function (xhr, status, errMsg) {
                cb(errMsg);
            }
        });

        if( typeof status!== 'undefined')
            status.setAbort(jqXHR);
    }

    $('#dir_input').change(folderInit);
});