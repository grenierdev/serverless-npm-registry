'use strict';

module.exports.handler = function(event, context) {
  return context.done(null, {
    message: `Hey Ho !`
  });
};
