
function assertNoError(e) {
  // Assertion to ensure that error is omitted inside a callback.
  if (e) {
    throw e;
  }
}

module.exports = {
  assertNoError,
};
