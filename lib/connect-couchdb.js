var Store = require('connect').session.Store,
    cradle = require('cradle'),
    db = null;

var ConnectCouchDB = function (opts) {
  opts = opts || {};
  Store.call(this, opts);

  this.reapInterval = opts.reapInterval || 600000;
  if (this.reapInterval !== -1) {
    setInterval(function(self){
      self.reap(self.maxAge);
    }, this.reapInterval, this);
  }
  
  ConnectCouchDB.setup.call(this, opts.database, opts);
};

ConnectCouchDB.setup = function (database, opts) {
  opts = opts || {};
  if (!database) {
    throw "You must define a database";
  }

  db = new(cradle.Connection)(opts).database(database);
  db.exists(function (err, exists) {
    if (err) throw err;
    if (!exists) {
      db.create();
      ConnectCouchDB.install();
    }
  });
  return ConnectCouchDB;
};

ConnectCouchDB.install = function () {
  if (db === null) {
    throw "You must call setup() function before install";
  }
  db.save('_design/connect-sessions', 
    {
      views : {
        all: {
          map: function (doc) {
            if (doc.type == 'connect-session') emit(null, doc);
          }
        },
        valid: {
          map: function (doc) {
            if (doc.type == 'connect-session' && doc.ttl < (+new Date - doc.ctime)) {
              emit(null, doc);
            }
          }
        }
      }
    }
  );
};

require('util').inherits(ConnectCouchDB, Store);

ConnectCouchDB.prototype.get = function(sid, fn){
  var sid = sid.replace(/\//gi,'');
  
  db.get(sid, function (err, doc) {
    if (err) {
      if (err.error == "not_found") {
        err.code = "ENOENT";
      }
      
      return fn && fn(err);
    }
    
    if (doc) {
      if (doc.ttl > (+new Date - doc.ctime)) {
        //remove references to stringified functions...
        //this is a hack to work around when cradle syncs the cached copy of the doc
        //back to the couchdb server. if we retun the string value of the function from couchdb
        //it will override the actual function on the session object after we use the utils.merge method.
        for (var key in doc.datas) {
          if (typeof(doc.datas[key]) == "string" && doc.datas[key].substr(0,8) == 'function') {
            delete doc.datas[key];
          }
        }
        
        fn(null, doc.datas);
      }
      else {
        db.remove(sid, doc._rev);
        fn(null, null);
      }
    }
    else {
      fn(null, null);
    }
  });
};

ConnectCouchDB.prototype.set = function(sid, sess, fn) {
  var sid = sid.replace(/\//gi,'');
  
  fn = fn || function () {};
  var self = this;
  this.get(sid, function (err, doc) {
    
    if (!doc) {
      doc = {
        ctime: +new Date,
        ttl: self.reapInterval,
        datas: sess,
        type : "connect-session"
      };
      
      db.save(sid, doc, function () {
        fn.apply(fn, arguments);
      });
    }
    else {
      db.merge(sid, {datas: sess}, fn);
    }
  });
};

ConnectCouchDB.prototype.destroy = function(sid, fn){
  var sid = sid.replace(/\//gi,'');
  db.remove(sid, fn);
};

ConnectCouchDB.prototype.clear = function(fn){
  var self = this;
  db.view('sessions/all', function (err, docs) {
    if (err) return fn && fn(err);
    docs.forEach(function (doc) {
      self.remove(doc._id);
    });
    fn();
  });
};

ConnectCouchDB.prototype.reap = function(ms){
  var threshold = +new Date - ms;
  var self = this;

  db.view('connect-sessions/all', function (err, docs) {
    if (err) return fn && fn(err);
    docs.forEach(function (doc) {
      if (doc.ctime < threshold) {
        self.remove(doc._id);
      }
    });
  });
};

ConnectCouchDB.prototype.length = function(fn){
  db.view('sessions/valid', function (err, docs) {
    fn && fn(err, docs.length);
  });
};


module.exports = ConnectCouchDB;