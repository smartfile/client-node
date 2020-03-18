node_modules: package.json
	npm install
	touch node_modules

.PHONY: deps
deps: node_modules

.PHONY: test
test: deps
	npm run test

.PHONY: debug
debug: deps
	npm run debug

.PHONY: lint
lint: deps
	npm run lint

.PHONY: ci
ci: test lint

.PHONY: coverage
coverage:
	npm run coverage

.PHONY: version
version:
	npm version ${VERSION}

.PHONY: clean
clean:
	rm -rf node_modules

