
function assertNoError(e) {
  // Assertion to ensure that error is omitted inside a callback.
  if (e) {
    throw e;
  }
}

function assertError(e, statusCode) {
  if (!e || (e && statusCode && e.statusCode !== statusCode)) {
    throw e;
  }
}

module.exports = {
  assertNoError,
  assertError,
};
