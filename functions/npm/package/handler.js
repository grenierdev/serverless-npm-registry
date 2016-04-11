'use strict';

var Storage = require('../lib/Storage')();

module.exports.handler = function(event, context) {
	console.log('Request', event);


	return context.done(null, {
		message: `Package`,
		event: event
	});
};
