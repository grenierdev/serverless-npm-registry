'use strict';

var Storage = require('../lib/Storage')();

module.exports.handler = function(event, context) {
	console.log('Request', event);

	if (event.authorization) {
		Storage.User.fetchByToken(event.authorization)
			.then(user => {

				var url = `${event.path}~${event.method}`;
				switch (url) {
					// npm search {package}
					case '/-/all/since~GET':
						context.fail(`https://registry.npmjs.org/-/all/since?stale=${event.stale}&startkey=${event.startkey}`);
						break;

					// npm search {package}
					case '/-/all~GET':
						context.fail(`https://registry.npmjs.org/-/all`);
						break;

					// npm info {package}
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

					// npm publish
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

					// TODO npm publish [...] --tag {tag} https://docs.npmjs.com/cli/publish && https://github.com/rlidwka/sinopia/blob/master/lib/index-api.js#L279
					// TODO npm publish tarball.gz [...] https://docs.npmjs.com/cli/publish

					// npm install {package}
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

					// npm dist-tag ls {package}
					case '/-/package/{package}/dist-tags~GET':
						Storage.Package.fetchByName(event.package)
							.then(pkg => {
								if (user.canWrite(pkg.name) == false) {
									throw new Error(`User can not access this package.`);
								}

								return context.done(null, pkg.info['dist-tags']);
							})
							.catch(err => {
								context.fail(JSON.stringify({
									error: `You need to login to access this access this package.`
								}));
							});
						break;

					// npm dist-tag add {package}@{version} {tag}
					case '/-/package/{package}/dist-tags/{tag}~PUT':
						Storage.Package.fetchByName(event.package)
							.then(pkg => {
								if (user.canWrite(pkg.name) == false) {
									throw new Error(`User can not access this package.`);
								}

								pkg.info['dist-tags'][event.tag] = event.version;

								return pkg.update();
							})
							.then(pkg => {
								return context.done(null, { ok: 'Tags updated.' });
							})
							.catch(err => {
								context.fail(JSON.stringify({
									error: `You need to login to access this access this package.`
								}));
							});
						break;

					// npm dist-tag rm {package} {tag}
					case '/-/package/{package}/dist-tags/{tag}~DELETE':
						Storage.Package.fetchByName(event.package)
							.then(pkg => {
								if (user.canWrite(pkg.name) == false) {
									throw new Error(`User can not access this package.`);
								}

								delete pkg.info['dist-tags'][event.tag];

								return pkg.update();
							})
							.then(pkg => {
								return context.done(null, { ok: 'Tags removed.' });
							})
							.catch(err => {
								context.fail(JSON.stringify({
									error: `You need to login to access this access this package.`
								}));
							});
						break;

					// npm unpublish {package}
					// npm unpublish {package}@{version}
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

					// TODO (ignored) npm access https://docs.npmjs.com/cli/access
					// TODO npm deprecate https://docs.npmjs.com/cli/deprecate
					// TODO (ignored) npm owner https://docs.npmjs.com/cli/owner
					// TODO npm ping https://docs.npmjs.com/cli/ping
					// TODO (ignored) npm star/unstar https://docs.npmjs.com/cli/star
					// TODO (ignored) npm team https://docs.npmjs.com/cli/team

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
