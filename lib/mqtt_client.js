const util = require('util');
const EventEmitter = require('events').EventEmitter;
const mqtt = require('mqtt');
const xml2js = require('xml2js').Parser({ explicitArray: false });
const builder = require('xmlbuilder');

const TY = {
  'container': 3
  , 'contentInstance': 4
  , 'execInstance': 7
  , 'mgmtCmd': 12
  , 'node': 14
  , 'remoteCSE': 16
  , 'AE': 2
};

const OP = {
  'CREATE': 1
  , 'READ': 2
  , 'UPDATE': 3
  , 'DELETE': 4
  , 'NOTIFY': 5
};

const statusCode = {
  'OK': '2000',
  'CREATED': '2001',
  'DELETED': '2002',
  'UPDATED': '2004',
  'CONTENT_EMPTY': '2100',
  'EXIST': '4105'
};

function getXMLRoot() {
  return builder.create(
    'm2m:rqp',
    { version: '1.0', encoding: 'UTF-8', standalone: true }
    , { pubID: null, sysID: null }
    , {
      headless: true,
      allowSurrogateChars: false
    });
}

function randomInt(low, high) {
  return Math.floor(Math.random() * (high - low + 1) + low);
}

var MQTTClient = function (config) {
  var options = {
    clientId: config.userID + '_' + config.nodeID
    , username: config.userID
    , password: config.uKey
    , clean: true
  }
  var nodeRI = config.nodeRI || '';
  var dKey = config.dKey || '';

  var self = this;
  var client = mqtt.connect('mqtts://mqtt.thingplug.net', options);
  client.on('connect', function () {
    var reqTopic = util.format("/oneM2M/req_msg/+/%s_%s", config.userID, config.nodeID);
    var respTopic = util.format("/oneM2M/resp/%s_%s/+", config.userID, config.nodeID);
    client.subscribe(reqTopic);
    client.subscribe(respTopic);
    self.emit('connect');
  });

  client.on('close', function () {
    self.emit('close');
  });

  client.on('error', function (error) {
    self.emit('error', error);
  });

  client.on('message', function (topic, message) {
    message = message.toString();
    if (topic.indexOf('/req_msg/') > 0) {
      xml2js.parseString(message, function (err, xmlObj) {
        if (err) {
          self.emit('error', err);
        }
        else {
          var recv_cmd = xmlObj['m2m:rqp'].pc.exin;
          self.emit('command', topic, recv_cmd);
        }
      });
    }
    else if (topic.indexOf('/resp/') > 0) {
      self.emit('resp', topic, message);
    }
    else {
      self.emit('message', topic, message);
    }
  });

  this.end = function () {
    client.end();
  }

  this.send = function (payload) {
    var topic = util.format('/oneM2M/req/%s_%s/%s', config.userID, config.nodeID, config.servID);
    console.log(topic);
    console.log(payload);
    client.publish(topic, payload, { qos: 1 }, function (err) {
      if (err) {
        console.log(err);
        self.emit('error', err);
      }
    });
  }

  this.createNode = function (cb) {
    var rqi = self._createRQI();
    var reqBody = {
      op: OP.CREATE
      , ty: TY.node
      , to: `/~/${config.servID}/${config.version}`
      , fr: config.nodeID
      , rqi: rqi
      , cty: 'application/vnd.onem2m-prsp+xml'
      , pc: {
        'm2m:nod': {
          rn: config.nodeID,
          ni: config.nodeID,
          mga: 'MQTT|' + config.nodeID
        }
      }
    }
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', function (topic, res) {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, function (err, xmlObj) {
          if (err) return self.emit('error', err);
          var resultCode = xmlObj['m2m:rsp']['rsc'][0];
          if ((resultCode === statusCode.CREATED) ||
            (resultCode === statusCode.EXIST)) {
            var rsm = xmlObj['m2m:rsp']['RSM'];
            if (rsm) console.log(rsm);
            self.nodeRI = xmlObj['m2m:rsp']['pc'][0]['nod'][0]['ri'][0];
            return cb(null, self.nodeRI);
          }
          else {
            return cb({ errCode: resultCode, errMessage: xmlObj['m2m:rsp']['RSM'] });
          }
        });
      }
    });
  }
  this.createRemoteCSE = function (cb) {
    var rqi = self._createRQI();
    var reqBody = {
      'op': OP.CREATE
      , 'ty': TY.remoteCSE
      , 'to': '/' + config.appEUI + '/' + config.version
      , 'fr': config.nodeID
      , 'rqi': rqi
      , 'passCode': config.passCode
      , 'cty': 'application/vnd.onem2m-prsp+xml'
      , 'nm': config.nodeID
      , 'pc': "<csr><cst>3</cst><csi>" + config.nodeID + "</csi><rr>true</rr><nl>" + self.nodeRI + "</nl></csr>"
    }
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', function (topic, res) {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, function (err, xmlObj) {
          if (err) return self.emit('error', err);
          var resultCode = xmlObj['m2m:rsp']['rsc'][0];
          if ((resultCode === statusCode.CREATED) ||
            (resultCode === statusCode.EXIST)) {
            var rsm = xmlObj['m2m:rsp']['RSM'];
            if (rsm) console.log(rsm);
            self.dKey = xmlObj['m2m:rsp']['dKey'][0];
            return cb(null, self.dKey);
          }
          else {
            return cb({ errCode: resultCode, errMessage: xmlObj['m2m:rsp']['RSM'] });
          }
        });
      }
    });
  }

  this.createAE = function (cb) {
    var rqi = self._createRQI();
    var reqBody = {
      op: OP.CREATE
      , ty: TY.AE
      , to: `/~/${config.servID}/${config.version}`
      , fr: 'S'
      , rqi: rqi
      , cty: 'application/vnd.onem2m-prsp+xml'
      , pc: {
        'm2m:ae': {
          '@rn': config.nodeID,
          api: config.uKey,
          rr: true,
          ni: config.nodeID,
          mga: `mqtt://${config.userID}_${config.nodeID}`,
          poa: `mqtt://oneM2M/req_msg/${config.servID}/${config.userID}_${config.nodeID}`
        }
      }
    }
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', (topic, res) => {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, (err, xmlObj) => {
          if (err) {
            self.emit('error', err);
          }
          else {
            console.log(topic);
            console.log(JSON.stringify(xmlObj, null, ' '));
            let rsp = xmlObj['m2m:rsp'];
            var resultCode = rsp.rsc;
            if ((resultCode === statusCode.CREATED) ||
              (resultCode === statusCode.EXIST)) {
              var rsm = rsp.RSM;
              if (rsm) console.log(rsm);
              self.dKey = rsp.pc['m2m:ae'].aei;
              self.nodeRI = rsp.pc['m2m:ae'].nl;
              cb(null, self.dKey);
            }
            else {
              cb({ errCode: resultCode, errMessage: rsp.RSM });
            }
          }
        });
      }
    });
  }
  this.createContainer = function (containerName, cb) {
    var rqi = self._createRQI();
    var reqBody = {
      op: OP.CREATE
      , ty: TY.container
      , to: `/~/${config.servID}/${config.version}/ae-${config.nodeID}`
      , fr: self.dKey
      , rqi: rqi
      , cty: 'application/vnd.onem2m-prsp+xml'
      , pc: {
        'm2m:cnt': {
          '@rn': containerName
        }
      }
    }
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', function (topic, res) {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, function (err, xmlObj) {
          if (err) {
            self.emit('error', err);
          }
          else {
            let rsp = xmlObj['m2m:rsp'];
            var resultCode = rsp.rsc;
            if ((resultCode === statusCode.CREATED) ||
              (resultCode === statusCode.EXIST)) {
              var rsm = rsp.RSM;
              if (rsm) console.log(rsm);
              cb(null, resultCode);
            }
            else {
              cb({ errCode: resultCode, errMessage: rsp.RSM });
            }
          }
        });
      }
    });
  }

  this.createMgmtCmd = function (command, cb) {
    var rqi = self._createRQI();
    var reqBody = {
      'op': OP.CREATE
      , 'ty': TY.mgmtCmd
      , to: `/~/${config.servID}/${config.version}`
      , 'fr': self.dKey
      , 'rqi': rqi
      , 'cty': 'application/vnd.onem2m-prsp+xml'
      , 'pc': {
        'm2m:mgc': {
          '@rn': `${config.nodeID}_${command.desc}`,
          cmt: command.cmt,
          exe: false,
          ext: self.nodeRI
        }
      }
    };
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', function (topic, res) {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, function (err, xmlObj) {
          if (err) {
            self.emit('error', err);
          }
          else {
            // console.log(topic);
            // console.log(JSON.stringify(xmlObj, null, ' '));
            let rsp = xmlObj['m2m:rsp'];
            var resultCode = rsp.rsc;
            if ((resultCode === statusCode.CREATED) ||
              (resultCode === statusCode.EXIST)) {
              var rsm = rsp.RSM;
              if (rsm) console.log(rsm);
              cb(null, resultCode);
            }
            else {
              cb({ errCode: resultCode, errMessage: rsp.RSM });
            }
          }
        });
      }
    });
  }

  this.createContentInstance = function (container, value, cb) {
    var rqi = self._createRQI();
    var reqBody = {
      op: OP.CREATE
      , ty: TY.contentInstance
      , to: `/~/${config.servID}/${config.version}/ae-${config.nodeID}/cnt-${container}`
      , fr: self.dKey
      , rqi: rqi
      , cty: 'application/vnd.onem2m-prsp+xml'
      , pc: {
        'm2m:cin': {
          cnf: 'text',
          con: value
        }
      }
    };
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', function (topic, res) {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, function (err, xmlObj) {
          if (err) {
            self.emit('error', err);
          }
          else {
            let rsp = xmlObj['m2m:rsp'];
            var resultCode = rsp.rsc;
            if (resultCode === statusCode.CREATED) {
              var rsm = rsp.RSM;
              if (rsm) console.log(rsm);
              var st = rsp.pc['m2m:cin'].st;
              cb(null, { 'st': st, 'rqi': rsp.rqi });
            }
            else {
              cb({ errCode: resultCode, errMessage: rsp.RSM });
            }
          }
        });
      }
    });
  }
  this.updateExecInstance = function (command, resourceID, cb) {
    var rqi = self._createRQI();
    var reqBody = {
      'op': OP.UPDATE
      , 'ty': TY.execInstance
      , 'to': util.format('/%s/%s/mgmtCmd-%s_%s/execInstance-%s'
        , config.appEUI, config.version, config.nodeID, command, resourceID)
      , 'fr': config.nodeID
      , 'rqi': rqi
      , 'cty': 'application/vnd.onem2m-prsp+xml'
      , 'dKey': self.dKey
      , 'pc': "<exin><exs>3</exs><exr>0</exr></exin>"
    };
    var payload = getXMLRoot().ele(reqBody).end();
    self.send(payload);
    self.once('resp', function (topic, res) {
      if (res.indexOf(rqi) > 0) {
        xml2js.parseString(res, function (err, xmlObj) {
          var resultCode = xmlObj['m2m:rsp']['rsc'][0];
          if (err) return self.emit('error', err);
          if ((resultCode === statusCode.UPDATED) ||
            (resultCode === statusCode.EXIST)) {
            var rsm = xmlObj['m2m:rsp']['RSM'];
            if (rsm) console.log(rsm);
            return cb(null, resultCode);
          }
          else {
            return cb({ errCode: resultCode, errMessage: xmlObj['m2m:rsp']['RSM'] });
          }
        });
      }
    });
  }

  this._createRQI = function () {
    return config.nodeID + '_' + new Date().getTime();
  }
}
util.inherits(MQTTClient, EventEmitter);

module.exports = MQTTClient;
