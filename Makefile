.PHONY: test
test:
	npm run test

.PHONY: debug
debug:
	npm run debug

.PHONY: lint
lint:
	npm run lint

.PHONY: ci
ci: test lint
