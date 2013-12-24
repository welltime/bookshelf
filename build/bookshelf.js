!function(e){"object"==typeof exports?module.exports=e():"function"==typeof define&&define.amd?define(["bluebird", "lodash", "knex", "backbone"], e):"undefined"!=typeof window?window.bookshelf=e():"undefined"!=typeof global?global.bookshelf=e():"undefined"!=typeof self&&(self.bookshelf=e())}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// Bookshelf.js 0.6.2
// ---------------

//     (c) 2013 Tim Griesser
//     Bookshelf may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://bookshelfjs.org

// All external libraries needed in this scope.
var _          = require('lodash');
var Knex       = require('knex');

// All local dependencies... These are the main objects that
// need to be augmented in the constructor to work properly.
var SqlModel      = require('./dialects/sql/model').Model;
var SqlCollection = require('./dialects/sql/collection').Collection;
var SqlRelation   = require('./dialects/sql/relation').Relation;

// Finally, the `Events`, which we've supplemented with a `triggerThen`
// method to allow for asynchronous event handling via promises. We also
// mix this into the prototypes of the main objects in the library.
var Events        = require('./dialects/base/events').Events;

// Constructor for a new `Bookshelf` object, it accepts
// an active `knex` instance and initializes the appropriate
// `Model` and `Collection` constructors for use in the current instance.
var Bookshelf = function(knex) {

  // Allows you to construct the library with either `Bookshelf(opts)`
  // or `new Bookshelf(opts)`.
  if (!(this instanceof Bookshelf)) {
    return new Bookshelf(knex);
  }

  // If the knex isn't a `Knex` instance, we'll assume it's
  // a compatible config object and pass it through to create a new instance.
  if (!knex.client || !(knex.client instanceof Knex.ClientBase)) {
    knex = new Knex(knex);
  }

  // The `Model` constructor is referenced as a property on the `Bookshelf` instance,
  // mixing in the correct `builder` method, as well as the `relation` method,
  // passing in the correct `Model` & `Collection` constructors for later reference.
  var ModelCtor = this.Model = SqlModel.extend({
    _builder: function(tableName) {
      return knex(tableName);
    },
    _relation: function(type, Target, options) {
      return new Relation(type, Target, options);
    }
  });

  // The collection also references the correct `Model`, specified above, for creating
  // new `Model` instances in the collection. We also extend with the correct builder /
  // `knex` combo.
  var CollectionCtor = this.Collection = SqlCollection.extend({
    model: ModelCtor,
    _builder: function(tableName) {
      return knex(tableName);
    }
  });

  // Used internally, the `Relation` helps in simplifying the relationship building,
  // centralizing all logic dealing with type & option handling.
  var Relation = Bookshelf.Relation = SqlRelation.extend({
    Model: ModelCtor,
    Collection: CollectionCtor
  });

  // Grab a reference to the `knex` instance passed (or created) in this constructor,
  // for convenience.
  this.knex = knex;
};

// A `Bookshelf` instance may be used as a top-level pub-sub bus, as it mixes in the
// `Events` object. It also contains the version number, and a `Transaction` method
// referencing the correct version of `knex` passed into the object.
_.extend(Bookshelf.prototype, Events, {

  // Keep in sync with `package.json`.
  VERSION: '0.6.2',

  // Helper method to wrap a series of Bookshelf actions in a `knex` transaction block;
  transaction: function() {
    return this.knex.transaction.apply(this, arguments);
  },

  // Provides a nice, tested, standardized way of adding plugins to a `Bookshelf` instance,
  // injecting the current instance into the plugin, which should be a module.exports.
  plugin: function(plugin) {
    plugin(this);
    return this;
  }

});

// Alias to `new Bookshelf(opts)`.
Bookshelf.initialize = function(knex) {
  return new this(knex);
};

// The `forge` function properly instantiates a new Model or Collection
// without needing the `new` operator... to make object creation cleaner
// and more chainable.
SqlModel.forge = SqlCollection.forge = function() {
  var inst = Object.create(this.prototype);
  var obj = this.apply(inst, arguments);
  return (Object(obj) === obj ? obj : inst);
};

// Finally, export `Bookshelf` to the world.
module.exports = Bookshelf;

},{"./dialects/base/events":4,"./dialects/sql/collection":8,"./dialects/sql/model":11,"./dialects/sql/relation":12,"knex":false,"lodash":false}],2:[function(require,module,exports){
// Base Collection
// ---------------

// All exernal dependencies required in this scope.
var _         = require('lodash');
var Backbone  = require('backbone');

// All components that need to be referenced in this scope.
var Events    = require('./events').Events;
var Promise   = require('./promise').Promise;
var ModelBase = require('./model').ModelBase;

var array  = [];
var push   = array.push;
var splice = array.splice;

var CollectionBase = function(models, options) {
  if (options) _.extend(this, _.pick(options, collectionProps));
  this._reset();
  this.initialize.apply(this, arguments);
  if (models) this.reset(models, _.extend({silent: true}, options));
};

// List of attributes attached directly from the constructor's options object.
var collectionProps   = ['model', 'comparator'];

// A list of properties that are omitted from the `Backbone.Model.prototype`, to create
// a generic collection base.
var collectionOmitted = ['model', 'fetch', 'url', 'sync', 'create'];

// Copied over from Backbone.
var setOptions = {add: true, remove: true, merge: true};

_.extend(CollectionBase.prototype, _.omit(Backbone.Collection.prototype, collectionOmitted), Events, {

  // The `tableName` on the associated Model, used in relation building.
  tableName: function() {
    return _.result(this.model.prototype, 'tableName');
  },

  // The `idAttribute` on the associated Model, used in relation building.
  idAttribute: function() {
    return this.model.prototype.idAttribute;
  },

  // A simplified version of Backbone's `Collection#set` method,
  // removing the comparator, and getting rid of the temporary model creation,
  // since there's *no way* we'll be getting the data in an inconsistent
  // form from the database.
  set: function(models, options) {
    options = _.defaults({}, options, setOptions);
    if (options.parse) models = this.parse(models, options);
    if (!_.isArray(models)) models = models ? [models] : [];
    var i, l, id, model, attrs, existing;
    var at = options.at;
    var targetModel = this.model;
    var toAdd = [], toRemove = [], modelMap = {};
    var add = options.add, merge = options.merge, remove = options.remove;
    var order = add && remove ? [] : false;

    // Turn bare objects into model references, and prevent invalid models
    // from being added.
    for (i = 0, l = models.length; i < l; i++) {
      attrs = models[i];
      if (attrs instanceof ModelBase) {
        id = model = attrs;
      } else {
        id = attrs[targetModel.prototype.idAttribute];
      }

      // If a duplicate is found, prevent it from being added and
      // optionally merge it into the existing model.
      if (existing = this.get(id)) {
        if (remove) {
          modelMap[existing.cid] = true;
          continue;
        }
        if (merge) {
          attrs = attrs === model ? model.attributes : attrs;
          if (options.parse) attrs = existing.parse(attrs, options);
          existing.set(attrs, options);
        }

        // This is a new model, push it to the `toAdd` list.
      } else if (add) {
        if (!(model = this._prepareModel(attrs, options))) continue;
        toAdd.push(model);

        // Listen to added models' events, and index models for lookup by
        // `id` and by `cid`.
        model.on('all', this._onModelEvent, this);
        this._byId[model.cid] = model;
        if (model.id != null) this._byId[model.id] = model;
      }
      if (order) order.push(existing || model);
    }

    // Remove nonexistent models if appropriate.
    if (remove) {
      for (i = 0, l = this.length; i < l; ++i) {
        if (!modelMap[(model = this.models[i]).cid]) toRemove.push(model);
      }
      if (toRemove.length) this.remove(toRemove, options);
    }

    // See if sorting is needed, update `length` and splice in new models.
    if (toAdd.length || (order && order.length)) {
      this.length += toAdd.length;
      if (at != null) {
        splice.apply(this.models, [at, 0].concat(toAdd));
      } else {
        if (order) this.models.length = 0;
        push.apply(this.models, order || toAdd);
      }
    }

    if (options.silent) return this;

    // Trigger `add` events.
    for (i = 0, l = toAdd.length; i < l; i++) {
      (model = toAdd[i]).trigger('add', model, this, options);
    }
    return this;
  },

  // Prepare a model or hash of attributes to be added to this collection.
  _prepareModel: function(attrs, options) {
    if (attrs instanceof ModelBase) return attrs;
    return new this.model(attrs, options);
  },

  // Convenience method for map, returning a `Promise.all` promise.
  mapThen: function(iterator, context) {
    return Promise.all(this.map(iterator, context));
  },

  // Convenience method for invoke, returning a `Promise.all` promise.
  invokeThen: function() {
    return Promise.all(this.invoke.apply(this, arguments));
  },

  fetch: function() {
    return Promise.rejected('The fetch method has not been implemented');
  }

});

// List of attributes attached directly from the `options` passed to the constructor.
var modelProps = ['tableName', 'hasTimestamps'];

CollectionBase.extend = Backbone.Collection.extend;

// Helper to mixin one or more additional items to the current prototype.
CollectionBase.include = function() {
  _.extend.apply(_, [this.prototype].concat(_.toArray(arguments)));
  return this;
};

exports.CollectionBase = CollectionBase;
},{"./events":4,"./model":5,"./promise":6,"backbone":false,"lodash":false}],3:[function(require,module,exports){
// Eager Base
// ---------------

// The EagerBase provides a scaffold for handling with eager relation
// pairing, by queueing the appropriate related method calls with
// a database specific `eagerFetch` method, which then may utilize
// `pushModels` for pairing the models depending on the database need.

var _         = require('lodash');
var Backbone  = require('backbone');
var Promise   = require('./promise').Promise;

var EagerBase = function(parent, parentResponse, target) {
  this.parent = parent;
  this.parentResponse = parentResponse;
  this.target = target;
};

EagerBase.prototype = {

  // This helper function is used internally to determine which relations
  // are necessary for fetching based on the `model.load` or `withRelated` option.
  fetch: Promise.method(function(options) {
    var relationName, related, relation;
    var target      = this.target;
    var handled     = this.handled = {};
    var withRelated = this.prepWithRelated(options.withRelated);
    var subRelated  = {};

    // Internal flag to determine whether to set the ctor(s) on the `Relation` object.
    target._isEager = true;

    // Eager load each of the `withRelated` relation item, splitting on '.'
    // which indicates a nested eager load.
    for (var key in withRelated) {

      related = key.split('.');
      relationName = related[0];

      // Add additional eager items to an array, to load at the next level in the query.
      if (related.length > 1) {
        var relatedObj = {};
        subRelated[relationName] || (subRelated[relationName] = []);
        relatedObj[related.slice(1).join('.')] = withRelated[key];
        subRelated[relationName].push(relatedObj);
      }

      // Only allow one of a certain nested type per-level.
      if (handled[relationName]) continue;

      relation = target[relationName]();

      if (!relation) throw new Error(relationName + ' is not defined on the model.');

      handled[relationName] = relation;
    }

    // Delete the internal flag from the model.
    delete target._isEager;

    // Fetch all eager loaded models, loading them onto
    // an array of pending deferred objects, which will handle
    // all necessary pairing with parent objects, etc.
    var pendingDeferred = [];
    for (relationName in handled) {
      pendingDeferred.push(this.eagerFetch(relationName, handled[relationName], _.extend({}, options, {
        isEager: true,
        withRelated: subRelated[relationName],
        beforeFn: withRelated[relationName] || noop
      })));
    }

    // Return a deferred handler for all of the nested object sync
    // returning the original response when these syncs & pairings are complete.
    return Promise.all(pendingDeferred).yield(this.parentResponse);
  }),

  // Prep the `withRelated` object, to normalize into an object where each
  // has a function that is called when running the query.
  prepWithRelated: function(withRelated) {
    if (!_.isArray(withRelated)) withRelated = [withRelated];
    var obj = {};
    for (var i = 0, l = withRelated.length; i < l; i++) {
      var related = withRelated[i];
      _.isString(related) ? obj[related] = noop : _.extend(obj, related);
    }
    return obj;
  },

  // Pushes each of the incoming models onto a new `related` array,
  // which is used to correcly pair additional nested relations.
  pushModels: function(relationName, handled, resp) {
    var models      = this.parent;
    var relatedData = handled.relatedData;
    var related     = [];
    for (var i = 0, l = resp.length; i < l; i++) {
      related.push(relatedData.createModel(resp[i]));
    }
    return relatedData.eagerPair(relationName, related, models);
  }

};

var noop = function() {};

EagerBase.extend = Backbone.Model.extend;

exports.EagerBase = EagerBase;

},{"./promise":6,"backbone":false,"lodash":false}],4:[function(require,module,exports){
// Events
// ---------------

var Promise     = require('./promise').Promise;
var Backbone    = require('backbone');
var triggerThen = require('trigger-then');

// Mixin the `triggerThen` function into all relevant Backbone objects,
// so we can have event driven async validations, functions, etc.
triggerThen(Backbone, Promise);

exports.Events = Backbone.Events;
},{"./promise":6,"backbone":false,"trigger-then":15}],5:[function(require,module,exports){
// Base Model
// ---------------
var _        = require('lodash');
var Backbone = require('backbone');

var Events   = require('./events').Events;
var Promise  = require('./promise').Promise;

// A list of properties that are omitted from the `Backbone.Model.prototype`, to create
// a generic model base.
var modelOmitted = [
  'changedAttributes', 'isValid', 'validationError',
  'save', 'sync', 'fetch', 'destroy', 'url',
  'urlRoot', '_validate'
];

// The "ModelBase" is similar to the 'Active Model' in Rails,
// it defines a standard interface from which other objects may
// inherit.
var ModelBase = function(attributes, options) {
  var attrs = attributes || {};
  options || (options = {});
  this.attributes = Object.create(null);
  this._reset();
  this.relations = {};
  this.cid  = _.uniqueId('c');
  if (options) {
    _.extend(this, _.pick(options, modelProps));
    if (options.parse) attrs = this.parse(attrs, options) || {};
  }
  this.set(attrs, options);
  this.initialize.apply(this, arguments);
};

_.extend(ModelBase.prototype, _.omit(Backbone.Model.prototype), Events, {

  // Similar to the standard `Backbone` set method, but without individual
  // change events, and adding different meaning to `changed` and `previousAttributes`
  // defined as the last "sync"'ed state of the model.
  set: function(key, val, options) {
    if (key == null) return this;
    var attrs;

    // Handle both `"key", value` and `{key: value}` -style arguments.
    if (typeof key === 'object') {
      attrs = key;
      options = val;
    } else {
      (attrs = {})[key] = val;
    }
    options || (options = {});

    // Extract attributes and options.
    var hasChanged = false;
    var unset   = options.unset;
    var current = this.attributes;
    var prev    = this._previousAttributes;

    // Check for changes of `id`.
    if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

    // For each `set` attribute, update or delete the current value.
    for (var attr in attrs) {
      val = attrs[attr];
      if (!_.isEqual(prev[attr], val)) {
        this.changed[attr] = val;
        if (!_.isEqual(current[attr], val)) hasChanged = true;
      } else {
        delete this.changed[attr];
      }
      unset ? delete current[attr] : current[attr] = val;
    }

    if (hasChanged && !options.silent) this.trigger('change', this, options);
    return this;
  },

  // Returns an object containing a shallow copy of the model attributes,
  // along with the `toJSON` value of any relations,
  // unless `{shallow: true}` is passed in the `options`.
  toJSON: function(options) {
    var attrs = _.extend({}, this.attributes);
    if (options && options.shallow) return attrs;
    var relations = this.relations;
    for (var key in relations) {
      var relation = relations[key];
      attrs[key] = relation.toJSON ? relation.toJSON() : relation;
    }
    if (this.pivot) {
      var pivot = this.pivot.attributes;
      for (key in pivot) {
        attrs['_pivot_' + key] = pivot[key];
      }
    }
    return attrs;
  },

  // **parse** converts a response into the hash of attributes to be `set` on
  // the model. The default implementation is just to pass the response along.
  parse: function(resp, options) {
    return resp;
  },

  // **format** converts a model into the values that should be saved into
  // the database table. The default implementation is just to pass the data along.
  format: function(attrs, options) {
    return attrs;
  },

  // Returns the related item, or creates a new
  // related item by creating a new model or collection.
  related: function(name) {
    return this.relations[name] || (this[name] ? this.relations[name] = this[name]() : void 0);
  },

  // Create a new model with identical attributes to this one,
  // including any relations on the current model.
  clone: function() {
    var model = new this.constructor(this.attributes);
    var relations = this.relations;
    for (var key in relations) {
      model.relations[key] = relations[key].clone();
    }
    model._previousAttributes = _.clone(this._previousAttributes);
    model.changed = _.clone(this.changed);
    return model;
  },

  // Sets the timestamps before saving the model.
  timestamp: function(options) {
    var d = new Date();
    var keys = (_.isArray(this.hasTimestamps) ? this.hasTimestamps : ['created_at', 'updated_at']);
    var vals = {};
    vals[keys[1]] = d;
    if (this.isNew(options) && (!options || options.method !== 'update')) vals[keys[0]] = d;
    return vals;
  },

  // Called after a `sync` action (save, fetch, delete) -
  // resets the `_previousAttributes` and `changed` hash for the model.
  _reset: function() {
    this._previousAttributes = _.extend(Object.create(null), this.attributes);
    this.changed = Object.create(null);
    return this;
  },

  fetch: function() {},

  save: function() {},

  // Destroy a model, calling a "delete" based on its `idAttribute`.
  // A "destroying" and "destroyed" are triggered on the model before
  // and after the model is destroyed, respectively. If an error is thrown
  // during the "destroying" event, the model will not be destroyed.
  destroy: Promise.method(function(options) {
    options = options ? _.clone(options) : {};
    return Promise.bind(this).then(function() {
      return this.triggerThen('destroying', this, options);
    }).then(function() {
      return this.sync(options).del();
    }).then(function(resp) {
      this.clear();
      return this.triggerThen('destroyed', this, resp, options);
    }).then(this._reset);
  })

});

// List of attributes attached directly from the `options` passed to the constructor.
var modelProps = ['tableName', 'hasTimestamps'];

ModelBase.extend  = Backbone.Model.extend;

// Helper to mixin one or more additional items to the current prototype.
ModelBase.include = function() {
  _.extend.apply(_, [this.prototype].concat(_.toArray(arguments)));
  return this;
};

exports.ModelBase = ModelBase;

},{"./events":4,"./promise":6,"backbone":false,"lodash":false}],6:[function(require,module,exports){

var Promise = require('bluebird');

Promise.prototype.yield = function(value) {
  return this.then(function() {
    return value;
  });
};

Promise.prototype.tap = function(handler) {
  return this.then(handler).yield(this);
};

Promise.prototype.ensure = Promise.prototype.lastly;
Promise.prototype.otherwise = Promise.prototype.caught;
Promise.prototype.exec = Promise.prototype.nodeify;

Promise.resolve = Promise.fulfilled;
Promise.reject  = Promise.rejected;

exports.Promise = Promise;
},{"bluebird":false}],7:[function(require,module,exports){
// Base Relation
// ---------------

var _        = require('lodash');
var Backbone = require('backbone');

var CollectionBase = require('./collection').CollectionBase;

// Used internally, the `Relation` helps in simplifying the relationship building,
// centralizing all logic dealing with type & option handling.
var RelationBase = function(type, Target, options) {
  this.type = type;
  if (this.target = Target) {
    this.targetTableName = _.result(Target.prototype, 'tableName');
    this.targetIdAttribute = _.result(Target.prototype, 'idAttribute');
  }
  _.extend(this, options);
};

RelationBase.prototype = {

  // Creates a new relation instance, used by the `Eager` relation in
  // dealing with `morphTo` cases, where the same relation is targeting multiple models.
  instance: function(type, Target, options) {
    return new this.constructor(type, Target, options);
  },

  // Creates a new, unparsed model, used internally in the eager fetch helper
  // methods. (Parsing may mutate information necessary for eager pairing.)
  createModel: function(data) {
    if (this.target.prototype instanceof CollectionBase) {
      return new this.target.prototype.model(data)._reset();
    }
    return new this.target(data)._reset();
  },

  // Eager pair the models.
  eagerPair: function() {}

};

RelationBase.extend = Backbone.Model.extend;

exports.RelationBase = RelationBase;

},{"./collection":2,"backbone":false,"lodash":false}],8:[function(require,module,exports){
// Collection
// ---------------
var _             = require('lodash');

var Sync          = require('./sync').Sync;
var Helpers       = require('./helpers').Helpers;
var EagerRelation = require('./eager').EagerRelation;

var CollectionBase = require('../base/collection').CollectionBase;
var Promise        = require('../base/promise').Promise;

exports.Collection = CollectionBase.extend({

  // Used to define passthrough relationships - `hasOne`, `hasMany`,
  // `belongsTo` or `belongsToMany`, "through" a `Interim` model or collection.
  through: function(Interim, foreignKey, otherKey) {
    return this.relatedData.through(this, Interim, {throughForeignKey: foreignKey, otherKey: otherKey});
  },

  // Fetch the models for this collection, resetting the models
  // for the query when they arrive.
  fetch: Promise.method(function(options) {
    options = options ? _.clone(options) : {};
    var sync = this.sync(options)
      .select()
      .bind(this)
      .tap(function(response) {
        if (!response || response.length === 0) {
          if (options.require) throw new Error('EmptyResponse');
          return Promise.reject(null);
        }
      })

      // Now, load all of the data onto the collection as necessary.
      .tap(handleResponse);

    // If the "withRelated" is specified, we also need to eager load all of the
    // data on the collection, as a side-effect, before we ultimately jump into the
    // next step of the collection. Since the `columns` are only relevant to the current
    // level, ensure those are omitted from the options.
    if (options.withRelated) {
      sync = sync.tap(handleEager(_.omit(options, 'columns')));
    }

    return sync.tap(function(response) {
      return this.triggerThen('fetched', this, response, options);
    })
    .caught(function(err) {
      if (err !== null) throw err;
      this.reset([], {silent: true});
    })
    .yield(this);
  }),

  // Fetches a single model from the collection, useful on related collections.
  fetchOne: Promise.method(function(options) {
    var model = new this.model;
    model._knex = this.query().clone();
    if (this.relatedData) model.relatedData = this.relatedData;
    return model.fetch(options);
  }),

  // Eager loads relationships onto an already populated `Collection` instance.
  load: Promise.method(function(relations, options) {
    _.isArray(relations) || (relations = [relations]);
    options = _.extend({}, options, {shallow: true, withRelated: relations});
    return new EagerRelation(this.models, this.toJSON(options), new this.model())
      .fetch(options)
      .yield(this);
  }),

  // Shortcut for creating a new model, saving, and adding to the collection.
  // Returns a promise which will resolve with the model added to the collection.
  // If the model is a relation, put the `foreignKey` and `fkValue` from the `relatedData`
  // hash into the inserted model. Also, if the model is a `manyToMany` relation,
  // automatically create the joining model upon insertion.
  create: Promise.method(function(model, options) {
    options = options ? _.clone(options) : {};
    var relatedData = this.relatedData;
    model = this._prepareModel(model, options);

    // If we've already added things on the query chain,
    // these are likely intended for the model.
    if (this._knex) {
      model._knex = this._knex;
      this.resetQuery();
    }

    return Helpers
      .saveConstraints(model, relatedData)
      .save(null, options)
      .bind(this)
      .then(function() {
        if (relatedData && (relatedData.type === 'belongsToMany' || relatedData.isThrough())) {
          return this.attach(model, options);
        }
      })
      .then(function() {
        this.add(model, options);
        return model;
      });
  }),

  // Reset the query builder, called internally
  // each time a query is run.
  resetQuery: function() {
    this._knex = null;
    return this;
  },

  // Returns an instance of the query builder.
  query: function() {
    return Helpers.query(this, _.toArray(arguments));
  },

  // Creates and returns a new `Bookshelf.Sync` instance.
  sync: function(options) {
    return new Sync(this, options);
  }

});

// Handles the response data for the collection, returning from the collection's fetch call.
function handleResponse(response) {
  var relatedData = this.relatedData;
  this.set(response, {silent: true, parse: true}).invoke('_reset');
  if (relatedData && relatedData.isJoined()) {
    relatedData.parsePivot(this.models);
  }
}

// Handle the related data loading on the collection.
function handleEager(options) {
  return function(response) {
    return new EagerRelation(this.models, response, new this.model()).fetch(options);
  };
}
},{"../base/collection":2,"../base/promise":6,"./eager":9,"./helpers":10,"./sync":13,"lodash":false}],9:[function(require,module,exports){
// EagerRelation
// ---------------
var _         = require('lodash');

var Helpers   = require('./helpers').Helpers;
var EagerBase = require('../base/eager').EagerBase;
var Promise   = require('../base/promise').Promise;

// An `EagerRelation` object temporarily stores the models from an eager load,
// and handles matching eager loaded objects with their parent(s). The `tempModel`
// is only used to retrieve the value of the relation method, to know the constrains
// for the eager query.
var EagerRelation = exports.EagerRelation = EagerBase.extend({

  // Handles an eager loaded fetch, passing the name of the item we're fetching for,
  // and any options needed for the current fetch.
  eagerFetch: Promise.method(function(relationName, handled, options) {
    var relatedData = handled.relatedData;

    if (relatedData.type === 'morphTo') return this.morphToFetch(relationName, relatedData, options);

    // Call the function, if one exists, to constrain the eager loaded query.
    options.beforeFn.call(handled, handled.query());

    return handled
      .sync(_.extend({}, options, {parentResponse: this.parentResponse}))
      .select()
      .tap(eagerLoadHelper(this, relationName, handled, options));
  }),

  // Special handler for the eager loaded morph-to relations, this handles
  // the fact that there are several potential models that we need to be fetching against.
  // pairing them up onto a single response for the eager loading.
  morphToFetch: Promise.method(function(relationName, relatedData, options) {
    var pending = [];
    var groups = _.groupBy(this.parent, function(m) {
      return m.get(relatedData.morphName + '_type');
    });
    for (var group in groups) {
      var Target = Helpers.morphCandidate(relatedData.candidates, group);
      var target = new Target();
      pending.push(target
        .query('whereIn',
          _.result(target, 'idAttribute'),
          _.uniq(_.invoke(groups[group], 'get', relatedData.morphName + '_id'))
        )
        .sync(options)
        .select()
        .tap(eagerLoadHelper(this, relationName, {
          relatedData: relatedData.instance('morphTo', Target, {morphName: relatedData.morphName})
        }, options)));
    }
    return Promise.all(pending).then(function(resps) {
      return _.flatten(resps);
    });
  })

});

// Handles the eager load for both the `morphTo` and regular cases.
function eagerLoadHelper(relation, relationName, handled, options) {
  return function(resp) {
    var relatedModels = relation.pushModels(relationName, handled, resp);
    var relatedData   = handled.relatedData;

    // If there is a response, fetch additional nested eager relations, if any.
    if (resp.length > 0 && options.withRelated) {
      var relatedModel = relatedData.createModel();

      // If this is a `morphTo` relation, we need to do additional processing
      // to ensure we don't try to load any relations that don't look to exist.
      if (relatedData.type === 'morphTo') {
        var withRelated = filterRelated(relatedModel, options);
        if (withRelated.length === 0) return;
        options = _.extend({}, options, {withRelated: withRelated});
      }
      return new EagerRelation(relatedModels, resp, relatedModel).fetch(options).yield(resp);
    }
  };
}

// Filters the `withRelated` on a `morphTo` relation, to ensure that only valid
// relations are attempted for loading.
function filterRelated(relatedModel, options) {

  // By this point, all withRelated should be turned into a hash, so it should
  // be fairly simple to process by splitting on the dots.
  return _.reduce(options.withRelated, function(memo, val) {
    for (var key in val) {
      var seg = key.split('.')[0];
      if (_.isFunction(relatedModel[seg])) memo.push(val);
    }
    return memo;
  }, []);
}

},{"../base/eager":3,"../base/promise":6,"./helpers":10,"lodash":false}],10:[function(require,module,exports){
// Helpers
// ---------------

var _ = require('lodash');

exports.Helpers = {

  // Sets the constraints necessary during a `model.save` call.
  saveConstraints: function(model, relatedData) {
    var data = {};
    if (relatedData && relatedData.type && relatedData.type !== 'belongsToMany') {
      data[relatedData.key('foreignKey')] = relatedData.parentFk;
      if (relatedData.isMorph()) data[relatedData.key('morphKey')] = relatedData.key('morphValue');
    }
    return model.set(data);
  },

  // Finds the specific `morphTo` table we should be working with, or throws
  // an error if none is matched.
  morphCandidate: function(candidates, foreignTable) {
    var Target = _.find(candidates, function(Candidate) {
      return (_.result(Candidate.prototype, 'tableName') === foreignTable);
    });
    if (!Target) {
      throw new Error('The target polymorphic model was not found');
    }
    return Target;
  },

  // If there are no arguments, return the current object's
  // query builder (or create and return a new one). If there are arguments,
  // call the query builder with the first argument, applying the rest.
  // If the first argument is an object, assume the keys are query builder
  // methods, and the values are the arguments for the query.
  query: function(obj, args) {
    obj._knex = obj._knex || obj._builder(_.result(obj, 'tableName'));
    if (args.length === 0) return obj._knex;
    var method = args[0];
    if (_.isFunction(method)) {
      method.call(obj._knex, obj._knex);
    } else if (_.isObject(method)) {
      for (var key in method) {
        var target = _.isArray(method[key]) ?  method[key] : [method[key]];
        obj._knex[key].apply(obj._knex, target);
      }
    } else {
      obj._knex[method].apply(obj._knex, args.slice(1));
    }
    return obj;
  }

};

},{"lodash":false}],11:[function(require,module,exports){
// Model
// ---------------
var _             = require('lodash');

var Sync          = require('./sync').Sync;
var Helpers       = require('./helpers').Helpers;
var EagerRelation = require('./eager').EagerRelation;

var ModelBase = require('../base/model').ModelBase;
var Promise   = require('../base/promise').Promise;

exports.Model = ModelBase.extend({

  // The `hasOne` relation specifies that this table has exactly one of another type of object,
  // specified by a foreign key in the other table. The foreign key is assumed to be the singular of this
  // object's `tableName` with an `_id` suffix, but a custom `foreignKey` attribute may also be specified.
  hasOne: function(Target, foreignKey) {
    return this._relation('hasOne', Target, {foreignKey: foreignKey}).init(this);
  },

  // The `hasMany` relation specifies that this object has one or more rows in another table which
  // match on this object's primary key. The foreign key is assumed to be the singular of this object's
  // `tableName` with an `_id` suffix, but a custom `foreignKey` attribute may also be specified.
  hasMany: function(Target, foreignKey) {
    return this._relation('hasMany', Target, {foreignKey: foreignKey}).init(this);
  },

  // A reverse `hasOne` relation, the `belongsTo`, where the specified key in this table
  // matches the primary `idAttribute` of another table.
  belongsTo: function(Target, foreignKey) {
    return this._relation('belongsTo', Target, {foreignKey: foreignKey}).init(this);
  },

  // A `belongsToMany` relation is when there are many-to-many relation
  // between two models, with a joining table.
  belongsToMany: function(Target, joinTableName, foreignKey, otherKey) {
    return this._relation('belongsToMany', Target, {
      joinTableName: joinTableName, foreignKey: foreignKey, otherKey: otherKey
    }).init(this);
  },

  // A `morphOne` relation is a one-to-one polymorphic association from this model
  // to another model.
  morphOne: function(Target, name, morphValue) {
    return this._morphOneOrMany(Target, name, morphValue, 'morphOne');
  },

  // A `morphMany` relation is a polymorphic many-to-one relation from this model
  // to many another models.
  morphMany: function(Target, name, morphValue) {
    return this._morphOneOrMany(Target, name, morphValue, 'morphMany');
  },

  // Defines the opposite end of a `morphOne` or `morphMany` relationship, where
  // the alternate end of the polymorphic model is defined.
  morphTo: function(morphName) {
    if (!_.isString(morphName)) throw new Error('The `morphTo` name must be specified.');
    return this._relation('morphTo', null, {morphName: morphName, candidates: _.rest(arguments)}).init(this);
  },

  // Used to define passthrough relationships - `hasOne`, `hasMany`,
  // `belongsTo` or `belongsToMany`, "through" a `Interim` model or collection.
  through: function(Interim, foreignKey, otherKey) {
    return this.relatedData.through(this, Interim, {throughForeignKey: foreignKey, otherKey: otherKey});
  },

  // Fetch a model based on the currently set attributes,
  // returning a model to the callback, along with any options.
  // Returns a deferred promise through the `Bookshelf.Sync`.
  // If `{require: true}` is set as an option, the fetch is considered
  // a failure if the model comes up blank.
  fetch: Promise.method(function(options) {
    options = options ? _.clone(options) : {};

    // Run the `first` call on the `sync` object to fetch a single model.
    var sync = this.sync(options)
      .first()
      .bind(this)

      // Jump the rest of the chain if the response doesn't exist...
      .tap(function(response) {
        if (!response || response.length === 0) {
          if (options.require) throw new Error('EmptyResponse');
          return Promise.reject(null);
        }
      })

      // Now, load all of the data into the model as necessary.
      .tap(handleResponse);

    // If the "withRelated" is specified, we also need to eager load all of the
    // data on the model, as a side-effect, before we ultimately jump into the
    // next step of the model. Since the `columns` are only relevant to the current
    // level, ensure those are omitted from the options.
    if (options.withRelated) {
      sync = sync.tap(handleEager(_.omit(options, 'columns')));
    }

    return sync.tap(function(response) {
      return this.triggerThen('fetched', this, response, options);
    })
    .yield(this)
    .caught(function(err) {
      if (err === null) return err;
      throw err;
    });

  }),

  // Eager loads relationships onto an already populated `Model` instance.
  load: Promise.method(function(relations, options) {
    return Promise.bind(this)
      .then(function() {
        return [this.toJSON({shallow: true})];
      })
      .then(handleEager(_.extend({}, options, {
        shallow: true,
        withRelated: _.isArray(relations) ? relations : [relations]
      }))).yield(this);
  }),

  // Sets and saves the hash of model attributes, triggering
  // a "creating" or "updating" event on the model, as well as a "saving" event,
  // to bind listeners for any necessary validation, logging, etc.
  // If an error is thrown during these events, the model will not be saved.
  save: Promise.method(function(key, val, options) {
    var attrs;

    // Handle both `"key", value` and `{key: value}` -style arguments.
    if (key == null || typeof key === "object") {
      attrs = key || {};
      options = val || {};
    } else {
      (attrs = {})[key] = val;
      options = options ? _.clone(options) : {};
    }

    return Promise.bind(this).then(function() {
      return this.isNew(options);
    }).then(function(isNew) {

      // If the model has timestamp columns,
      // set them as attributes on the model, even
      // if the "patch" option is specified.
      if (this.hasTimestamps) _.extend(attrs, this.timestamp(options));

      // Determine whether the model is new, based on whether the model has an `idAttribute` or not.
      options.method = (options.method || (isNew ? 'insert' : 'update')).toLowerCase();
      var method = options.method;
      var vals = attrs;

      // If the object is being created, we merge any defaults here
      // rather than during object creation.
      if (method === 'insert' || options.defaults) {
        var defaults = _.result(this, 'defaults');
        if (defaults) {
          vals = _.extend({}, defaults, this.attributes, vals);
        }
      }

      // Set the attributes on the model.
      this.set(vals, {silent: true});

      // If there are any save constraints, set them on the model.
      if (this.relatedData && this.relatedData.type !== 'morphTo') {
        Helpers.saveConstraints(this, this.relatedData);
      }

      // Gives access to the `query` object in the `options`, in case we need it
      // in any event handlers.
      var sync = this.sync(options);
      options.query = sync.query;

      return Promise.all([
        this.triggerThen((method === 'insert' ? 'creating' : 'updating'), this, attrs, options),
        this.triggerThen('saving', this, attrs, options)
      ])
      .bind(this)
      .then(function() {
        return sync[options.method](method === 'update' && options.patch ? attrs : this.attributes);
      })
      .then(function(resp) {

        // After a successful database save, the id is updated if the model was created
        if (method === 'insert' && this.id == null) {
          this.attributes[this.idAttribute] = this.id = resp[0];
        } else if (method === 'update' && resp === 0) {
          throw new Error('No rows were affected in the update, did you mean to pass the {insert: true} option?');
        }

        // In case we need to reference the `previousAttributes` for the this
        // in the following event handlers.
        options.previousAttributes = this._previousAttributes;

        this._reset();

        return Promise.all([
          this.triggerThen((method === 'insert' ? 'created' : 'updated'), this, resp, options),
          this.triggerThen('saved', this, resp, options)
        ]);

      });

    }).yield(this);
  }),

  // Reset the query builder, called internally
  // each time a query is run.
  resetQuery: function() {
    this._knex = null;
    return this;
  },

  // Returns an instance of the query builder.
  query: function() {
    return Helpers.query(this, _.toArray(arguments));
  },

  // Creates and returns a new `Sync` instance.
  sync: function(options) {
    return new Sync(this, options);
  },

  // Helper for setting up the `morphOne` or `morphMany` relations.
  _morphOneOrMany: function(Target, morphName, morphValue, type) {
    if (!morphName || !Target) throw new Error('The polymorphic `name` and `Target` are required.');
    return this._relation(type, Target, {morphName: morphName, morphValue: morphValue}).init(this);
  }

});

// Handles the response data for the model, returning from the model's fetch call.
// Todo: {silent: true, parse: true}, for parity with collection#set
// need to check on Backbone's status there, ticket #2636
function handleResponse(response) {
  var relatedData = this.relatedData;
  this.set(this.parse(response[0]), {silent: true})._reset();
  if (relatedData && relatedData.isJoined()) {
    relatedData.parsePivot([this]);
  }
}

// Handle the related data loading on the model.
function handleEager(options) {
  return function(response) {
    return new EagerRelation([this], response, this).fetch(options);
  };
}

},{"../base/model":5,"../base/promise":6,"./eager":9,"./helpers":10,"./sync":13,"lodash":false}],12:[function(require,module,exports){
// Relation
// ---------------
var _            = require('lodash');
var inflection   = require('inflection');

var Helpers      = require('./helpers').Helpers;

var ModelBase    = require('../base/model').ModelBase;
var RelationBase = require('../base/relation').RelationBase;
var Promise      = require('../base/promise').Promise;

var push = [].push;

exports.Relation = RelationBase.extend({

  // Assembles the new model or collection we're creating an instance of,
  // gathering any relevant primitives from the parent object,
  // without keeping any hard references.
  init: function(parent) {
    this.parentId          = parent.id;
    this.parentTableName   = _.result(parent, 'tableName');
    this.parentIdAttribute = _.result(parent, 'idAttribute');

    if (this.isInverse()) {
      // If the parent object is eager loading, and it's a polymorphic `morphTo` relation,
      // we can't know what the target will be until the models are sorted and matched.
      if (this.type === 'morphTo' && !parent._isEager) {
        this.target = Helpers.morphCandidate(this.candidates, parent.get(this.key('morphKey')));
        this.targetTableName   = _.result(this.target.prototype, 'tableName');
        this.targetIdAttribute = _.result(this.target.prototype, 'idAttribute');
      }
      this.parentFk = parent.get(this.key('foreignKey'));
    } else {
      this.parentFk = parent.id;
    }

    var target = this.target ? this.relatedInstance() : {};
        target.relatedData = this;

    if (this.type === 'belongsToMany') {
      _.extend(target, pivotHelpers);
    }

    return target;
  },

  // Initializes a `through` relation, setting the `Target` model and `options`,
  // which includes any additional keys for the relation.
  through: function(source, Target, options) {
    var type = this.type;
    if (type !== 'hasOne' && type !== 'hasMany' && type !== 'belongsToMany' && type !== 'belongsTo') {
      throw new Error('`through` is only chainable from `hasOne`, `belongsTo`, `hasMany`, or `belongsToMany`');
    }

    this.throughTarget = Target;
    this.throughTableName = _.result(Target.prototype, 'tableName');
    this.throughIdAttribute = _.result(Target.prototype, 'idAttribute');

    // Set the parentFk as appropriate now.
    if (this.type === 'belongsTo') {
      this.parentFk = this.parentId;
    }

    _.extend(this, options);
    _.extend(source, pivotHelpers);

    // Set the appropriate foreign key if we're doing a belongsToMany, for convenience.
    if (this.type === 'belongsToMany') {
      this.foreignKey = this.throughForeignKey;
    }

    return source;
  },

  // Generates and returns a specified key, for convenience... one of
  // `foreignKey`, `otherKey`, `throughForeignKey`.
  key: function(keyName) {
    if (this[keyName]) return this[keyName];
    if (keyName === 'otherKey') {
      return this[keyName] = singularMemo(this.targetTableName) + '_' + this.targetIdAttribute;
    }
    if (keyName === 'throughForeignKey') {
      return this[keyName] = singularMemo(this.joinTable()) + '_' + this.throughIdAttribute;
    }
    if (keyName === 'foreignKey') {
      if (this.type === 'morphTo') return this[keyName] = this.morphName + '_id';
      if (this.type === 'belongsTo') return this[keyName] = singularMemo(this.targetTableName) + '_' + this.targetIdAttribute;
      if (this.isMorph()) return this[keyName] = this.morphName + '_id';
      return this[keyName] = singularMemo(this.parentTableName) + '_' + this.parentIdAttribute;
    }
    if (keyName === 'morphKey') return this[keyName] = this.morphName + '_type';
    if (keyName === 'morphValue') return this[keyName] = this.parentTableName || this.targetTableName;
  },

  // Injects the necessary `select` constraints into a `knex` query builder.
  selectConstraints: function(knex, options) {
    var resp = options.parentResponse;

    // The base select column
    if (knex.columns.length === 0 && (!options.columns || options.columns.length === 0)) {
      knex.columns.push(this.targetTableName + '.*');
    } else if (_.isArray(options.columns) && options.columns.length > 0) {
      push.apply(knex.columns, options.columns);
    }

    // The `belongsToMany` and `through` relations have joins & pivot columns.
    if (this.isJoined()) {
      this.joinClauses(knex);
      this.joinColumns(knex);
    }

    // If this is a single relation and we're not eager loading,
    // limit the query to a single item.
    if (this.isSingle() && !resp) knex.limit(1);

    // Finally, add (and validate) the where conditions, necessary for constraining the relation.
    this.whereClauses(knex, resp);
  },

  // Inject & validates necessary `through` constraints for the current model.
  joinColumns: function(knex) {
    var columns = [];
    var joinTable = this.joinTable();
    if (this.isThrough()) columns.push(this.throughIdAttribute);
    columns.push(this.key('foreignKey'));
    if (this.type === 'belongsToMany') columns.push(this.key('otherKey'));
    push.apply(columns, this.pivotColumns);
    push.apply(knex.columns, _.map(columns, function(col) {
      return joinTable + '.' + col + ' as _pivot_' + col;
    }));
  },

  // Generates the join clauses necessary for the current relation.
  joinClauses: function(knex) {
    var joinTable = this.joinTable();

    if (this.type === 'belongsTo' || this.type === 'belongsToMany') {

      var targetKey = (this.type === 'belongsTo' ? this.key('foreignKey') : this.key('otherKey'));

      knex.join(
        joinTable,
        joinTable + '.' + targetKey, '=',
        this.targetTableName + '.' + this.targetIdAttribute
      );

      // A `belongsTo` -> `through` is currently the only relation with two joins.
      if (this.type === 'belongsTo') {
        knex.join(
          this.parentTableName,
          joinTable + '.' + this.throughIdAttribute, '=',
          this.parentTableName + '.' + this.key('throughForeignKey')
        );
      }

    } else {
      knex.join(
        joinTable,
        joinTable + '.' + this.throughIdAttribute, '=',
        this.targetTableName + '.' + this.key('throughForeignKey')
      );
    }
  },

  // Check that there isn't an incorrect foreign key set, vs. the one
  // passed in when the relation was formed.
  whereClauses: function(knex, resp) {
    var key;

    if (this.isJoined()) {
      var targetTable = this.type === 'belongsTo' ? this.parentTableName : this.joinTable();
      key = targetTable + '.' + (this.type === 'belongsTo' ? this.parentIdAttribute : this.key('foreignKey'));
    } else {
      key = this.targetTableName + '.' +
        (this.isInverse() ? this.targetIdAttribute : this.key('foreignKey'));
    }

    knex[resp ? 'whereIn' : 'where'](key, resp ? this.eagerKeys(resp) : this.parentFk);

    if (this.isMorph()) {
      knex.where(this.targetTableName + '.' + this.key('morphKey'), this.key('morphValue'));
    }
  },

  // Fetches all `eagerKeys` from the current relation.
  eagerKeys: function(resp) {
    return _.uniq(_.pluck(resp, this.isInverse() ? this.key('foreignKey') : this.parentIdAttribute));
  },

  // Generates the appropriate standard join table.
  joinTable: function() {
    if (this.isThrough()) return this.throughTableName;
    return this.joinTableName || [
      this.parentTableName,
      this.targetTableName
    ].sort().join('_');
  },

  // Creates a new model or collection instance, depending on
  // the `relatedData` settings and the models passed in.
  relatedInstance: function(models) {
    models || (models = []);

    var Target = this.target;

    // If it's a single model, check whether there's already a model
    // we can pick from... otherwise create a new instance.
    if (this.isSingle()) {
      if (!(Target.prototype instanceof ModelBase)) {
        throw new Error('The `'+this.type+'` related object must be a Bookshelf.Model');
      }
      return models[0] || new Target();
    }

    // Allows us to just use a model, but create a temporary
    // collection for a "*-many" relation.
    if (Target.prototype instanceof ModelBase) {
      Target = this.Collection.extend({
        model: Target,
        _builder: Target.prototype._builder
      });
    }
    return new Target(models, {parse: true});
  },

  // Groups the related response according to the type of relationship
  // we're handling, for easy attachment to the parent models.
  eagerPair: function(relationName, related, parentModels) {
    var model;

    // If this is a morphTo, we only want to pair on the morphValue for the current relation.
    if (this.type === 'morphTo') {
      parentModels = _.filter(parentModels, function(model) {
        return model.get(this.key('morphKey')) === this.key('morphValue');
      }, this);
    }

    // If this is a `through` or `belongsToMany` relation, we need to cleanup & setup the `interim` model.
    if (this.isJoined()) related = this.parsePivot(related);

    // Group all of the related models for easier association with their parent models.
    var grouped = _.groupBy(related, function(model) {
      return model.pivot ? model.pivot.get(this.key('foreignKey')) :
        this.isInverse() ? model.id : model.get(this.key('foreignKey'));
    }, this);

    // Loop over the `parentModels` and attach the grouped sub-models,
    // keeping the `relatedData` on the new related instance.
    for (var i = 0, l = parentModels.length; i < l; i++) {
      model = parentModels[i];
      var groupedKey = this.isInverse() ? model.get(this.key('foreignKey')) : model.id;
      var relation = model.relations[relationName] = this.relatedInstance(grouped[groupedKey]);
      relation.relatedData = this;
      if (this.isJoined()) _.extend(relation, pivotHelpers);
    }

    // Now that related models have been successfully paired, update each with
    // its parsed attributes
    for (i = 0, l = related.length; i < l; i++) {
      model = related[i];
      model.attributes = model.parse(model.attributes);
    }

    return related;
  },

  // The `models` is an array of models returned from the fetch,
  // after they're `set`... parsing out any of the `_pivot_` items from the
  // join table and assigning them on the pivot model or object as appropriate.
  parsePivot: function(models) {
    var Through = this.throughTarget;
    return _.map(models, function(model) {
      var data = {}, keep = {}, attrs = model.attributes, through;
      if (Through) through = new Through();
      for (var key in attrs) {
        if (key.indexOf('_pivot_') === 0) {
          data[key.slice(7)] = attrs[key];
        } else {
          keep[key] = attrs[key];
        }
      }
      model.attributes = keep;
      if (!_.isEmpty(data)) {
        model.pivot = through ? through.set(data, {silent: true}) : new this.Model(data, {
          tableName: this.joinTable()
        });
      }
      return model;
    }, this);
  },

  // A few predicates to help clarify some of the logic above.
  isThrough: function() {
    return (this.throughTarget != null);
  },
  isJoined: function() {
    return (this.type === 'belongsToMany' || this.isThrough());
  },
  isMorph: function() {
    return (this.type === 'morphOne' || this.type === 'morphMany');
  },
  isSingle: function() {
    var type = this.type;
    return (type === 'hasOne' || type === 'belongsTo' || type === 'morphOne' || type === 'morphTo');
  },
  isInverse: function() {
    return (this.type === 'belongsTo' || this.type === 'morphTo');
  },

  // Sets the `pivotColumns` to be retrieved along with the current model.
  withPivot: function(columns) {
    if (!_.isArray(columns)) columns = [columns];
    this.pivotColumns || (this.pivotColumns = []);
    push.apply(this.pivotColumns, columns);
  }

});

// Simple memoization of the singularize call.
var singularMemo = (function() {
  var cache = Object.create(null);
  return function(arg) {
    if (arg in cache) {
      return cache[arg];
    } else {
      return cache[arg] = inflection.singularize(arg);
    }
  };
}());

// Specific to many-to-many relationships, these methods are mixed
// into the `belongsToMany` relationships when they are created,
// providing helpers for attaching and detaching related models.
var pivotHelpers = {

  // Attach one or more "ids" from a foreign
  // table to the current. Creates & saves a new model
  // and attaches the model with a join table entry.
  attach: function(ids, options) {
    return this._handler('insert', ids, options);
  },

  // Detach related object from their pivot tables.
  // If a model or id is passed, it attempts to remove the
  // pivot table based on that foreign key. If a hash is passed,
  // it attempts to remove the item based on a where clause with
  // these parameters. If no parameters are specified, we assume we will
  // detach all related associations.
  detach: function(ids, options) {
    return this._handler('delete', ids, options);
  },

  // Selects any additional columns on the pivot table,
  // taking a hash of columns which specifies the pivot
  // column name, and the value the column should take on the
  // output to the model attributes.
  withPivot: function(columns) {
    this.relatedData.withPivot(columns);
    return this;
  },

  // Helper for handling either the `attach` or `detach` call on
  // the `belongsToMany` or `hasOne` / `hasMany` :through relationship.
  _handler: Promise.method(function(method, ids, options) {
    var pending = [];
    if (ids == void 0) {
      if (method === 'insert') return Promise.resolve(this);
      if (method === 'delete') pending.push(this._processPivot(method, null, options));
    }
    if (!_.isArray(ids)) ids = ids ? [ids] : [];
    for (var i = 0, l = ids.length; i < l; i++) {
      pending.push(this._processPivot(method, ids[i], options));
    }
    return Promise.all(pending).yield(this);
  }),

  // Handles setting the appropriate constraints and shelling out
  // to either the `insert` or `delete` call for the current model,
  // returning a promise.
  _processPivot: Promise.method(function(method, item, options) {
    var data = {};
    var relatedData = this.relatedData;
    data[relatedData.key('foreignKey')] = relatedData.parentFk;

    // If the item is an object, it's either a model
    // that we're looking to attach to this model, or
    // a hash of attributes to set in the relation.
    if (_.isObject(item)) {
      if (item instanceof ModelBase) {
        data[relatedData.key('otherKey')] = item.id;
      } else {
        _.extend(data, item);
      }
    } else if (item) {
      data[relatedData.key('otherKey')] = item;
    }
    var builder = this._builder(relatedData.joinTable());
    if (options) {
      if (options.transacting) builder.transacting(options.transacting);
      if (options.debug) builder.debug();
    }
    var collection = this;
    if (method === 'delete') {
      return builder.where(data).del().then(function() {
        var model;
        if (!item) return collection.reset();
        if (model = collection.get(data[relatedData.key('otherKey')])) {
          collection.remove(model);
        }
      });
    }
    return builder.insert(data).then(function() {
      collection.add(item);
    });
  })

};

},{"../base/model":5,"../base/promise":6,"../base/relation":7,"./helpers":10,"inflection":14,"lodash":false}],13:[function(require,module,exports){
// Sync
// ---------------
var _       = require('lodash');
var Promise = require('../base/promise').Promise;

// Sync is the dispatcher for any database queries,
// taking the "syncing" `model` or `collection` being queried, along with
// a hash of options that are used in the various query methods.
// If the `transacting` option is set, the query is assumed to be
// part of a transaction, and this information is passed along to `Knex`.
var Sync = function(syncing, options) {
  options || (options = {});
  this.query   = syncing.query();
  this.syncing = syncing.resetQuery();
  this.options = options;
  if (options.debug) this.query.debug();
  if (options.transacting) this.query.transacting(options.transacting);
};

_.extend(Sync.prototype, {

  // Select the first item from the database - only used by models.
  first: Promise.method(function() {
    this.query.where(this.syncing.format(
      _.extend(Object.create(null), this.syncing.attributes))
    ).limit(1);
    return this.select();
  }),

  // Runs a `select` query on the database, adding any necessary relational
  // constraints, resetting the query when complete. If there are results and
  // eager loaded relations, those are fetched and returned on the model before
  // the promise is resolved. Any `success` handler passed in the
  // options will be called - used by both models & collections.
  select: Promise.method(function() {
    var columns, sync = this,
      options = this.options, relatedData = this.syncing.relatedData;

    // Inject all appropriate select costraints dealing with the relation
    // into the `knex` query builder for the current instance.
    if (relatedData) {
      relatedData.selectConstraints(this.query, options);
    } else {
      columns = options.columns;
      if (!_.isArray(columns)) columns = columns ? [columns] : [_.result(this.syncing, 'tableName') + '.*'];
    }

    // Set the query builder on the options, in-case we need to
    // access in the `fetching` event handlers.
    options.query = this.query;

    // Trigger a `fetching` event on the model, and then select the appropriate columns.
    return Promise.bind(this).then(function() {
      return this.syncing.triggerThen('fetching', this.syncing, columns, options);
    }).then(function() {
      return this.query.select(columns);
    });
  }),

  // Issues an `insert` command on the query - only used by models.
  insert: Promise.method(function() {
    var syncing = this.syncing;
    return this.query
      .insert(syncing.format(_.extend(Object.create(null), syncing.attributes)), syncing.idAttribute);
  }),

  // Issues an `update` command on the query - only used by models.
  update: Promise.method(function(attrs) {
    var syncing = this.syncing, query = this.query;
    if (syncing.id != null) query.where(syncing.idAttribute, syncing.id);
    if (query.wheres.length === 0) {
      throw new Error('A model cannot be updated without a "where" clause or an idAttribute.');
    }
    return query.update(syncing.format(_.extend(Object.create(null), attrs)));
  }),

  // Issues a `delete` command on the query.
  del: Promise.method(function() {
    var query = this.query, syncing = this.syncing;
    if (syncing.id != null) query.where(syncing.idAttribute, syncing.id);
    if (query.wheres.length === 0) {
      throw new Error('A model cannot be destroyed without a "where" clause or an idAttribute.');
    }
    return this.query.del();
  })

});

exports.Sync = Sync;

},{"../base/promise":6,"lodash":false}],14:[function(require,module,exports){
/*!
 * inflection
 * Copyright(c) 2011 Ben Lin <ben@dreamerslab.com>
 * MIT Licensed
 *
 * @fileoverview
 * A port of inflection-js to node.js module.
 */

( function ( root ){

  /**
   * @description This is a list of nouns that use the same form for both singular and plural.
   *              This list should remain entirely in lower case to correctly match Strings.
   * @private
   */
  var uncountable_words = [
    'equipment', 'information', 'rice', 'money', 'species',
    'series', 'fish', 'sheep', 'moose', 'deer', 'news'
  ];

  /**
   * @description These rules translate from the singular form of a noun to its plural form.
   * @private
   */
  var plural_rules = [

    // do not replace if its already a plural word
    [ new RegExp( '(m)en$',      'gi' )],
    [ new RegExp( '(pe)ople$',   'gi' )],
    [ new RegExp( '(child)ren$', 'gi' )],
    [ new RegExp( '([ti])a$',    'gi' )],
    [ new RegExp( '((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$','gi' )],
    [ new RegExp( '(hive)s$',           'gi' )],
    [ new RegExp( '(tive)s$',           'gi' )],
    [ new RegExp( '(curve)s$',          'gi' )],
    [ new RegExp( '([lr])ves$',         'gi' )],
    [ new RegExp( '([^fo])ves$',        'gi' )],
    [ new RegExp( '([^aeiouy]|qu)ies$', 'gi' )],
    [ new RegExp( '(s)eries$',          'gi' )],
    [ new RegExp( '(m)ovies$',          'gi' )],
    [ new RegExp( '(x|ch|ss|sh)es$',    'gi' )],
    [ new RegExp( '([m|l])ice$',        'gi' )],
    [ new RegExp( '(bus)es$',           'gi' )],
    [ new RegExp( '(o)es$',             'gi' )],
    [ new RegExp( '(shoe)s$',           'gi' )],
    [ new RegExp( '(cris|ax|test)es$',  'gi' )],
    [ new RegExp( '(octop|vir)i$',      'gi' )],
    [ new RegExp( '(alias|status)es$',  'gi' )],
    [ new RegExp( '^(ox)en',            'gi' )],
    [ new RegExp( '(vert|ind)ices$',    'gi' )],
    [ new RegExp( '(matr)ices$',        'gi' )],
    [ new RegExp( '(quiz)zes$',         'gi' )],

    // original rule
    [ new RegExp( '(m)an$', 'gi' ),                 '$1en' ],
    [ new RegExp( '(pe)rson$', 'gi' ),              '$1ople' ],
    [ new RegExp( '(child)$', 'gi' ),               '$1ren' ],
    [ new RegExp( '^(ox)$', 'gi' ),                 '$1en' ],
    [ new RegExp( '(ax|test)is$', 'gi' ),           '$1es' ],
    [ new RegExp( '(octop|vir)us$', 'gi' ),         '$1i' ],
    [ new RegExp( '(alias|status)$', 'gi' ),        '$1es' ],
    [ new RegExp( '(bu)s$', 'gi' ),                 '$1ses' ],
    [ new RegExp( '(buffal|tomat|potat)o$', 'gi' ), '$1oes' ],
    [ new RegExp( '([ti])um$', 'gi' ),              '$1a' ],
    [ new RegExp( 'sis$', 'gi' ),                   'ses' ],
    [ new RegExp( '(?:([^f])fe|([lr])f)$', 'gi' ),  '$1$2ves' ],
    [ new RegExp( '(hive)$', 'gi' ),                '$1s' ],
    [ new RegExp( '([^aeiouy]|qu)y$', 'gi' ),       '$1ies' ],
    [ new RegExp( '(x|ch|ss|sh)$', 'gi' ),          '$1es' ],
    [ new RegExp( '(matr|vert|ind)ix|ex$', 'gi' ),  '$1ices' ],
    [ new RegExp( '([m|l])ouse$', 'gi' ),           '$1ice' ],
    [ new RegExp( '(quiz)$', 'gi' ),                '$1zes' ],

    [ new RegExp( 's$', 'gi' ), 's' ],
    [ new RegExp( '$', 'gi' ),  's' ]
  ];

  /**
   * @description These rules translate from the plural form of a noun to its singular form.
   * @private
   */
  var singular_rules = [

    // do not replace if its already a singular word
    [ new RegExp( '(m)an$',                 'gi' )],
    [ new RegExp( '(pe)rson$',              'gi' )],
    [ new RegExp( '(child)$',               'gi' )],
    [ new RegExp( '^(ox)$',                 'gi' )],
    [ new RegExp( '(ax|test)is$',           'gi' )],
    [ new RegExp( '(octop|vir)us$',         'gi' )],
    [ new RegExp( '(alias|status)$',        'gi' )],
    [ new RegExp( '(bu)s$',                 'gi' )],
    [ new RegExp( '(buffal|tomat|potat)o$', 'gi' )],
    [ new RegExp( '([ti])um$',              'gi' )],
    [ new RegExp( 'sis$',                   'gi' )],
    [ new RegExp( '(?:([^f])fe|([lr])f)$',  'gi' )],
    [ new RegExp( '(hive)$',                'gi' )],
    [ new RegExp( '([^aeiouy]|qu)y$',       'gi' )],
    [ new RegExp( '(x|ch|ss|sh)$',          'gi' )],
    [ new RegExp( '(matr|vert|ind)ix|ex$',  'gi' )],
    [ new RegExp( '([m|l])ouse$',           'gi' )],
    [ new RegExp( '(quiz)$',                'gi' )],

    // original rule
    [ new RegExp( '(m)en$', 'gi' ),                                                       '$1an' ],
    [ new RegExp( '(pe)ople$', 'gi' ),                                                    '$1rson' ],
    [ new RegExp( '(child)ren$', 'gi' ),                                                  '$1' ],
    [ new RegExp( '([ti])a$', 'gi' ),                                                     '$1um' ],
    [ new RegExp( '((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$','gi' ), '$1$2sis' ],
    [ new RegExp( '(hive)s$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(tive)s$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(curve)s$', 'gi' ),                                                    '$1' ],
    [ new RegExp( '([lr])ves$', 'gi' ),                                                   '$1f' ],
    [ new RegExp( '([^fo])ves$', 'gi' ),                                                  '$1fe' ],
    [ new RegExp( '([^aeiouy]|qu)ies$', 'gi' ),                                           '$1y' ],
    [ new RegExp( '(s)eries$', 'gi' ),                                                    '$1eries' ],
    [ new RegExp( '(m)ovies$', 'gi' ),                                                    '$1ovie' ],
    [ new RegExp( '(x|ch|ss|sh)es$', 'gi' ),                                              '$1' ],
    [ new RegExp( '([m|l])ice$', 'gi' ),                                                  '$1ouse' ],
    [ new RegExp( '(bus)es$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(o)es$', 'gi' ),                                                       '$1' ],
    [ new RegExp( '(shoe)s$', 'gi' ),                                                     '$1' ],
    [ new RegExp( '(cris|ax|test)es$', 'gi' ),                                            '$1is' ],
    [ new RegExp( '(octop|vir)i$', 'gi' ),                                                '$1us' ],
    [ new RegExp( '(alias|status)es$', 'gi' ),                                            '$1' ],
    [ new RegExp( '^(ox)en', 'gi' ),                                                      '$1' ],
    [ new RegExp( '(vert|ind)ices$', 'gi' ),                                              '$1ex' ],
    [ new RegExp( '(matr)ices$', 'gi' ),                                                  '$1ix' ],
    [ new RegExp( '(quiz)zes$', 'gi' ),                                                   '$1' ],
    [ new RegExp( 'ss$', 'gi' ),                                                          'ss' ],
    [ new RegExp( 's$', 'gi' ),                                                           '' ]
  ];

  /**
   * @description This is a list of words that should not be capitalized for title case.
   * @private
   */
  var non_titlecased_words = [
    'and', 'or', 'nor', 'a', 'an', 'the', 'so', 'but', 'to', 'of', 'at','by',
    'from', 'into', 'on', 'onto', 'off', 'out', 'in', 'over', 'with', 'for'
  ];

  /**
   * @description These are regular expressions used for converting between String formats.
   * @private
   */
  var id_suffix         = new RegExp( '(_ids|_id)$', 'g' );
  var underbar          = new RegExp( '_', 'g' );
  var space_or_underbar = new RegExp( '[\ _]', 'g' );
  var uppercase         = new RegExp( '([A-Z])', 'g' );
  var underbar_prefix   = new RegExp( '^_' );

  var inflector = {

  /**
   * A helper method that applies rules based replacement to a String.
   * @private
   * @function
   * @param {String} str String to modify and return based on the passed rules.
   * @param {Array: [RegExp, String]} rules Regexp to match paired with String to use for replacement
   * @param {Array: [String]} skip Strings to skip if they match
   * @param {String} override String to return as though this method succeeded (used to conform to APIs)
   * @returns {String} Return passed String modified by passed rules.
   * @example
   *
   *     this._apply_rules( 'cows', singular_rules ); // === 'cow'
   */
    _apply_rules : function( str, rules, skip, override ){
      if( override ){
        str = override;
      }else{
        var ignore = ( inflector.indexOf( skip, str.toLowerCase()) > -1 );

        if( !ignore ){
          var i = 0;
          var j = rules.length;

          for( ; i < j; i++ ){
            if( str.match( rules[ i ][ 0 ])){
              if( rules[ i ][ 1 ] !== undefined ){
                str = str.replace( rules[ i ][ 0 ], rules[ i ][ 1 ]);
              }
              break;
            }
          }
        }
      }

      return str;
    },



  /**
   * This lets us detect if an Array contains a given element.
   * @public
   * @function
   * @param {Array} arr The subject array.
   * @param {Object} item Object to locate in the Array.
   * @param {Number} fromIndex Starts checking from this position in the Array.(optional)
   * @param {Function} compareFunc Function used to compare Array item vs passed item.(optional)
   * @returns {Number} Return index position in the Array of the passed item.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.indexOf([ 'hi','there' ], 'guys' ); // === -1
   *     inflection.indexOf([ 'hi','there' ], 'hi' ); // === 0
   */
    indexOf : function( arr, item, fromIndex, compareFunc ){
      if( !fromIndex ){
        fromIndex = -1;
      }

      var index = -1;
      var i     = fromIndex;
      var j     = arr.length;

      for( ; i < j; i++ ){
        if( arr[ i ]  === item || compareFunc && compareFunc( arr[ i ], item )){
          index = i;
          break;
        }
      }

      return index;
    },



  /**
   * This function adds pluralization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {String} plural Overrides normal output with said String.(optional)
   * @returns {String} Singular English language nouns are returned in plural form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.pluralize( 'person' ); // === 'people'
   *     inflection.pluralize( 'octopus' ); // === "octopi"
   *     inflection.pluralize( 'Hat' ); // === 'Hats'
   *     inflection.pluralize( 'person', 'guys' ); // === 'guys'
   */
    pluralize : function ( str, plural ){
      return inflector._apply_rules( str, plural_rules, uncountable_words, plural );
    },



  /**
   * This function adds singularization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {String} singular Overrides normal output with said String.(optional)
   * @returns {String} Plural English language nouns are returned in singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.singularize( 'people' ); // === 'person'
   *     inflection.singularize( 'octopi' ); // === "octopus"
   *     inflection.singularize( 'Hats' ); // === 'Hat'
   *     inflection.singularize( 'guys', 'person' ); // === 'person'
   */
    singularize : function ( str, singular ){
      return inflector._apply_rules( str, singular_rules, uncountable_words, singular );
    },



  /**
   * This function adds camelization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} lowFirstLetter Default is to capitalize the first letter of the results.(optional)
   *                                 Passing true will lowercase it.
   * @returns {String} Lower case underscored words will be returned in camel case.
   *                  additionally '/' is translated to '::'
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.camelize( 'message_properties' ); // === 'MessageProperties'
   *     inflection.camelize( 'message_properties', true ); // === 'messageProperties'
   */
    camelize : function ( str, lowFirstLetter ){
      var str_path = str.toLowerCase().split( '/' );
      var i        = 0;
      var j        = str_path.length;

      for( ; i < j; i++ ){
        var str_arr = str_path[ i ].split( '_' );
        var initX   = (( lowFirstLetter && i + 1 === j ) ? ( 1 ) : ( 0 ));
        var k       = initX;
        var l       = str_arr.length;

        for( ; k < l; k++ ){
          str_arr[ k ] = str_arr[ k ].charAt( 0 ).toUpperCase() + str_arr[ k ].substring( 1 );
        }

        str_path[ i ] = str_arr.join( '' );
      }

      return str_path.join( '::' );
    },



  /**
   * This function adds underscore support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} allUpperCase Default is to lowercase and add underscore prefix.(optional)
   *                  Passing true will return as entered.
   * @returns {String} Camel cased words are returned as lower cased and underscored.
   *                  additionally '::' is translated to '/'.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.underscore( 'MessageProperties' ); // === 'message_properties'
   *     inflection.underscore( 'messageProperties' ); // === 'message_properties'
   *     inflection.underscore( 'MP', true ); // === 'MP'
   */
    underscore : function ( str, allUpperCase ){
      if( allUpperCase && str === str.toUpperCase()) return str;

      var str_path = str.split( '::' );
      var i        = 0;
      var j        = str_path.length;

      for( ; i < j; i++ ){
        str_path[ i ] = str_path[ i ].replace( uppercase, '_$1' );
        str_path[ i ] = str_path[ i ].replace( underbar_prefix, '' );
      }

      return str_path.join( '/' ).toLowerCase();
    },



  /**
   * This function adds humanize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} lowFirstLetter Default is to capitalize the first letter of the results.(optional)
   *                                 Passing true will lowercase it.
   * @returns {String} Lower case underscored words will be returned in humanized form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.humanize( 'message_properties' ); // === 'Message properties'
   *     inflection.humanize( 'message_properties', true ); // === 'message properties'
   */
    humanize : function( str, lowFirstLetter ){
      str = str.toLowerCase();
      str = str.replace( id_suffix, '' );
      str = str.replace( underbar, ' ' );

      if( !lowFirstLetter ){
        str = inflector.capitalize( str );
      }

      return str;
    },



  /**
   * This function adds capitalization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} All characters will be lower case and the first will be upper.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.capitalize( 'message_properties' ); // === 'Message_properties'
   *     inflection.capitalize( 'message properties', true ); // === 'Message properties'
   */
    capitalize : function ( str ){
      str = str.toLowerCase();

      return str.substring( 0, 1 ).toUpperCase() + str.substring( 1 );
    },



  /**
   * This function adds dasherization support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Replaces all spaces or underbars with dashes.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.dasherize( 'message_properties' ); // === 'message-properties'
   *     inflection.dasherize( 'Message Properties' ); // === 'Message-Properties'
   */
    dasherize : function ( str ){
      return str.replace( space_or_underbar, '-' );
    },



  /**
   * This function adds titleize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Capitalizes words as you would for a book title.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.titleize( 'message_properties' ); // === 'Message Properties'
   *     inflection.titleize( 'message properties to keep' ); // === 'Message Properties to Keep'
   */
    titleize : function ( str ){
      str         = str.toLowerCase().replace( underbar, ' ');
      var str_arr = str.split(' ');
      var i       = 0;
      var j       = str_arr.length;

      for( ; i < j; i++ ){
        var d = str_arr[ i ].split( '-' );
        var k = 0;
        var l = d.length;

        for( ; k < l; k++){
          if( inflector.indexOf( non_titlecased_words, d[ k ].toLowerCase()) < 0 ){
            d[ k ] = inflector.capitalize( d[ k ]);
          }
        }

        str_arr[ i ] = d.join( '-' );
      }

      str = str_arr.join( ' ' );
      str = str.substring( 0, 1 ).toUpperCase() + str.substring( 1 );

      return str;
    },



  /**
   * This function adds demodulize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Removes module names leaving only class names.(Ruby style)
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.demodulize( 'Message::Bus::Properties' ); // === 'Properties'
   */
    demodulize : function ( str ){
      var str_arr = str.split( '::' );

      return str_arr[ str_arr.length - 1 ];
    },



  /**
   * This function adds tableize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Return camel cased words into their underscored plural form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.tableize( 'MessageBusProperty' ); // === 'message_bus_properties'
   */
    tableize : function ( str ){
      str = inflector.underscore( str );
      str = inflector.pluralize( str );

      return str;
    },



  /**
   * This function adds classification support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Underscored plural nouns become the camel cased singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.classify( 'message_bus_properties' ); // === 'MessageBusProperty'
   */
    classify : function ( str ){
      str = inflector.camelize( str );
      str = inflector.singularize( str );

      return str;
    },



  /**
   * This function adds foreign key support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @param {Boolean} dropIdUbar Default is to seperate id with an underbar at the end of the class name,
                                 you can pass true to skip it.(optional)
   * @returns {String} Underscored plural nouns become the camel cased singular form.
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.foreign_key( 'MessageBusProperty' ); // === 'message_bus_property_id'
   *     inflection.foreign_key( 'MessageBusProperty', true ); // === 'message_bus_propertyid'
   */
    foreign_key : function( str, dropIdUbar ){
      str = inflector.demodulize( str );
      str = inflector.underscore( str ) + (( dropIdUbar ) ? ( '' ) : ( '_' )) + 'id';

      return str;
    },



  /**
   * This function adds ordinalize support to every String object.
   * @public
   * @function
   * @param {String} str The subject string.
   * @returns {String} Return all found numbers their sequence like "22nd".
   * @example
   *
   *     var inflection = require( 'inflection' );
   *
   *     inflection.ordinalize( 'the 1 pitch' ); // === 'the 1st pitch'
   */
    ordinalize : function ( str ){
      var str_arr = str.split(' ');
      var i       = 0;
      var j       = str_arr.length;

      for( ; i < j; i++ ){
        var k = parseInt( str_arr[ i ], 10 );

        if( !isNaN( k )){
          var ltd = str_arr[ i ].substring( str_arr[ i ].length - 2 );
          var ld  = str_arr[ i ].substring( str_arr[ i ].length - 1 );
          var suf = 'th';

          if( ltd != '11' && ltd != '12' && ltd != '13' ){
            if( ld === '1' ){
              suf = 'st';
            }else if( ld === '2' ){
              suf = 'nd';
            }else if( ld === '3' ){
              suf = 'rd';
            }
          }

          str_arr[ i ] += suf;
        }
      }

      return str_arr.join( ' ' );
    }
  };

  if( typeof exports === 'undefined' ) return root.inflection = inflector;

/**
 * @public
 */
  inflector.version = "1.2.5";
/**
 * Exports module.
 */
  module.exports = inflector;
})( this );

},{}],15:[function(require,module,exports){
//     trigger-then.js 0.1.1
//     (c) 2013 Tim Griesser
//     trigger-then may be freely distributed under the MIT license.

// Exports the function which mixes `triggerThen`
// into the specified `Backbone` copy's `Events` object,
// using the promise-lib's "all" implementation provided
// in the second argument.
(function(mixinFn) {
  if (typeof exports === "object") {
    module.exports = mixinFn;
  } else if (typeof define === "function" && define.amd) {
    define('trigger-then', [], function() { return mixinFn; });
  } else {
    this.triggerThen = mixinFn;
  }
}).call(this, function(Backbone, PromiseLib) {

  var Events = Backbone.Events;
  var push   = Array.prototype.push;
  var slice  = Array.prototype.slice;
  var eventSplitter = /\s+/;

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments). Returns an array containing all of the
  // event trigger calls, in case any return deferreds.
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    var dfds = [];
    switch (args.length) {
      case 0: while (++i < l) dfds.push((ev = events[i]).callback.call(ev.ctx)); return dfds;
      case 1: while (++i < l) dfds.push((ev = events[i]).callback.call(ev.ctx, a1)); return dfds;
      case 2: while (++i < l) dfds.push((ev = events[i]).callback.call(ev.ctx, a1, a2)); return dfds;
      case 3: while (++i < l) dfds.push((ev = events[i]).callback.call(ev.ctx, a1, a2, a3)); return dfds;
      default: while (++i < l) dfds.push((ev = events[i]).callback.apply(ev.ctx, args)); return dfds;
    }
  };

  // Fires events as `trigger` normally would, but assumes that some of the `return`
  // values from the events may be promises, and and returns a promise when all of the
  // events are resolved.
  var triggerThen = Events.triggerThen = function(name) {
    if (!this._events) return PromiseLib.all([]);
    var names = [name];
    var args = slice.call(arguments, 1);
    var dfds = [];
    var events = [];
    if (eventSplitter.test(names[0])) names = names[0].split(eventSplitter);
    for (var i = 0, l = names.length; i < l; i++) {
      push.apply(events, this._events[names[i]]);
    }
    var allEvents = this._events.all;

    // Wrap in a try/catch to reject the promise if any errors are thrown within the handlers.
    try  {
      if (events) push.apply(dfds, triggerEvents(events, args));
      if (allEvents) push.apply(dfds, triggerEvents(allEvents, arguments));
    } catch (e) {
      return PromiseLib.reject(e);
    }
    return PromiseLib.all(dfds);
  };

  // Mixin `triggerThen` to the appropriate objects and prototypes.
  Backbone.triggerThen = triggerThen;

  var objs = ['Model', 'Collection', 'Router', 'View', 'History'];

  for (var i=0, l=objs.length; i<l; i++) {
    Backbone[objs[i]].prototype.triggerThen = triggerThen;
  }
});
},{}]},{},[1])
(1)
});