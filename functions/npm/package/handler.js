'use strict';

var Storage = require('../lib/Storage')();

module.exports.handler = function(event, context) {
	console.log('Request', event);

	if (event.authorization) {
		Storage.User.fetchByToken(event.authorization)
			.then(user => {

				var url = `${event.path}~${event.method}`;
				switch (url) {
					case '/-/all/since~GET':
						context.fail(`https://registry.npmjs.org/-/all/since?stale=${event.stale}&startkey=${event.startkey}`);
						break;

					case '/-/all~GET':
						context.fail(`https://registry.npmjs.org/-/all`);
						break;

					case '/{package}~GET':
						Storage.Package.fetchByName(event.package)
							.then(pkg => {
								if (user.canRead(pkg.name)) {
									context.done(null, pkg.info);
								}
								else {
									context.fail(JSON.stringify({
										error: `You need to login to access this access this package.`
									}));
								}
							})
							.catch(err => {
								context.fail(`https://registry.npmjs.org/${event.package}`);
							})
						break;

					case '/{package}~PUT':
						var info = event.body;
						var attachments = info._attachments;
						delete info._attachments;

						info.maintainers = [{ name: user.name, email: user.email }];
						info.time = { modified: (new Date()).toISOString() };

						Storage.Package.fetchByName(event.package)
							.catch(err => {
								return Promise.resolve(null);
							})
							.then(pkg => {
								if (
									(pkg && user.canWrite(pkg.name) == false) ||
									(!pkg && user.canPerform('publish') == false)
								) {
									context.fail(JSON.stringify({
										error: `You need to login to access this access this package.`
									}));
								}
								else {
									if (pkg) {
										info.versions = Object.assign({}, pkg.info.versions, info.versions);
										info['dist-tags'] = Object.assign({}, pkg.info['dist-tags'], info['dist-tags']);
									}

									return Promise.all([
										Storage.Package.create({name: info.name, info: info}, attachments),
										user.grantWrite(info.name)
									])
									.then(results => {
										context.done(null, {
											ok: `Package published.`
										});
									})
									.catch(err => {
										context.fail(JSON.stringify({
											error: `Bad request.`
										}));
									});
								}
							})
							.catch(err => {
								context.fail(JSON.stringify({
									error: `Bad request.`
								}));
							});

						break;

					case '/{package}/-/{tarball}~GET':
						Storage.Package.fetchByName(event.package)
							.then(pkg => {
								if (user.canRead(pkg.name) == false) {
									throw new Error(`User can not access this package.`);
								}

								Storage.Package.getDownloadUrl(event.tarball)
									.then(url => {
										return context.fail(url);
									})
									.catch(err => {
										return context.fail(JSON.stringify({
											error: `Bad request.`
										}));
									});
							})
							.catch(err => {
								context.fail(JSON.stringify({
									error: `You need to login to access this access this package.`
								}));
							});
						break;

					// TODO dist-tags https://github.com/rlidwka/sinopia/blob/master/lib/index-api.js#L218

					// TODO revision https://github.com/rlidwka/sinopia/blob/master/lib/index-api.js#L279
					case '/{package}/-rev/{revision}~PUT':
						return context.fail(JSON.stringify({
							error: `Bad request.`
						}));
						break;

					case '/{package}/-rev/{revision}~DELETE':
						Storage.Package.fetchByName(event.package)
							.then(pkg => {
								if (user.canWrite(pkg.name) == false) {
									throw new Error(`User can not access this package.`);
								}

								pkg.unpublish(event.revision == 'undefined' ? undefined : event.revision)
									.then(url => {
										return context.done(null, {
											ok: `Package removed.`
										});
									})
									.catch(err => {
										return context.fail(JSON.stringify({
											error: `Bad request.`
										}));
									});
							})
							.catch(err => {
								context.fail(JSON.stringify({
									error: `You need to login to access this access this package.`
								}));
							});
						break;

					default:
						return context.done(null, {
							event: event
						});
				}

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
};
