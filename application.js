/**
Application에서 data에 접근하기 위해서는 uKey만을 사용합니다.
실행에 앞서 thingplug 사이트에서  사용자와 계정에 디바이스 등록을 진행해야합니다.
*/
'use strict';
var colors = require('colors');
var async = require('async');

var config = require('./config');
var api = require('./lib/api');

async.waterfall([
  (cb) => {
    api.createAE(config, cb);
  },
  function (nodeRI, cb){
    config.nodeRI = nodeRI;
    api.getLatestContainer(config.nodeID, config.containerName, cb);
  },
  function(data, cb){
    console.log('content : ' + data.con);
    console.log('resouceId : ' + data.ri);
    console.log('createdAt : '+ data.ct);
    var cmd = JSON.stringify({'cmd':'on'});
    api.reqMgmtCmd(config.nodeRI, config.command, cmd, cb);
  }
], function(err,resourceID){
  if(err) return console.log(err);
  console.log('resourceID: '+resourceID);
});
