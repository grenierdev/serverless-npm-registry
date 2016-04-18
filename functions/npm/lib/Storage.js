'use strict';

var AWS = require('aws-sdk');
var Crypto = require('crypto');
var Path = require('path');

module.exports = function () {

	var DynamoDB = new AWS.DynamoDB({
		apiVersion: '2012-08-10',
		region: process.env.AWS_REGION
	});

	var S3 = new AWS.S3({
		apiVersion: '2006-03-01',
		region: process.env.AWS_REGION
	});

	function encryptString (string) {
		var cipher = Crypto.createCipher('aes192', process.env.NPM_SECRET);
		return cipher.update(string, 'utf8', 'hex') + cipher.final('hex');
	}

	function decryptString (string) {
		var decipher = Crypto.createDecipher('aes192', process.env.NPM_SECRET);
		return decipher.update(string, 'hex', 'utf8') + decipher.final('utf8');
	}

	class User {

		constructor (data) {
			Object.assign(this, {
				name: '',
				password: '',
				expire: '',
				permission: [],
				access: [],
				owner: []
			}, data);
		}

		get token () {
			return encryptString(`${this.name}:${this.password}:${new Date().getTime()}`);
		}

		matchPassword (password) {
			return encryptString(password) == this.password;
		}

		canRead (pkg) {
			// TODO is expired ?
			return this.access.indexOf(pkg) > -1 || this.canWrite(pkg);
		}

		canWrite (pkg) {
			// TODO is expired ?
			return this.canPerform('publish') && this.owner.indexOf(pkg) > -1;
		}

		canPerform (action) {
			// TODO is expired ?
			return this.permission.indexOf(action) > -1;
		}

		grantRead (pkg) {
			if (!this.canRead(pkg)) {
				this.access.push(pkg);
			}
			return this.update();
		}

		grantWrite (pkg) {
			if (!this.canWrite(pkg)) {
				this.owner.push(pkg);
			}
			return this.update();
		}

		update () {
			return new Promise((resolve, reject) => {
				DynamoDB.updateItem({
					TableName: process.env.NPM_USER_TABLE,
					Key: {
						name: {
							S: this.name
						}
					},
					UpdateExpression: 'SET #password = :password, #expire = :expire, #permission = :permission, #access = :access, #owner = :owner',
					ExpressionAttributeNames: {
						'#password': 'password',
						'#expire': 'expire',
						'#permission': 'permission',
						'#access': 'access',
						'#owner': 'owner'
					},
					ExpressionAttributeValues: {
						':password': {S: this.password},
						':expire': {S: this.expire},
						':permission': {L: this.permission.map(pkg => { return {S: pkg}; })},
						':access': {L: this.access.map(pkg => { return {S: pkg}; })},
						':owner': {L: this.owner.map(pkg => { return {S: pkg}; })}
					}
				}, (err, data) => {
					if (err) {
						return reject(err);
					}
					return resolve(this);
				});
			});
		}

		static fetchByToken (token) {
			try {
				token = token.match(/^(Bearer) (.*)$/)[2];
				var decryptedToken = decryptString(token).split(':');
				var name = decryptedToken[0];
				var pass = decryptedToken[1];
				return this.fetchByName(name).then(user => {
					if (user.password != pass) {
						throw new Error('Invalid token.');
					}
					return user;
				});
			} catch (e) {
				return Promise.reject(e);
			}
		}

		static fetchByName (name) {
			return new Promise((resolve, reject) => {
				DynamoDB.getItem({
					TableName: process.env.NPM_USER_TABLE,
					Key: {
						name: {
							S: name
						}
					}
				}, (err, data) => {
					if (err || !data || typeof data.Item === 'undefined') {
						return reject(new Error(`User "${name}" not found.`));
					}
					return resolve(new User({
						name: data.Item.name.S || '',
						password: data.Item.password.S || '',
						email: data.Item.email.S,
						expire: data.Item.expire ? data.Item.expire.S : '',
						permission: data.Item.permission ? data.Item.permission.L.map(pkg => pkg.S) : [],
						access: data.Item.access ? data.Item.access.L.map(pkg => pkg.S) : [],
						owner: data.Item.owner ? data.Item.owner.L.map(pkg => pkg.S) : []
					}));
				});
			});
		}

		static create (info) {
			info = Object.assign({}, {
				name: '',
				password: '',
				expire: '',
				permission: [],
				access: [],
				owner: []
			}, info);

			info.password = encryptString(info.password);

			return new Promise((resolve, reject) => {
				DynamoDB.putItem({
					TableName: process.env.NPM_USER_TABLE,
					Item: {
						name: {S: info.name},
						password: {S: info.password},
						email: {S: info.email},
						expire: {S: (info.expire || 'never')},
						permission: {L: (info.permission || []).map(pkg => { return {S: pkg}; })},
						access: {L: (info.access || []).map(pkg => { return {S: pkg}; })},
						owner: {L: (info.owner || []).map(pkg => { return {S: pkg}; })}
					}
				}, (err, data) => {
					if (err) {
						return reject(err);
					}
					return resolve(new User(info));
				});
			});
		}
	}

	class Package {
		constructor (data) {
			Object.assign(this, {
				name: '',
				info: ''
			}, data);

			try {
				this.info = JSON.parse(this.info);
			} catch (e) {
				this.info = {};
			}
		}

		unpublish (revision) {
			var tasks = [];
			Object.keys(this.info.versions).forEach(ver => {
				if (revision && revision != ver) {
					return;
				}

				var meta = this.info.versions[ver];

				if (meta.dist) {
					tasks.push(new Promise((resolve, reject) => {
						var file = Path.basename(meta.dist.tarball);
						S3.deleteObject({
							Bucket: process.env.NPM_PACKAGE_BUCKET,
							Key: file
						}, (err, data) => {
							if (err) {
								return reject(err);
							}
							return resolve();
						})
					}));
				}
			});

			if (revision) {
				delete this.info.versions[revision];
				tasks.push(this.update());
			} else {
				tasks.push(new Promise((resolve, reject) => {
					DynamoDB.deleteItem({
						TableName: process.env.NPM_PACKAGE_TABLE,
						Key: {
							name: {S: this.name}
						}
					}, (err, data) => {
						if (err) {
							return reject(err);
						}
						resolve(this);
					})
				}));
			}

			return Promise.all(tasks);
		}

		update () {
			return new Promise((resolve, reject) => {
				DynamoDB.updateItem({
					TableName: process.env.NPM_PACKAGE_TABLE,
					Key: {
						name: {
							S: this.name
						}
					},
					UpdateExpression: 'SET #info = :info',
					ExpressionAttributeNames: {
						'#info': 'info'
					},
					ExpressionAttributeValues: {
						':info': {S: JSON.stringify(this.info)}
					}
				}, (err, data) => {
					if (err) {
						return reject(err);
					}
					return resolve(this);
				});
			});
		}

		static fetchByName (name) {
			return new Promise((resolve, reject) => {
				DynamoDB.getItem({
					TableName: process.env.NPM_PACKAGE_TABLE,
					Key: {
						name: {
							S: name
						}
					}
				}, (err, data) => {
					if (err || !data || typeof data.Item === 'undefined') {
						return reject(new Error(`Package "${name}" not found.`));
					}
					return resolve(new Package({
						name: data.Item.name.S || '',
						info: data.Item.info.S || ''
					}));
				});
			});
		}

		static fetchByNames (names) {
			return new Promise((resolve, reject) => {
				var packages = [];
				var keyExpr = names.map((name, i) => `#name = :name${i}`).join(' or ');
				var attrValues = {};
				names.forEach((name, i) => {
					attrValues[`:name${i}`] = {S: name};
				});

				var fetchNext = after => {
					var query = {
						TableName: process.env.NPM_PACKAGE_TABLE,
						KeyConditionExpression: keyExpr,
						ExpressionAttributeNames: {
							'#name': 'name'
						},
						ExpressionAttributeValues: attrValues
					};
					if (after) {
						query.ExclusiveStartKey = {name: {S: after}};
					}
					DynamoDB.query(query, (err, data) => {
						if (err) {
							return resolve(packages);
						}

						data.Items.forEach(Item => {
							packages.push(new Package({
								name: Item.name.S || '',
								info: Item.info.S || ''
							}));
						});

						if (typeof data.LastEvaluatedKey !== 'undefined' && data.LastEvaluatedKey !== null) {
							fetchNext(data.LastEvaluatedKey.S);
						} else {
							resolve(packages);
						}
					});
				}

				fetchNext();
			});
		}

		static create (info, attachments) {
			info = Object.assign({}, {
				name: '',
				info: ''
			}, info);

			info.info = JSON.stringify(info.info);

			attachments = attachments || [];

			return new Promise((resolve, reject) => {
				DynamoDB.putItem({
					TableName: process.env.NPM_PACKAGE_TABLE,
					Item: {
						name: {S: info.name},
						info: {S: info.info}
					}
				}, (err, data) => {
					if (err) {
						return reject(err);
					}

					var uploads = [];
					Object.keys(attachments).forEach(file => {
						var meta = attachments[file];

						uploads.push(new Promise((resolve, reject) => {
							S3.upload({
								Bucket: process.env.NPM_PACKAGE_BUCKET,
								Key: file,
								Body: new Buffer(meta.data, 'base64'),
								ACL: 'private',
								ContentType: meta.content_type
							}, {
								// options ?
							}, (err, data) => {
								if (err) {
									return reject(err);
								}
								return resolve();
							})
						}));
					});

					Promise.all(uploads)
						.then(results => {
							resolve(new Package({
								name: info.name,
								info: info.info
							}));
						})
						.catch(err => {
							reject(err);
						})
				});
			});
		}

		static getDownloadUrl (file) {
			return new Promise((resolve, reject) => {

				S3.getSignedUrl('getObject', {
					Bucket: process.env.NPM_PACKAGE_BUCKET,
					Key: file,
					Expires: 60
				}, (err, url) => {
					if (err) {
						return reject(err);
					}
					return resolve(url);
				});
			});
		}
	}

	return {
		User: User,
		Package: Package
	};
};
