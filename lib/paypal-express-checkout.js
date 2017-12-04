'use strict';

var urlParser = require('url');
var https = require('https');
var querystring = require('querystring');
var _ = require('underscore');

var API_URLS = {
	testing: {
		certificate: 'https://api.sandbox.paypal.com/nvp',
		signature: 'https://api-3t.sandbox.paypal.com/nvp',
		redirect: 'https://www.sandbox.paypal.com/cgi-bin/webscr'
	},
	production: {
		certificate: 'https://api.paypal.com/nvp',
		signature: 'https://api-3t.paypal.com/nvp',
		redirect: 'https://www.paypal.com/cgi-bin/webscr'
	}
}

var PAYMENT_PARAMS = {
	email : ['EMAIL', String],
	description : ['PAYMENTREQUEST_0_DESC', String],
	invoiceNumber : ['PAYMENTREQUEST_0_INVNUM', String],
	custom : ['PAYMENTREQUEST_0_CUSTOM', String],
	action : ['PAYMENTREQUEST_0_PAYMENTACTION', String],
	
	returnUrl : ['RETURNURL', String],
	cancelUrl : ['CANCELURL', String],
	callbackUrl : ['CALLBACK', String],
	callbackTimeout : ['CALLBACKTIMEOUT', String],
	callbackVersion : ['CALLBACKVERSION', String],
	
	onlyPayPalUsers : ['SOLUTIONTYPE', function (val) { return (val === true) ? 'Mark' : 'Sole' } ],
	brandName : ['BRANDNAME', String],
	headerImgUrl : ['HDRIMG', String],
	logoImgUrl : ['LOGOIMG', String],
	backgroundColor : ['PAYFLOWCOLOR', String],
	borderColor : ['CARTBORDERCOLOR', String],
	noShipping : ['NOSHIPPING', function (val) { return (val || val === 0) ? val : 1 }], //default to 1
	allowNote : ['ALLOWNOTE', function (val) { return (val || val === 0) ? val : 1 }],//default to 1
	requireConfirmShipping : ['REQCONFIRMSHIPPING', function (val) { return (val || val === 0) ? val : 0 }], //default to 0
	offerInsurance : ['OFFERINSURANCEOPTION', String],
	
	currency : ['PAYMENTREQUEST_0_CURRENCYCODE', String],
	amount : ['PAYMENTREQUEST_0_AMT', prepareNumber],
	subTotal : ['PAYMENTREQUEST_0_ITEMAMT', prepareNumber],
	itemAmount : ['PAYMENTREQUEST_0_ITEMAMT', prepareNumber],
	shippingAmount : ['PAYMENTREQUEST_0_SHIPPINGAMT', prepareNumber],
	taxAmount : ['PAYMENTREQUEST_0_TAXAMT', prepareNumber],
	maxAmount : ['MAXAMT', prepareNumber],
	shippingDiscountAmount : ['PAYMENTREQUEST_0_SHIPDISCAMT', prepareNumber],
};

var SHIPPING_OPTION_PARAMS = {
	name : ['L_SHIPPINGOPTIONNAME', String],
	label : ['L_SHIPPINGOPTIONLABEL', String],
	amount : ['L_SHIPPINGOPTIONAMOUNT', prepareNumber],
	taxAmount : ['L_TAXAMT', prepareNumber],
	insuranceAmount : ['L_INSURANCEAMOUNT', prepareNumber],
	default : ['L_SHIPPINGOPTIONISDEFAULT', String]
};

var ITEM_PARAMS = {
	name : ['L_PAYMENTREQUEST_0_NAME', String],
	description : ['L_PAYMENTREQUEST_0_DESC', String],
	amount : ['L_PAYMENTREQUEST_0_AMT', prepareNumber],
	number : ['L_PAYMENTREQUEST_0_NUMBER', String],
	quantity : ['L_PAYMENTREQUEST_0_QTY', String],
	taxAmount : ['L_PAYMENTREQUEST_0_TAXMT', prepareNumber],
	weight : ['L_PAYMENTREQUEST_0_ITEMWEIGHTVALUE', prepareNumber],
	weightUnit : ['L_PAYMENTREQUEST_0_ITEMWEIGHTUNIT', String],
	length : ['L_PAYMENTREQUEST_0_ITEMLENGTHVALUE', prepareNumber],
	lengthUnit : ['L_PAYMENTREQUEST_0_ITEMLENGTHUNIT', String],
	width : ['L_PAYMENTREQUEST_0_ITEMWIDTHVALUE', prepareNumber],
	widthUnit : ['L_PAYMENTREQUEST_0_ITEMWIDTHUNIT', String],
	height : ['L_PAYMENTREQUEST_0_ITEMHEIGHTVALUE', prepareNumber],
	heightUnit : ['L_PAYMENTREQUEST_0_ITEMHEIGHTUNIT', String],
	url : ['L_PAYMENTREQUEST_0_ITEMURL', String]
};

var CALLBACK_RESPONSE_OPTIONS = {
	method : ['METHOD', String],
	currency : ['CURRENCYCODE', String],
	offerInsurance : ['OFFERINSURANCEOPTION', String],
	noShippingOptionDetail : ['NO_SHIPPING_OPTION_DETAILS', function (val) { return (val) }],
};

/**
 * Constructor for PayPal object.
 */
function Paypal(opts) {
	this.username = opts.username;
	this.password = opts.password;
	this.signature = opts.signature || null;
	this.testing = opts.testing || false;
	this.key = opts.key || null;
	this.cert = opts.cert || null;

	this.payOptions = {};
	this.products = [];

	if (!this.signature && (!this.key || !this.cert)) {
		throw new Error('signature or key and cert are required');
	}

	var urls = API_URLS[(this.testing) ? 'testing' : 'production'];

	this.url = urls[(this.key && this.cert) ? 'certificate' : 'signature'];
	this.redirect = urls.redirect;
}

/**
 * Paypal params.
 * @return {object} [description]
 */
Paypal.prototype.params = function() {
	var result = {
		USER: this.username,
		PWD: this.password,
		SIGNATURE: this.signature,
		VERSION: '204.0',
	};

	return result; 
};

/**
 * Format number to be in proper format for payment.
 * @param  {[type]} num        [description]
 * @param  {[type]} doubleZero [description]
 * @return {string}            Returns null if cannot format.
 */
function prepareNumber(num, doubleZero) {
	var str = num.toString().replace(',', '.');

	var index = str.indexOf('.');
	if (index > -1) {
		var len = str.substring(index + 1).length;
		if (len === 1) {
			str += '0';
		}

		if (len > 2) {
			str = str.substring(0, index + 3);
		}
	} else {
		if (doubleZero || true) {
			str += '.00';
		}
	}

	return str;
}

/**
 * Get an object of parameters based on an options object and a paramSet map
 * @param  {[type]} opts        [description]
 * @param  {[type]} paramSet    [description]
 * @param  {[type]} i           [description]
 * @return {string}             Returns null if cannot format.
 */
Paypal.prototype.getParamsFromOpts = function(opts, paramSet, i) {
	var params = {};
	
	Object.keys(opts).forEach(function (key) {
		var prop = paramSet[key];
		
		if (!prop) {
			//unknown property - ignore
			return;
		}
		
		var p = (i || i === 0)
			? prop[0] + i
			: prop[0]
		
		params[p] = prop[1](opts[key]);
	});

	return params;
}

/**
 * GetExpressCheckoutDetails, this will also call DoExpressCheckoutPayment optionally; in most cases you want to have this. 
 * @param  {string}   token    [description]
 * @param  {bool}   doPayment  you want to set this to true in most cases.
 * @param  {Function} callback [description]
 * @return {Paypal}            [description]
 */
Paypal.prototype.getExpressCheckoutDetails = function(token, doPayment, callback) {
	var self = this;
	var params = self.params();

	params.TOKEN = token;
	params.METHOD = 'GetExpressCheckoutDetails';

	self.request(self.url, 'POST', params, function(err, data) {
		if (err) {
			callback(err, data);
			return;
		}

		if (!doPayment) {
			return callback(null, data);
		}

		// Prevent user from paying multiple times by mistake
		if (data.CHECKOUTSTATUS == 'PaymentActionCompleted'){
			callback(new Error('Payment is already completed.'), data);
			return;
		}

		var params = self.params();
		params.PAYMENTREQUEST_0_PAYMENTACTION = params.PAYMENTREQUEST_0_PAYMENTACTION || 'Sale';
		params.PAYERID = data.PAYERID;
		params.TOKEN = token;
		params.PAYMENTREQUEST_0_AMT = data.PAYMENTREQUEST_0_AMT;
		params.PAYMENTREQUEST_0_CURRENCYCODE = data.PAYMENTREQUEST_0_CURRENCYCODE;
		params.PAYMENTREQUEST_0_ITEMAMT = data.PAYMENTREQUEST_0_ITEMAMT;
		params.METHOD = 'DoExpressCheckoutPayment';

		self.request(self.url, 'POST', params, function(err, data2) {
			if (err) {
				callback(err, data2);
				return;
			}

			if (data.ACK  !== 'Success' || data2.ACK !== 'Success') {
				return callback(new Error('Error DoExpressCheckoutPayment'), data2);
			}


			// Combine results of getExpressCheckout and DoExpress checkout payment.
			callback(null, _.extend(data, data2));
		});
	});

	return self;
};

/**
 * Add product for pricing.	
 * @param {array} products       item in arary = { name, description, quantity, amount }
 */
Paypal.prototype.setProducts = function(products) {
	this.products = products;
	return this;
};

Paypal.prototype.setShippingOptions = function(shippingOptions) {
	this.shippingOptions = shippingOptions;
	return this;
};

Paypal.prototype.setPaymentAction = function(paymentAction){
	this.payOptions.PAYMENTREQUEST_0_PAYMENTACTION = paymentAction;
	return this;
}

Paypal.prototype.setShippingAmount = function(amount){
	this.payOptions.PAYMENTREQUEST_0_SHIPPINGAMT = parseFloat(amount);
	return this;
}

Paypal.prototype.setSubTotal = function(amount){
	this.payOptions.PAYMENTREQUEST_0_ITEMAMT = parseFloat(amount);
	return this;
}

Paypal.prototype.setTaxAmount = function(amount){
	this.payOptions.PAYMENTREQUEST_0_TAXAMT = parseFloat(amount);
	return this;
}

Paypal.prototype.setMaxAmount = function(amount){
	this.payOptions.MAXAMT = parseFloat(amount);
	return this
}

Paypal.prototype.clearData = function(){
	this.payOptions = {};
	this.products = [];
	this.shippingOptions = [];
}

/**
 * Get Items params.
 * @return {[type]} [description]
 */

Paypal.prototype.getItemsParams = function(products) {
	var self = this;
	var params = {};
	
	// Add product information.
	(products || self.products).forEach(function (product, i) {
		params = _.extend(params, self.getParamsFromOpts(product, ITEM_PARAMS, i));
	});

	return params;
};

/**
 * Get Shipping Options params.
 * @return {[type]} [description]
 */

Paypal.prototype.getShippingOptionParams = function(shippingOptions) {
	var self = this;
	var params = {};
	
	(shippingOptions || self.shippingOptions).forEach(function (option, i) {
		params = _.extend(params, self.getParamsFromOpts(option, SHIPPING_OPTION_PARAMS, i));
	});

	return params;
};

Paypal.prototype.getCallbackResponseParams = function(opts) {
	var self = this;
	
	return self.getParamsFromOpts(opts, CALLBACK_RESPONSE_OPTIONS);
};

Paypal.prototype.getPayOptionParams = function () {
	return this.payOptions;
}

/**
 * Pay.
 * @param {string} email [description]
 * @param  {String}   invoiceNumber [description]
 * @param  {Number}   amount         [description]
 * @param  {String}   description   [description]
 * @param  {String}   currency      EUR, USD
 * @param  {Function} callback      [description]
 * @return {PayPal}                 [description]
 */

Paypal.prototype.setExpressCheckoutPayment = function(opts, callback) {
	var self = this;
	var params = self.params();

	if (opts.callbackUrl && !opts.callbackTimeout) {
		opts.callbackTimeout = 3;
	}
	
	params = _.extend(params, this.getParamsFromOpts(opts, PAYMENT_PARAMS));
	params = _.extend(params, this.getItemsParams());
	params = _.extend(params, this.getShippingOptionParams());
	params = _.extend(params, this.getPayOptionParams());
	
	params.METHOD = 'SetExpressCheckout';
	
	self.request(self.url, 'POST', params, function(err, data) {
		if (err) {
			callback(err, data);
			return;
		}

		if (data.ACK === 'Success') {
			callback(null, { 
				redirectUrl: self.redirect + '?cmd=_express-checkout&useraction=commit&token=' + data.TOKEN, 
				token: data.TOKEN 
			});
			return;
		}

		err = new Error('ACK ' + data.ACK + ': ' + data.L_LONGMESSAGE0);
		err.code = data.L_ERRORCODE0;
		
		callback(err, data);
	});

	return self;
};

/**
 * Do express checkout payment.
 * @param {object} params returned by getExpressCheckoutDetails callback.
 * @return {[type]} [description]
 */
Paypal.prototype.doExpressCheckoutPayment = function(params, callback) {
	var self = this;
	params = _.extend(self.params(), params);

	params.METHOD = 'DoExpressCheckoutPayment';	

	self.request(self.url, 'POST', params, function(err, data) {
		if (err) {
			callback(err);
			return;
		}
		
		if (data.ACK === 'Success') {
			return callback(null, data);
		}

		err = new Error('ACK ' + data.ACK + ': ' + data.L_LONGMESSAGE0);
		err.code = data.L_ERRORCODE0;
		
		callback(err, data);
	});

	return this;
};
	
/**
 * Set some options used for payments.
 * @param {string} hdrImageUrl        [description]
 * @param {string} logoUrl         [description]
 * @param {string} backgroundColor [description]
 * @param {string} cartBorderColor [description]
 * @param {string} brandName       [description]
 * @param {number} requireShipping [description]
 * @param {number} noShipping      [description]
 */
Paypal.prototype.setPayOptions = function(opts) {
	this.payOptions = _.extend(this.payOptions, this.getParamsFromOpts(opts, PAYMENT_PARAMS));

	return this;
};

/**
 * Special Request function that uses NVP refered from Classic PayPal API.
 * @param  {string}   url      [description]
 * @param  {string}   method   [description]
 * @param  {object}   data     [description]
 * @param  {Function} callback [description]
 * @return {Paypal}            [description]
 */
Paypal.prototype.request = function(url, method, data, callback) {
	var self = this;
	var params = querystring.stringify(data);

	if (method === 'GET') {
		url += '?' + params;
	}

	var uri = urlParser.parse(url);
	var headers = {};

	headers['Content-Type'] = method === 'POST' ? 'application/x-www-form-urlencoded' : 'text/plain';
	headers['Content-Length'] = params.length;

	var options = { 
		protocol: uri.protocol, 
		auth: uri.auth, 
		method: method || 'GET', 
		hostname: uri.hostname, 
		port: uri.port, 
		path: uri.path, 
		agent: false, 
		headers: headers,
		key: self.key,
		cert: self.cert
	};

	console.log('paypal-express-checkout: request options - ', options);

	// Make HTTPS request.
	var req = https.request(options, function(res) {
		var buffer = '';

		res.on('data', function(chunk) {
			buffer += chunk.toString('utf8');
		});

		// Set timeout on request.
		req.setTimeout(exports.timeout, function() {
			callback(new Error('timeout'), null);
		});

		res.on('end', function() {
			var error = null;
			var data = '';

			if (res.statusCode > 200) {
				error = new Error(res.statusCode);
				data = buffer;
			} else {
				data = querystring.parse(buffer);
			}

			callback(error, data);
		});
	});

	if (method === 'POST') {
		console.log('paypal-express-checkout: request params - ', params);
		req.end(params);
	} else {
		req.end();
	}

	return self;
};

/**
 * Default timeout is 10s.
 * @type {Number}
 */
exports.timeout = 10000;

/**
 * Testing/Production API URLs
 * @type {Object}
 */
exports.API_URLS = API_URLS;

/**
 * Payment Parameters
 * @type {Object}
 */
exports.PAYMENT_PARAMS = PAYMENT_PARAMS;

/**
 * Shipping Option Parameters
 * @type {Object}
 */
exports.SHIPPING_OPTION_PARAMS = SHIPPING_OPTION_PARAMS;

/**
 * Item Parameters
 * @type {Object}
 */
exports.ITEM_PARAMS = ITEM_PARAMS;

/**
 * Export paypal object.
 * @type {[type]}
 */
exports.Paypal = Paypal;

/**
 * Create Paypal object. Wrapper around constructor.
 */
exports.create = function(username, password, signature, testing) {
	var opts;

	if (arguments.length === 1 && typeof username === 'object') {
		opts = username;
	}

	return new Paypal(opts || {
		username : username,
		password : password,
		signature : signature,
		testing : testing
	});
};
