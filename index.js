const cookie= require('js-cookie')

class StorageError extends Error {
  constructor(message) {
    super(message)
  }
}

function copy(val) {
  if (typeof val === 'object') {
    return JSON.parse(JSON.stringify(val))
  } else {
    return val
  }
}

function advancedAssign(target, ...sources) {
  sources.forEach(source => {
    const descriptors = {}
    for (const key of Object.keys(source)) {
      descriptors[key] = Object.getOwnPropertyDescriptor(source, key)
    }
    for (const key of Object.getOwnPropertySymbols(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (descriptor.enumerable) {
        descriptors[key] = descriptor;
      }
    }
    Object.defineProperties(target, descriptors)
  })
  return target
}

function throwError(code, more) {
  const error = new StorageError()
  Error.captureStackTrace(error, throwError)
  error.code = code
  switch (code) {
    case 'UNKNOWN_STORAGE':
      error.message = `unknown ${more.storage}.`
      break
    case 'UNDEFINED_MODEL':
      error.message = `missing definition for model: ${more.model}`
      break
    case 'UNKNOWN_PROPERTY':
      error.message = `unknown property of model ${more.model}: ${more.property}`
      break
    case 'MISSING_REQUIRED_FIELD':
      error.message = `${more.field} is required in model ${more.model}.`
      break
    case 'ERROR_FIELD_TYPE':
      error.message = `Value of ${more.field} in model ${more.model} should be ${more.been}, but got a ${more.expected}`
      break
    case 'INSTANCE_ALREADY_EXIST':
      error.message = `${more.instance} already exists in model ${more.model}.`
      break
    case 'INSTANCE_NOT_EXIST':
      error.message = `model ${more.model} has no instance: ${more.instance}`
      break
    case 'VALUE_METHOD_NOT_EXIST':
      error.message = `return data of ${more.field} method has no value() method`
      break
  }
  throw error
}

class Model {
  constructor(name, model) {
    this.$name = name
    this.$model = model
    this.$default = {}
    this.$required = []
    this.$property = Object.keys(model)
    for (const property of this.$property) {
      if (model[property].default === void 0) {
        this.$required.push(property)
      } else {
        this.$default[property] = model[property]
      }
    }
  }
  validateField(property, value) {
    if (!this.$model[property]) {
      throwError('UNKNOWN_PROPERTY', { model: this.$name, property })
    }
    const description = this.$model[property]
    if (this.$required.includes(property) && value === void 0) {
      throwError('MISSING_REQUIRED_FIELD', { model: this.$name, field: property })
    }
    switch (description.type) {
      case 'boolean':
      case 'string':
      case 'number':
        if (typeof value !== description.type) {
          throwError('ERROR_FIELD_TYPE', { model: this.$name, field: property, been: description.type, expected: typeof value })
        } break
      case 'json':
      case 'reference':
      default:
    }
  }
  validate(instance, opts = {}) {
    const options = Object.assign({
      validateNotProvided: false,
      assignDefault: false,
      prune: false
    }, opts)
    for (const prop of Object.keys(instance)) {
      if (this.$property.includes(prop)) {
        this.validateField(prop, instance[prop])
      } else {
        if (options.prune) {
          // eslint-disable-next-line no-param-reassign
          delete instance[prop]
        }
      }
    }
    if (options.validateNotProvided) {
      for (const prop of this.$required) {
        if (instance[prop] === void 0) {
          throwError('MISSING_REQUIRED_FIELD', { field: prop })
        }
      }
    }
    if (options.assignDefault) {
      for (const prop of Object.keys(this.$default)) {
        if (instance[prop] === void 0) {
          /* eslint-disable no-param-reassign */
          if (typeof this.$default[prop] === 'function') {
            instance[prop] = this.$default[prop]()
          } else {
            instance[prop] = this.$default[prop]
          }
          /* eslint-enable no-param-reassign */
        }
      }
    }
  }
}

class Stage {
  constructor(namespace, structs) {
    this.$namespace = namespace
    this.$define = Object.create(null)
    this.$upsert = Object.create(null) // update or create
    this.$create = Object.create(null) // only create
    this.$update = Object.create(null) // only update
    this.$drop = Object.create(null)
    this.$flag = null
    for (const name of Object.keys(structs)) {
      this.define(name, structs[name])
    }
  }
  $key(modelName, instanceName) {
    return `${this.$namespace}:${modelName}:${instanceName}`
  }
  define(name, struct) {
    this.$flag = 'define'
    this.$define[name] = new Model(name, struct)
    return this
  }
  model(name) {
    if (!this.$define[name]) {
      throwError('UNDEFINED_MODEL', { model: name })
    }
    this.$flag = 'model'
    this.$model = name
    this.$update[name] = Object.create(null)
    this.$create[name] = Object.create(null)
    this.$upsert[name] = Object.create(null)
    this.$drop[name] = []
    return this
  }
  instance(name, value) {
    this.$flag = 'instance'
    this.$instance = name
    if (arguments.length > 1) {
      this.$upsert[this.$model][name] = copy(value)
    }
    this.$update[this.$model][this.$instance] = Object.create(null)
    return this
  }
  property(name, value) {
    this.$flag = 'property'
    if (typeof name === 'object') {
      Object.assign(this.$update[this.$model][this.$instance], copy(name))
    } else {
      this.$property = name
      if (arguments.length > 1) {
        this.$update[this.$model][this.$instance][name] = copy(value)
      }
    }
    return this
  }
  create(name, obj) {
    this.$flag = 'create'
    this.$create[this.$model][name] = copy(obj)
    return this
  }
  drop(name) {
    this.$flag = 'drop'
    delete this.$update[this.$model][name]
    delete this.$upsert[this.$model][name]
    delete this.$create[this.$model][name]
    this.$drop[this.$model].push(name)
    return this
  }
  end() {
    console.log(this)
    // drop
    for (const model of Object.keys(this.$drop)) {
      for (const instance of this.$drop[model]) {
        this.$del(model, instance)
      }
    }
    // create
    for (const model of Object.keys(this.$create)) {
      for (const instance of Object.keys(this.$create[model])) {
        const data = this.$create[model][instance]
        this.$throwOnValidateFailed(model, data)
        if (this.$exist(model, instance)) {
          throwError('INSTANCE_ALREADY_EXIST', { model, instance })
        }
        this.$set(model, instance, data)
      }
    }
    // upsert
    for (const model of Object.keys(this.$upsert)) {
      for (const instance of Object.keys(this.$upsert[model])) {
        const data = this.$upsert[model][instance]
        const srcData = this.$get(model, instance)
        if (srcData) {
          for (const property of Object.keys(data)) {
            this.$throwOnValidateFailed(model, property, data[property])
          }
        } else {
          this.$throwOnValidateFailed(model, data)
        }
        this.$set(model, instance, Object.assign({}, srcData, data))
      }
    }
    // update
    for (const model of Object.keys(this.$update)) {
      for (const instance of Object.keys(this.$update[model])) {
        const data = this.$update[model][instance]
        const properties = Object.keys(data)
        for (const property of properties) {
          this.$throwOnValidateFailed(model, property, data[property])
        }
        if (properties.length && !this.$exist(model, instance)) {
          throwError('INSTANCE_NOT_EXIST', { model, instance })
        }
        for (const property of properties) {
          this.$set(model, instance, property, data[property])
        }
      }
    }
    switch (this.$flag) {
      case 'instance':
        return this.$get(this.$model, this.$instance)
      case 'property':
        return this.$get(this.$model, this.$instance, this.$property)
      default:
    }
  }

  $throwOnValidateFailed(modelName, property, value) {
    const model = this.$define[modelName]
    if (!model) {
      return throwError('UNDEFINED_MODEL', { model: modelName })
    }
    if (typeof property === 'object') {
      model.validate(property)
    } else {
      model.validateField(property, value)
    }
  }

  $exist(model, instance) {
    return !!this.$get(model, instance)
  }
  /* eslint-disable */
  $get(model, instance, property) {}
  $set(model, instance, property, value) {}
  $del(model, instance) { }
  /* eslint-enable */
}

class StageLocalStorage extends Stage {
  constructor(...props) {
    super(...props)
    this.storage = window.localStorage
  }
  $exist(modelName, instanceName) {
    return !!this.$get(modelName, instanceName)
  }
  $set(modelName, instanceName, property, value) {
    const key = this.$key(modelName, instanceName)
    console.log(...arguments, key)
    if (typeof property === 'object') {
      this.storage.setItem(key, JSON.stringify(property))
    } else {
      const srcData = this.$get(modelName, instanceName)
      const data = Object.assign(srcData, { [property]: value })
      this.storage.setItem(key, JSON.stringify(data))
    }
  }
  $del(modelName, instanceName) {
    this.storage.removeItem(this.$key(modelName, instanceName))
  }
  $get(modelName, instanceName, property) {
    const model = this.$define[modelName]
    const key = this.$key(modelName, instanceName)
    let ret
    try {
      const data = JSON.parse(this.storage.getItem(key))
      model.validate(data, { validateNotProvided: true })
      ret = data
    } catch (e) {
      this.storage.removeItem(key)
      return
    }
    if (property) {
      return ret[property]
    } else {
      return ret
    }
  }
}

class StageSessionStorage extends StageLocalStorage {
  constructor(...props) {
    super(...props)
    this.storage = window.sessionStorage
  }
}

const cookieStorage = {
  get $cookie() {
    try {
      return JSON.parse(cookie.get(this.$namespace))
    } catch (e) {
      cookie.remove(this.$namespace)
      return Object.create(null)
    }
  },
  getItem(name) {
    return this.$cookie[name]
  },
  setItem(name, value) {
    cookie.set(this.$namespace, JSON.stringify(Object.assign(this.$cookie, { [name]: value })))
  },
  removeItem(name) {
    cookie.set(this.$namespace, JSON.stringify(Object.assign(this.$cookie, { [name]: undefined })))
  }
}

class StageCookie extends StageLocalStorage {
  constructor(...props) {
    super(...props)
    this.storage = advancedAssign({ $namespace: this.$namespace }, cookieStorage)
  }
}

function startStorage() {
  const structs = {}
  storage.define = define
  return storage
  function define(name, struct) {
    structs[name] = struct
  }
  function storage(name, namespace) {
    switch (name) {
      case 'cookie':
        return new StageCookie(namespace, structs)
      case 'session':
        return new StageSessionStorage(namespace, structs)
      case 'local':
        return new StageLocalStorage(namespace, structs)
      default:
        throwError('UNKNOWN_STORAGE', { storage: name })
    }
  }
}

module.exports = startStorage

module.exports.storage = startStorage()
