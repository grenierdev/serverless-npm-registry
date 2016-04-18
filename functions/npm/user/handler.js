'use strict';

var Storage = require('../lib/Storage')();

module.exports.handler = function(event, context) {

	var url = `${event.path}~${event.method}`;
	switch (url) {

		// npm whoami
		case '/-/whoami~GET':

			if (event.authorization) {
				Storage.User.fetchByToken(event.authorization)
					.then(user => {
						context.done(null, {
							username: user.name
						});
					})
					.catch(err => {
						context.fail(JSON.stringify({
							error: `You need to login to access this registry.`
						}));
					});
			}
			else {
				context.fail(JSON.stringify({
					error: `You need to login to access this registry.`
				}));
			}

			break;

		// npm ???
		case '/-/user/{name}~GET':
			if (event.name.match(/^org\.couchdb\.user:/)) {
				var name = event.name.replace(/^org\.couchdb\.user:/, '');

				Storage.User.fetchByName(name)
					.catch(err => {
						context.fail(JSON.stringify({
							error: `User ${name} does not exists.`
						}));
					})
					.then(user => {
						context.done(null, {
							_id: `org.couchdb.user:${user.name}`,
							email: user.email,
							name: user.name
						});
					});
			}
			else {
				context.fail(JSON.stringify({
					error: `Bad request.`
				}));
			}

			break;

		// npm login
		case '/-/user/{name}/-rev/{revision}~PUT':
		case '/-/user/{name}~PUT':
			if (event.name.match(/^org\.couchdb\.user:/)) {
				var name = event.name.replace(/^org\.couchdb\.user:/, '');

				Storage.User.fetchByName(name)
					.catch(err => {
						return Storage.User.create({
							name: event.body.name,
							password: event.body.password,
							email: event.body.email,
							expire: 'never'
						})
					})
					.then(user => {
						if (user.matchPassword(event.body.password)) {
							context.done(null, {
								ok: `User '${name}' created.`,
								token: user.token
							});
						}
						else {
							context.fail(JSON.stringify({
								error: `User ${name} does not exists or password mismatch.`
							}));
						}
					});
			}
			else {
				context.fail(JSON.stringify({
					error: `User was not provided.`
				}));
			}

			break;

		// npm logout
		case '/-/user/token/{token}~DELETE':
			return context.done(null, {
				ok: 'logged out'
			});

		default:
			return context.done(null, {
				event: event
			});
	}
};
