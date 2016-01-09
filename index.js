var snabbdom = require('snabbdom');
var html = require('snabbdom-jsx').html;

var optimized = {};
var activeController = null;

var patch = snabbdom.init([
  require('snabbdom/modules/class'),
  require('snabbdom/modules/props'),
  require('snabbdom/modules/attributes'),
  require('snabbdom/modules/style'),
  require('snabbdom/modules/eventlisteners'),
  {
    destroy: function(vnode) {
      if (vnode.key) {
        delete optimized[key];
      }
    }
  }
]);

var hasChanged = function (oldProps, oldState, newProps, newState) {
  if (
    Object.keys(oldProps).length !== Object.keys(newProps).length ||
    Object.keys(oldState).length !== Object.keys(newState).length
  ) {
    return true;
  }
  for (var key in oldProps) {
    if (oldProps[key] !== newProps[key]) {
      return true;
    }
  }
  for (var key in oldState) {
    if (oldState[key] !== newState[key]) {
      return true;
    }
  }
  return false;
};

function Component() {
  var extractsState = arguments.length === 2;
  var statePaths = arguments[0];
  var render = extractsState ? arguments[1] : arguments[0];

  return function (props, children) {
    var newState;
    if (extractsState) {
      var newState = Object.keys(statePaths).reduce(function (state, key) {
        state[key] = activeController.get(statePaths[key]);
        return state;
      }, {});
    } else {
      newState = activeController.get();
    }

    if (
      props.key &&
      optimized[props.key] &&
      !hasChanged(
        optimized[props.key].props,
        optimized[props.key].state,
        props,
        newState
      )
    ) {
      return optimized[props.key].vnode;
    }

    var vnode = render({
      props: props,
      children: children,
      state: newState,
      signals: activeController.getSignals(),
      modules: activeController.getModules()
    });

    if (props.key) {
      optimized[props.key] = {
        vnode: vnode,
        props: props,
        state: newState
      };
      vnode.optimize = props.optimize;
    }



    return vnode;
  }
};

Component.DOM = html;

module.exports.Component = Component;

module.exports.render = function render(cb, el, controller) {
  activeController = controller;
  activeController.getDevtools().start();
  if (activeController.getServices().router) {
    activeController.getServices().router.trigger();
  }
  var prevNode = cb();
  controller.on('change', function () {
    var newNode = cb();
    patch(prevNode, newNode);
    prevNode = newNode;
  });
  patch(el, prevNode);
}
