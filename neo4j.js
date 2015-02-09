var request = require('request');
var parser = require('./lib/arguments.js');

var regexp = /.*\/db\/data\/transaction\/(\d+)\/commit.*/;

// The Rainbird Neo4j package gives a very thin wrapper around the Neo4J REST
// API and exposes this as an object. When you instantiate a new Neo4j object 
// you need to tell it where Neo4j lives. The URI will be something along the 
// lines of `http://localhost:7474`.

function Neo4j(uri) {
    var path = 'db/data/transaction/';

    if(uri.substr(-1) === "/" ) {
        this.neo4j = uri + path;
    } else {
        this.neo4j = uri + '/' + path;
    }
}

// Results from the Neo4j REST API aren't in the best format and the
// documentation on the format is sketchy. Instead we flip the results into a
// format whereby a list of results is returned, one for each query run. That,
// in turn contains a list of each row returned for the given query. Each row
// is an object where the columns are defined as properties which themselves
// are objects containing the returned data for that element.

function mapResults(results) {
    var mappedResults = [];

    try {
        results.forEach(function(result) {
            var mappedResult = [];
            result.data.forEach(function(data) {
                var mappedData = {};

                data.row.forEach(function(element, index) {
                    mappedData[result.columns[index]] = element;
                });

                mappedResult.push(mappedData);
            });

            mappedResults.push(mappedResult);
        });
    } catch (err) {
        return [];
    }

    return mappedResults;
}

// Handle the results from the REST endpoint. Errors from calling the endpoint
// are handled differently to errors generated by Neo4j when running the query.

function parseResults(err, results, info, callback) {
    if (err) {
        info.errors = [];
        return callback(err, [], info);
    }

    if (!results.body) {
        return callback(new Error('No body in results'), [], info);
    }

    if (results.body.transaction) {
        info.timeout = results.body.transaction.expires;
    }

    if (results.body.commit) {
        info.transactionID = parseInt(
            results.body.commit.replace(regexp, '$1'));
    }

    if (results.body.commit && isNaN(info.transactionID)) {
        return callback('Invalid commit location: ' + results.body.commit, [],
            info);
    }

    if (results.body.errors && results.body.errors.length > 0) {
        var error = new Error('Error running query');
        info.errors = results.body.errors;
        callback(error, [], info);
    } else {
        callback(null, mapResults(results.body.results), info);
    }
}

// Substitutions are performed as part of composing statements from queries,
// substitutions and properties. The `compose` function will take a string along
// with optional `substitution` and `parameters` objects and pass a statement
// object to the callback. This statement object can then be added to an array
// and passed to Neo4j through `query`, `begin` or `commit`. If only one object
// is given it is assumed to be a parameters object
//
// For example, the following code:
//
// ```javascript
// var template = `MATCH (:${foo} {value: {value}})`;
// var substitutions = { 'foo': 'Baz'};
// var parameters = { 'value': 'bar' };
// Neo4j.compose(template, substitutions, parameters, callback);
// ```
//
// Will pass the following statement object to Neo4J:
//
// ```JSON
// [{
//    "statement": "MATCH(:Baz {value: {value}})",
//    "parameters": { "value": "bar" }
// }]
// ```

function compose() {
    parser.parse(arguments, function(err, args) {
        args.callback(err, args.statements[0]);
    });
}

// Identifiers in Neo4j follow the following basic rules:
//
//    * case sensitive
//    * can contain underscores and alphanumeric characters ([a-zA-Z0-9_])
//    * must always start with a letter. ([a-zA-Z]+[a-zA-Z0-9_]*)
//
// More complex identifiers can be quoted using backtick (`) characters.
// Backticks themselves can be escaped using a backtick. To avoid complex
// pattern matching on a string we simply assume all identifiers need to be
// quoted by escaping backticks and surrounding the string in backticks.

function escape(string) {
    var result = string.replace(/`/g, '``');
    return '`' + result + '`';
}

// To run a query you can either provide a Cypher statement as a string and
// an optional parameters object, or you can provide an array of statement
// objects. For transactions spanning queries a transaction ID must be provided.
// The last argument is a callback.
//
// Each statement object should contain a statement property, which will be the
// Cypher statement, and a parameters object. The callback is passed any errors,
// and the results of the query or queries.
//
// The following are all valid:
//
// ```
// Neo4j.query(
//     'MATCH (n) RETURN (n)',
//     function(err, results) { console.log(JSON.stringify(data); }
// );
// ```
//
// ```
// Neo4j.query(
//     'MATCH (n {id: {id} }) RETURN (n)',
//     { `id`: 123 },
//     function(err, results) { console.log(JSON.stringify(data); }
// );
// ```
//
// ```
// Neo4j.query(
//     [
//         {
//             'statement': 'MATCH (n {id: {id} }) RETURN (n)',
//             'parameters': { `id`: 123 }
//         },
//         {
//             'statement': 'MATCH (n {id: {id} }) RETURN (n)',
//             'parameters': { `id`: 124 }
//         },
//     ],
//     function(err, results) { console.log(JSON.stringify(data); }
// );
// ```
//
// The complete set of valid ways to call `query` is:
//
// ```
// query(string, callback)
// query(string, parameters, callback)
// query(string, substitutions, parameters, callback)
// query(array, callback)
// query(array, parameters, callback)
// query(array, substitutions, parameters, callback)
// query(transactionID, string, callback)
// query(transactionID, string, parameters, callback)
// query(transactionID, string, substitutions, parameters, callback)
// query(transactionID, array, callback)
// query(transactionID, array, parameters, callback)
// query(transactionID, array, substitutions, parameters, callback)
// ```
//
// where:
//
// * `string` is a query string
// * `array` is an array of query strings or statement objects
// * `parameters` is a parameters `object`
// * `substitutions` is a substitutions `object`
// * `transactionID` is an `integer`
// * `callback` is a `function`
//
// If `query` is called without a transaction ID then it is wrapped in single a
// transaction so if a single query fails in a list of queries then all the
// queries will be rolled back.

Neo4j.prototype.query = function() {
    var uri = this.neo4j;

    parser.parse(arguments, function(err, args) {
        var info = {
            'statements': args.statements,
            'errors': []
        };

        if (err) {
            return args.callback(err, [], info);
        }

        if (args.transactionID) {
            uri += args.transactionID;
        } else {
            uri += 'commit';
        }

        request.post(
            { 'uri': uri, 'json': { 'statements': args.statements } },
            function(err, results) {
                parseResults(err, results, info, args.callback);
            }
        );
    });
};

// Begin a transaction, optionally running a query once the transaction is optn.
// See `query` for full details on running queries.
//
// The complete set of valid ways to call `begin` is:
//
// ```
// begin(string, callback)
// begin(string, parameters, callback)
// begin(string, substitutions, parameters, callback)
// begin(array, callback)
// begin(array, parameters, callback)
// begin(array, substitutions, parameters, callback)
// ```
//
// where:
//
// * `string` is a query string
// * `array` is an array of query strings or statement objects
// * `parameters` is a parameters `object`
// * `substitutions` is a substitutions `object`
// * `callback` is a `function`

Neo4j.prototype.begin = function() {
    var uri = this.neo4j;

    parser.parse(arguments, function(err, args) {
        var info = {
            'statements': args.statements,
            'errors': []
        };

        if (err) {
            return args.callback(err, [], info);
        }

        request.post(
            { 'uri': uri, 'json': { 'statements': args.statements } },
            function(err, results) {
                parseResults(err, results, info, args.callback);
            }
        );
    });
};

// Commit a transaction, optionally running a query before the commit. See
// `query` for full details on running queries.
//
// The complete set of valid ways to call `commit` is:
//
// ```
// commit(transactionID, string, callback)
// commit(transactionID, string, parameters, callback)
// commit(transactionID, string, substitutions, parameters, callback)
// commit(transactionID, array, callback)
// commit(transactionID, array, parameters, callback)
// commit(transactionID, array, substitutions, parameters, callback)
// ```
//
// where:
//
// * `string` is a query string
// * `array` is an array of query strings or statement objects
// * `parameters` is a parameters `object`
// * `substitutions` is a substitutions `object`
// * `transactionID` is an `integer`
// * `callback` is a `function`

Neo4j.prototype.commit = function() {
    var uri = this.neo4j;

    parser.parse(arguments, function(err, args) {
        var info = {
            'statements': args.statements,
            'errors': []
        };

        if (err) {
            return args.callback(err, [], info);
        }

        if (args.transactionID) {
            uri += args.transactionID + '/commit';
        } else {
            var error = new Error('No transaction ID supplied to commit');
            return args.callback(error, [], info);
        }

        request.post(
            { 'uri': uri, 'json': { 'statements': args.statements } },
            function(err, results) {
                parseResults(err, results, info, args.callback);
            }
        );
    });
};

// Rollback an existing transaction.

Neo4j.prototype.rollback = function(transactionID, callback) {
    var uri = this.neo4j;

    var info = {
        'statements': [],
        'errors': []
    };

    info.transactionID = transactionID;
    uri += transactionID;

    request.del(uri, function(err, results) {
        parseResults(err, results, info, callback);
    });
};

// Reset the timeout on a transaction by sending an empty query.

Neo4j.prototype.resetTimeout = function(transactionID, callback) {
    Neo4j.prototype.query(transactionID, callback);
};

module.exports = Neo4j;
module.exports.compose = compose;
module.exports.escape = escape;

// ## License
//
// Copyright (c) 2014, RainBird Technologies <follow@rainbird.ai>
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED 'AS IS' AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
