"use strict";

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange')
const { ExchangeError, InsufficientFunds, OrderNotFound, DDoSProtection } = require ('./base/errors')

//  ---------------------------------------------------------------------------

module.exports = class coinmate extends Exchange {

    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'coinmate',
            'name': 'CoinMate',
            'countries': [ 'GB', 'CZ' ], // UK, Czech Republic
            'rateLimit': 1000,
            'hasCORS': true,
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27811229-c1efb510-606c-11e7-9a36-84ba2ce412d8.jpg',
                'api': 'https://coinmate.io/api',
                'www': 'https://coinmate.io',
                'doc': [
                    'http://docs.coinmate.apiary.io',
                    'https://coinmate.io/developers',
                ],
            },
            'api': {
                'public': {
                    'get': [
                        'orderBook',
                        'ticker',
                        'transactions',
                    ],
                },
                'private': {
                    'post': [
                        'balances',
                        'bitcoinWithdrawal',
                        'bitcoinDepositAddresses',
                        'buyInstant',
                        'buyLimit',
                        'cancelOrder',
                        'cancelOrderWithInfo',
                        'createVoucher',
                        'openOrders',
                        'redeemVoucher',
                        'sellInstant',
                        'sellLimit',
                        'transactionHistory',
                        'unconfirmedBitcoinDeposits',
                    ],
                },
            },
            'markets': {
                'BTC/EUR': { 'id': 'BTC_EUR', 'symbol': 'BTC/EUR', 'base': 'BTC', 'quote': 'EUR' },
                'BTC/CZK': { 'id': 'BTC_CZK', 'symbol': 'BTC/CZK', 'base': 'BTC', 'quote': 'CZK' },
            },
        });
    }

    async fetchBalance (params = {}) {
        let response = await this.privatePostBalances ();
        let balances = response['data'];
        let result = { 'info': balances };
        for (let c = 0; c < this.currencies.length; c++) {
            let currency = this.currencies[c];
            let account = this.account ();
            if (currency in balances) {
                account['free'] = balances[currency]['available'];
                account['used'] = balances[currency]['reserved'];
                account['total'] = balances[currency]['balance'];
            }
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, params = {}) {
        let response = await this.publicGetOrderBook (this.extend ({
            'currencyPair': this.marketId (symbol),
            'groupByPriceLimit': 'False',
        }, params));
        let orderbook = response['data'];
        let timestamp = orderbook['timestamp'] * 1000;
        return this.parseOrderBook (orderbook, timestamp, 'bids', 'asks', 'price', 'amount');
    }

    async fetchTicker (symbol, params = {}) {
        let response = await this.publicGetTicker (this.extend ({
            'currencyPair': this.marketId (symbol),
        }, params));
        let ticker = response['data'];
        let timestamp = ticker['timestamp'] * 1000;
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': parseFloat (ticker['high']),
            'low': parseFloat (ticker['low']),
            'bid': parseFloat (ticker['bid']),
            'ask': parseFloat (ticker['ask']),
            'vwap': undefined,
            'open': undefined,
            'close': undefined,
            'first': undefined,
            'last': parseFloat (ticker['last']),
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': parseFloat (ticker['amount']),
            'quoteVolume': undefined,
            'info': ticker,
        };
    }

    parseTrade (trade, market = undefined) {
        if (!market)
            market = this.markets_by_id[trade['currencyPair']];
        return {
            'id': trade['transactionId'],
            'info': trade,
            'timestamp': trade['timestamp'],
            'datetime': this.iso8601 (trade['timestamp']),
            'symbol': market['symbol'],
            'type': undefined,
            'side': undefined,
            'price': trade['price'],
            'amount': trade['amount'],
        };
    }

    async fetchTrades (symbol, params = {}) {
        let market = this.market (symbol);
        let response = await this.publicGetTransactions (this.extend ({
            'currencyPair': market['id'],
            'minutesIntoHistory': 10,
        }, params));
        return this.parseTrades (response['data'], market);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        let method = 'privatePost' + this.capitalize (side);
        let order = {
            'currencyPair': this.marketId (symbol),
        };
        if (type == 'market') {
            if (side == 'buy')
                order['total'] = amount; // amount in fiat
            else
                order['amount'] = amount; // amount in fiat
            method += 'Instant';
        } else {
            order['amount'] = amount; // amount in crypto
            order['price'] = price;
            method += this.capitalize (type);
        }
        let response = await this[method] (self.extend (order, params));
        return {
            'info': response,
            'id': response['data'].toString (),
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        return await this.privatePostCancelOrder ({ 'orderId': id });
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + path;
        if (api == 'public') {
            if (Object.keys (params).length)
                url += '?' + this.urlencode (params);
        } else {
            if (!this.uid)
                throw new AuthenticationError (this.id + ' requires `' + this.id + '.uid` property for authentication');
            let nonce = this.nonce ().toString ();
            let auth = nonce + this.uid + this.apiKey;
            let signature = this.hmac (this.encode (auth), this.encode (this.secret));
            body = this.urlencode (this.extend ({
                'clientId': this.uid,
                'nonce': nonce,
                'publicKey': this.apiKey,
                'signature': signature.toUpperCase (),
            }, params));
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        if ('error' in response)
            if (response['error'])
                throw new ExchangeError (this.id + ' ' + this.json (response));
        return response;
    }
}
