/* global CustomEvent */
var snabbdom = require('snabbdom')
var h = require('snabbdom/h')

var componentsMap = {}
var activeController = null

function extractDeps (deps, allDeps) {
  return Object.keys(deps).reduce(function (depsMap, key) {
    if (deps[key].getDepsMap) {
      return extractDeps(deps[key].getDepsMap(), allDeps)
    } else {
      var depsKey = Array.isArray(deps[key]) ? deps[key].join('.') : deps[key]
      depsMap[depsKey] = true
    }
    return depsMap
  }, allDeps)
}

var patch = snabbdom.init([
  require('snabbdom/modules/class'),
  require('snabbdom/modules/props'),
  require('snabbdom/modules/attributes'),
  require('snabbdom/modules/style'),
  require('snabbdom/modules/eventlisteners'),
  process.env.NODE_ENV === 'production' ? {} : {
    create: function (emptyVnode, vnode) {
      if (vnode.component) {
        var deps = vnode.component.getStatePaths(vnode.component.props, vnode.component.deps)
        registerComponent(vnode, extractDeps(deps, {}))
      }
    },
    update: function (prevNode, newNode) {
      if (prevNode.component && newNode.component) {
        var props = newNode.component.props
        var getStatePaths = newNode.component.getStatePaths
        var deps = newNode.component.deps
        newNode.component = prevNode.component
        newNode.component.props = props
        newNode.component.getStatePaths = getStatePaths
        newNode.component.deps = deps
        deps = newNode.component.getStatePaths(newNode.component.props, newNode.component.deps)
        updateComponent(newNode, extractDeps(deps, {}))
      }
    },
    remove: function (vnode, removeCallback) {
      if (vnode.component) {
        unregisterComponent(vnode)
      }
      removeCallback()
    }
  }
])

function updateComponent (vnode, deps) {
  unregisterComponent(vnode)
  registerComponent(vnode, deps)
}

function registerComponent (vnode, deps) {
  componentsMap = Object.keys(deps).reduce(function (componentsMap, key) {
    componentsMap[key] = componentsMap[key] ? componentsMap[key].concat(vnode.component) : [vnode.component]
    return componentsMap
  }, componentsMap)
}

function unregisterComponent (vnode) {
  Object.keys(componentsMap).forEach(function (key) {
    if (componentsMap[key].indexOf(vnode.component) >= 0) {
      componentsMap[key].splice(componentsMap[key].indexOf(vnode.component), 1)
    }
    if (componentsMap[key].length === 0) {
      delete componentsMap[key]
    }
  })
}

function getStatePaths (props, deps) {
  if (!deps) {
    return {}
  }
  var propsWithModules = Object.keys(props).reduce(function (propsWithModules, key) {
    propsWithModules[key] = props[key]
    return propsWithModules
  }, {modules: activeController.getModules()})
  return typeof deps === 'function' ? deps(propsWithModules) : deps
}

function getProps (props, deps, signals) {
  var paths = getStatePaths(props, deps)

  var propsToPass = Object.keys(paths || {}).reduce(function (props, key) {
    props[key] = paths[key].getDepsMap ? paths[key].get(activeController.get()) : activeController.get(paths[key])
    return props
  }, {})

  propsToPass = Object.keys(props).reduce(function (propsToPass, key) {
    propsToPass[key] = props[key]
    return propsToPass
  }, propsToPass)

  if (signals) {
    propsToPass = Object.keys(signals).reduce(function (propToPass, key) {
      propToPass[key] = activeController.getSignals(signals[key])
      return propToPass
    }, propsToPass)
  } else {
    // expose all signals
    propsToPass.signals = activeController.getSignals()
  }

  propsToPass.modules = activeController.getModules()

  return propsToPass
}

function onCerebralUpdate (changes, runPatching, force) {
  function traverse (level, currentPath, componentsToRender) {
    Object.keys(level).forEach(function (key) {
      currentPath.push(key)
      var stringPath = currentPath.join('.')
      if (componentsMap[stringPath]) {
        componentsToRender = componentsMap[stringPath].reduce(function (componentsToRender, component) {
          if (componentsToRender.indexOf(component) === -1) {
            return componentsToRender.concat(component)
          }
          return componentsToRender
        }, componentsToRender)
      }
      if (level[key] !== true) {
        componentsToRender = traverse(level[key], currentPath, componentsToRender)
      }
      currentPath.pop()
    })
    return componentsToRender
  }
  var start = Date.now()
  var componentsToRender = traverse(changes, [], [])
  runPatching()
  var end = Date.now()

  if (process.env.NODE_ENV !== 'production' && (force || componentsToRender.length)) {
    var devtoolsComponentsMap = Object.keys(componentsMap).reduce(function (devtoolsComponentsMap, key) {
      devtoolsComponentsMap[key] = componentsMap[key].map(function (component) {
        return component.name
      })
      return devtoolsComponentsMap
    }, {})
    var event = new CustomEvent('cerebral.dev.components', {
      detail: {
        map: devtoolsComponentsMap,
        render: {
          start: start,
          duration: end - start,
          changes: changes,
          components: componentsToRender.map(function (component) {
            return component.name
          })
        }
      }
    })
    window.dispatchEvent(event)
  }
}

function functionName (fun) {
  var ret = fun.toString()
  ret = ret.substr('function '.length)
  ret = ret.substr(0, ret.indexOf('('))
  return ret
}

function connect (deps, signals, getVNode) {
  deps = deps || {}

  if (arguments.length === 2) {
    getVNode = signals
    signals = null
  }

  if (process.env.NODE_ENV === 'test') {
    return function (props) {
      return getVNode(props)
    }
  }

  var render = function (props) {
    var vnode = getVNode(getProps(props || {}, deps, signals))
    vnode.component = {
      getStatePaths: getStatePaths,
      props: props || {},
      signals: signals,
      deps: deps,
      name: functionName(getVNode)
    }
    return vnode
  }

  return render
}

module.exports.connect = connect

module.exports.h = h

module.exports.render = function render (cb, el, controller) {
  activeController = controller
  var oldNode = null
  activeController.on('flush', function (changes) {
    onCerebralUpdate(changes, function () {
      oldNode = patch(oldNode, h('div', [cb()]))
    })
  })
  oldNode = patch(el, h('div', [cb()]))
  onCerebralUpdate({}, function () {}, true)
}
