var expect = require('chai').expect;
var rewire = require('rewire');

var Neo4j = rewire('../neo4j.js');

describe('Neo4j wrapper', function() {
    describe('when running a query (with mock request)', function() {

        var db;
        var errors = [];

        before(function(done) {
            Neo4j.__set__({
                'request': {
                    'post': function(args, callback) {
                        callback(null,
                            { 'body': { 'results': args, 'errors': errors } });
                    }
                },
                'mapResults': function(results) { return results; }
            });

            db = new Neo4j('http://localhost:7474');

            done();
        });

        it('should run a simple query with no parameters', function(done) {
            db.query('test', function(err, results) {
                expect(err).to.not.be.ok();
                expect(results).to.have.property('uri');
                expect(results).to.have.property('json');

                var json = results.json;

                expect(json).to.have.property('statements');
                expect(json.statements).to.be.an('array');
                expect(json.statements).to.have.length(1);

                var result = json.statements[0];

                expect(result).to.have.property('statement', 'test');
                expect(result).to.have.property('parameters');
                expect(result.parameters).to.be.empty();

                done();
            });
        });

        it('should run a single query with parameters', function(done) {
            db.query('test', { 'param': 'value' }, function(err, results) {
                expect(err).to.not.be.ok();
                expect(results).to.have.property('uri');
                expect(results).to.have.property('json');

                var json = results.json;

                expect(json).to.have.property('statements');
                expect(json.statements).to.be.an('array');
                expect(json.statements).to.have.length(1);

                var result = json.statements[0];

                expect(result).to.have.property('statement', 'test');
                expect(result).to.have.property('parameters');
                expect(result.parameters).to.have.property('param', 'value');

                done();
            });
        });

        it('should run a batch of queries', function(done) {
            var statements = [
                { 'statement': 'test1', 'parameters': { 'param1': 'value1' } },
                { 'statement': 'test2', 'parameters': { 'param2': 'value2' } }
            ];

            db.query(statements, function(err, results) {
                expect(err).to.not.be.ok();
                expect(results).to.have.property('uri');
                expect(results).to.have.property('json');

                var json = results.json;

                expect(json).to.have.property('statements');
                expect(json.statements).to.be.an('array');
                expect(json.statements).to.have.length(2);

                var result = json.statements[0];

                expect(result).to.have.property('statement', 'test1');
                expect(result).to.have.property('parameters');
                expect(result.parameters).to.have.property('param1', 'value1');

                result = json.statements[1];

                expect(result).to.have.property('statement', 'test2');
                expect(result).to.have.property('parameters');
                expect(result.parameters).to.have.property('param2', 'value2');

                done();
            });
        });

        it('should pass errors from Neo4j through', function(done) {
            errors = [
                {
                    'code': 'Error code 1',
                    'message': 'Error message 1'
                },
                {
                    'code': 'Error code 2',
                    'message': 'Error message 2'
                }
            ];

            db.query('test', function(err, results) {
                expect(err).to.have.property('statements');
                expect(err).to.have.property('message');
                expect(err).to.have.property('errors');

                expect(err.errors).to.be.an('array');
                expect(err.errors).to.have.length(2);

                expect(results).to.be.an('array');
                expect(results).to.be.empty();

                done();
            });
        });

        it('should pass errors from the request through', function(done) {
            var mock = {
                'post': function(args, callback) {
                    callback(new Error('Error'));
                }
            };

            Neo4j.__set__('request', mock);

            db.query('test', function(err, results) {
                expect(err).to.be.ok();
                expect(err).to.have.property('statements');
                expect(err).to.have.property('message', 'Error');
                expect(err).to.have.property('errors');

                expect(err.errors).to.be.an('array');
                expect(err.errors).to.have.length(0);

                expect(results).to.be.an('array');
                expect(results).to.be.empty();

                done();
            });
        });
    });

    describe('when building a statement', function() {

        it('should work with just a template defined', function(done) {
            var statement = Neo4j.buildStatement('MATCH (n) RETURN n');

            expect(statement).to.have.property('statement',
                'MATCH (n) RETURN n');
            expect(statement).to.have.property('parameters');
            expect(statement.parameters).to.be.empty();

            done();
        });

        it('should handle statements as arrays', function(done) {
            var statement = Neo4j.buildStatement(['MATCH (n)', 'RETURN n']);

            expect(statement).to.have.property('statement',
                'MATCH (n)\nRETURN n');
            expect(statement).to.have.property('parameters');
            expect(statement.parameters).to.be.empty();

            done();
        });

        it('should perform any given substitutions', function(done) {
            var statement = Neo4j.buildStatement('MATCH (${x}) RETURN ${x}',
                { 'x': 'n' }, {});

            expect(statement).to.have.property('statement',
                'MATCH (n) RETURN n');
            expect(statement).to.have.property('parameters');
            expect(statement.parameters).to.be.empty();

            done();
        });

        it('should ignore extra definitions of substitutions', function(done) {
            var statement = Neo4j.buildStatement('MATCH (${x}) RETURN ${x}',
                { 'x': 'n', 'y': 'z' }, {});

            expect(statement).to.have.property('statement',
                'MATCH (n) RETURN n');
            expect(statement).to.have.property('parameters');
            expect(statement.parameters).to.be.empty();

            done();
        });

        it('should error if an undefined substitution is used', function(done) {
            expect(function() {
                Neo4j.buildStatement('MATCH (${x}) RETURN n');
            }).to.throw(Error);
            done();
        });

        it('should error if undefined substitutions are used', function(done) {
            expect(function() {
                Neo4j.buildStatement('MATCH (${x}) RETURN ${y}');
            }).to.throw(Error);
            done();
        });

        it('should add parameter object', function(done) {
            var statement = Neo4j.buildStatement(
                'MATCH (n {value: {value}) RETURN n', {}, { 'value': 'foo' });

            expect(statement).to.have.property('statement',
                'MATCH (n {value: {value}) RETURN n');
            expect(statement).to.have.property('parameters');
            expect(statement.parameters).to.have.property('value', 'foo');
            done();
        });

        it('should allow just parameters to be passed', function(done) {
            var parameters = {'a': 'b'};
            var statement = Neo4j.buildStatement('test', parameters);
            expect(statement).to.have.property('statement', 'test');
            expect(statement).to.have.property('parameters', parameters);
            done();
        });
    });

    describe('result mapper', function() {
        var mapResults = Neo4j.__get__('mapResults');

        it('should map rows to columns', function(done) {
            var data = [
                {
                    'columns': ['foo', 'bar'],
                    'data': [
                        {
                            'row': [
                                { 'type': 'String', 'value': 'one' },
                                { 'type': 'String', 'value': 'two' }
                            ]
                        }
                    ]
                }
            ];

            var results = mapResults(data);

            expect(results).to.be.an('array');
            expect(results).to.have.length(1);

            expect(results[0]).to.be.an('array');
            expect(results[0]).to.have.length(1);

            expect(results[0][0]).to.have.property('foo');
            expect(results[0][0].foo).to.have.property('type', 'String');
            expect(results[0][0].foo).to.have.property('value', 'one');

            expect(results[0][0]).to.have.property('bar');
            expect(results[0][0].bar).to.have.property('type', 'String');
            expect(results[0][0].bar).to.have.property('value', 'two');

            done();
        });

        it('should handle complex results', function(done) {
            var data = [
                {
                    'columns': ['foo'],
                    'data': [{ 'row': [{ 'type': 'String', 'value': 'one' }] }]
                },
                {
                    'columns': ['bar'],
                    'data': [{ 'row': [{ 'value': 'one' }] }]
                },
                {
                    'columns': ['baz'],
                    'data': [
                        { 'row': [{ 'type': 'String', 'value': 'one' }] },
                        { 'row': [{ 'type': 'String', 'value': 'two' }] },
                        { 'row': [{ 'value': 'three' }] }
                    ]
                }
            ];

            var results = mapResults(data);

            expect(results).to.be.an('array');
            expect(results).to.have.length(3);

            expect(results[0]).to.be.an('array');
            expect(results[0]).to.have.length(1);

            expect(results[0][0]).to.have.property('foo');
            expect(results[0][0].foo).to.have.property('type', 'String');
            expect(results[0][0].foo).to.have.property('value', 'one');

            expect(results[1]).to.be.an('array');
            expect(results[1]).to.have.length(1);

            expect(results[1][0]).to.have.property('bar');
            expect(results[1][0].bar).to.have.property('value', 'one');

            expect(results[2]).to.be.an('array');
            expect(results[2]).to.have.length(3);

            expect(results[2][0]).to.have.property('baz');
            expect(results[2][0].baz).to.have.property('type', 'String');
            expect(results[2][0].baz).to.have.property('value', 'one');

            expect(results[2][1]).to.have.property('baz');
            expect(results[2][1].baz).to.have.property('type', 'String');
            expect(results[2][1].baz).to.have.property('value', 'two');

            expect(results[2][2]).to.have.property('baz');
            expect(results[2][2].baz).to.have.property('value', 'three');

            done();
        });

        it('should return an empty array on error', function(done) {
            var results = mapResults('invalid results');

            expect(results).to.be.an('array');
            expect(results).to.be.empty();

            done();
        });
    });
});

describe('Escaping identifiers', function() {

    it('Should handle complex strings', function(done) {
        expect(Neo4j.escapeIdentifier('a_:b c\'d')).to.equal('`a_:b c\'d`');
        done();
    });

    it('Should escape backticks', function(done) {
        expect(Neo4j.escapeIdentifier('a`b')).to.equal('`a``b`');
        done();
    });
});